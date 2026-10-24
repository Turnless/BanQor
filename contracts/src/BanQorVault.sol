// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IBorrowerOperations} from "./interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "./interfaces/ITroveManager.sol";
import {IHintHelpers} from "./interfaces/IHintHelpers.sol";
import {ISortedTroves} from "./interfaces/ISortedTroves.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {
    MezoContracts,
    VaultConfig,
    Policy,
    AgentState,
    LineStatus,
    AgentStatus,
    MIN_ICR_FLOOR_BPS
} from "./BanQorTypes.sol";

/// @title BanQorVault
/// @notice Owns one Mezo trove and lends small MUSD floats to registered agents under on-chain policies.
/// @dev Testnet, unaudited.
contract BanQorVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MIN_FLOOR_BPS = MIN_ICR_FLOOR_BPS;
    uint256 private constant BPS = 10_000;
    uint256 private constant WINDOW = 1 days;
    uint8 private constant TROVE_ACTIVE = 1;
    /// Mezo LiquityMath NICR precision
    uint256 private constant NICR_PRECISION = 1e20;

    address public immutable owner;
    IERC20 public immutable musd;
    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    IHintHelpers public immutable hintHelpers;
    ISortedTroves public immutable sortedTroves;
    IPriceFeed public immutable priceFeed;
    uint16 public immutable rebalanceBufferBps;
    uint32 public immutable hintTrials;

    bool public paused;
    bool public lineOpen;
    uint16 public icrFloorBps;
    uint128 public borrowBuffer;
    mapping(address => AgentState) internal _agents;
    address[] internal _agentList;

    event LineOpened(uint256 coll, uint256 debt);
    event LineClosed(uint256 collReturned);
    event AgentSet(address indexed agent, Policy policy);
    event AgentRevoked(address indexed agent);
    event Drawn(address indexed agent, uint256 amount, uint256 borrowed);
    event Borrowed(uint256 amount);
    event Repaid(uint256 amount);
    event CollateralAdded(uint256 amount);
    event CollateralWithdrawn(uint256 amount);
    event CollateralClaimed(uint256 amount);
    event Swept(address indexed to, uint256 amount);
    event VaultPaused();
    event VaultUnpaused();
    event Rebalanced(uint256 repaid, uint256 icrBefore, uint256 icrAfter);
    event IcrFloorSet(uint16 bps);
    event BorrowBufferSet(uint128 amount);

    error NotOwner();
    error NotAgent();
    error ErrPaused();
    error AgentInactive();
    error AgentExpired();
    error DrawTooLarge();
    error DailyCapExceeded();
    error FloatExceeded();
    error IcrTooLow();
    error LineNotOpen();
    error LineAlreadyOpen();
    error FloorTooLow();
    error NothingToRebalance();
    error ZeroAddress();
    error ZeroAmount();
    error BtcTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenLineOpen() {
        _requireLineOpen();
        _;
    }

    constructor(address _owner, MezoContracts memory m, VaultConfig memory cfg) {
        if (
            _owner == address(0) || m.musd == address(0) || m.borrowerOperations == address(0)
                || m.troveManager == address(0) || m.hintHelpers == address(0) || m.sortedTroves == address(0)
                || m.priceFeed == address(0)
        ) revert ZeroAddress();
        if (cfg.icrFloorBps < MIN_FLOOR_BPS) revert FloorTooLow();
        owner = _owner;
        musd = IERC20(m.musd);
        borrowerOperations = IBorrowerOperations(m.borrowerOperations);
        troveManager = ITroveManager(m.troveManager);
        hintHelpers = IHintHelpers(m.hintHelpers);
        sortedTroves = ISortedTroves(m.sortedTroves);
        priceFeed = IPriceFeed(m.priceFeed);
        rebalanceBufferBps = cfg.rebalanceBufferBps;
        hintTrials = cfg.hintTrials;
        icrFloorBps = cfg.icrFloorBps;
        borrowBuffer = cfg.borrowBuffer;
    }

    /// @dev Accepts BTC returned by Mezo on withdrawColl / closeTrove.
    receive() external payable {}

    // ------------------------------------------------------------------
    // Owner: line management
    // ------------------------------------------------------------------

    /// @notice Opens a Mezo trove with the vault as borrower. Minted MUSD stays in the vault.
    function openLine(uint256 debtAmount, address upperHint, address lowerHint)
        external
        payable
        onlyOwner
        nonReentrant
    {
        if (lineOpen) revert LineAlreadyOpen();
        if (msg.value == 0 || debtAmount == 0) revert ZeroAmount();
        lineOpen = true;
        borrowerOperations.openTrove{value: msg.value}(debtAmount, upperHint, lowerHint);
        _requireAboveFloor();
        // trove debt as Mezo records it: requested amount + borrowing fee + gas compensation
        (uint256 coll, uint256 debt,) = _trove();
        emit LineOpened(coll, debt);
    }

    function addCollateral(address upperHint, address lowerHint)
        external
        payable
        onlyOwner
        nonReentrant
        whenLineOpen
    {
        if (msg.value == 0) revert ZeroAmount();
        borrowerOperations.addColl{value: msg.value}(upperHint, lowerHint);
        emit CollateralAdded(msg.value);
    }

    /// @notice Withdraws BTC collateral to the owner. The trove must stay at or above the ICR floor.
    function withdrawCollateral(uint256 amount, address upperHint, address lowerHint)
        external
        onlyOwner
        nonReentrant
        whenLineOpen
    {
        if (amount == 0) revert ZeroAmount();
        borrowerOperations.withdrawColl(amount, upperHint, lowerHint);
        _requireAboveFloor();
        emit CollateralWithdrawn(amount);
        _sendBtc(owner, amount);
    }

    /// @notice Repays trove debt with MUSD held by the vault.
    function repay(uint256 amount, address upperHint, address lowerHint)
        external
        onlyOwner
        nonReentrant
        whenLineOpen
    {
        if (amount == 0) revert ZeroAmount();
        borrowerOperations.repayMUSD(amount, upperHint, lowerHint);
        emit Repaid(amount);
    }

    /// @notice Closes the trove (vault must hold debt minus gas compensation in MUSD) and sends all BTC to the owner.
    /// @dev If the trove was already closed by Mezo (liquidation or redemption), this only resets the line.
    function closeLine() external onlyOwner nonReentrant {
        if (!lineOpen) revert LineNotOpen();
        lineOpen = false;
        if (troveManager.getTroveStatus(address(this)) == TROVE_ACTIVE) {
            borrowerOperations.closeTrove();
        }
        uint256 bal = address(this).balance;
        emit LineClosed(bal);
        if (bal > 0) _sendBtc(owner, bal);
    }

    /// @notice Recovers BTC that Mezo holds for the vault in CollSurplusPool after a redemption or a
    /// recovery-mode liquidation of its trove, and sends it to the owner. Only the borrower can claim it.
    function claimCollateral() external onlyOwner nonReentrant {
        uint256 before = address(this).balance;
        borrowerOperations.claimCollateral();
        uint256 claimed = address(this).balance - before;
        emit CollateralClaimed(claimed);
        if (claimed > 0) _sendBtc(owner, claimed);
    }

    /// @notice Moves idle MUSD out of the vault.
    function sweep(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        musd.safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    // ------------------------------------------------------------------
    // Owner: policy
    // ------------------------------------------------------------------

    /// @notice Creates or updates an agent policy. Keeps the agent's current spending window.
    function setAgent(address agent, Policy calldata p) external onlyOwner nonReentrant {
        if (agent == address(0)) revert ZeroAddress();
        AgentState storage s = _agents[agent];
        if (s.windowStart == 0) {
            s.windowStart = uint64(block.timestamp);
            _agentList.push(agent);
        }
        s.policy = p;
        emit AgentSet(agent, p);
    }

    function revokeAgent(address agent) external onlyOwner nonReentrant {
        AgentState storage s = _agents[agent];
        if (s.windowStart == 0) revert NotAgent();
        s.policy.active = false;
        emit AgentRevoked(agent);
    }

    function setIcrFloor(uint16 bps) external onlyOwner nonReentrant {
        if (bps < MIN_FLOOR_BPS) revert FloorTooLow();
        icrFloorBps = bps;
        emit IcrFloorSet(bps);
    }

    function setBorrowBuffer(uint128 amount) external onlyOwner nonReentrant {
        borrowBuffer = amount;
        emit BorrowBufferSet(amount);
    }

    function pause() external onlyOwner nonReentrant {
        paused = true;
        emit VaultPaused();
    }

    function unpause() external onlyOwner nonReentrant {
        paused = false;
        emit VaultUnpaused();
    }

    // ------------------------------------------------------------------
    // Agent
    // ------------------------------------------------------------------

    /// @notice Sends `amount` MUSD to the calling agent, borrowing from the trove if the vault is short.
    /// Checks run in FR-C4 order: paused, registered/active, expiry, size, daily cap, float; then line and ICR.
    function draw(uint256 amount) external nonReentrant {
        if (paused) revert ErrPaused();
        AgentState storage s = _agents[msg.sender];
        if (s.windowStart == 0) revert NotAgent();
        Policy memory p = s.policy;
        if (!p.active) revert AgentInactive();
        if (p.expiry != 0 && block.timestamp >= p.expiry) revert AgentExpired();
        if (amount == 0) revert ZeroAmount();
        if (amount > p.maxDrawPerTx) revert DrawTooLarge();
        if (block.timestamp >= uint256(s.windowStart) + WINDOW) {
            s.windowStart = uint64(block.timestamp);
            s.spentInWindow = 0;
        }
        if (uint256(s.spentInWindow) + amount > p.dailyCap) revert DailyCapExceeded();
        if (musd.balanceOf(msg.sender) + amount > p.maxFloat) revert FloatExceeded();
        _requireLineOpen();

        // effects before interactions (amount <= maxDrawPerTx <= uint128 max)
        s.spentInWindow += uint128(amount);

        uint256 vaultBal = musd.balanceOf(address(this));
        uint256 borrowed;
        if (vaultBal < amount) {
            borrowed = amount - vaultBal + borrowBuffer;
            _borrow(borrowed);
        }
        // even with no borrow, refuse draws while the trove is below the floor
        _requireAboveFloor();
        musd.safeTransfer(msg.sender, amount);
        emit Drawn(msg.sender, amount, borrowed);
    }

    // ------------------------------------------------------------------
    // Keeper
    // ------------------------------------------------------------------

    /// @notice Repays debt with idle vault MUSD while ICR < floor + buffer. Repays only what brings ICR back to
    /// floor + buffer (so a caller can't drain the agents' float), and keeps net debt at the protocol minimum.
    function rebalance(address upperHint, address lowerHint) external nonReentrant whenLineOpen {
        uint256 price = priceFeed.fetchPrice();
        (uint256 coll, uint256 debt,) = _trove();
        uint256 icrBefore = _icrBps(coll, debt, price);
        uint256 targetBps = uint256(icrFloorBps) + rebalanceBufferBps;
        if (icrBefore >= targetBps) revert NothingToRebalance();

        // debt at which ICR == target, rounded down so repaying (debt - targetDebt) reaches the target
        uint256 targetDebt = Math.mulDiv(coll, price * BPS, targetBps * 1e18);
        uint256 needed = debt > targetDebt ? debt - targetDebt : 0;
        uint256 amount = Math.min(needed, Math.min(musd.balanceOf(address(this)), _maxRepayable()));
        if (amount == 0) revert NothingToRebalance();
        borrowerOperations.repayMUSD(amount, upperHint, lowerHint);

        (coll, debt,) = _trove();
        uint256 icrAfter = _icrBps(coll, debt, price);
        emit Repaid(amount);
        emit Rebalanced(amount, icrBefore, icrAfter);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function lineStatus() external view returns (LineStatus memory st) {
        st.lineOpen = lineOpen;
        st.troveStatus = troveManager.getTroveStatus(address(this));
        (st.coll, st.debt,) = _trove();
        st.price = priceFeed.fetchPrice();
        st.icrBps = _icrBps(st.coll, st.debt, st.price);
        st.vaultFloat = musd.balanceOf(address(this));
        st.paused = paused;
        st.icrFloorBps = icrFloorBps;
    }

    function agentStatus(address agent) external view returns (AgentStatus memory st) {
        AgentState memory s = _agents[agent];
        st.policy = s.policy;
        bool windowLive = s.windowStart != 0 && block.timestamp < uint256(s.windowStart) + WINDOW;
        st.spentInWindow = windowLive ? s.spentInWindow : 0;
        st.windowResetsAt = windowLive ? uint256(s.windowStart) + WINDOW : block.timestamp;
        st.agentBalance = musd.balanceOf(agent);
        st.drawableNow = maxDrawable(agent);
    }

    /// @notice Largest amount `agent` could draw right now. Approximate when a borrow is needed
    /// (uses the current fee rate and ignores Mezo's own borrowing-capacity limit).
    function maxDrawable(address agent) public view returns (uint256) {
        AgentState memory s = _agents[agent];
        Policy memory p = s.policy;
        if (paused || s.windowStart == 0 || !p.active) return 0;
        if (p.expiry != 0 && block.timestamp >= p.expiry) return 0;
        if (!lineOpen || troveManager.getTroveStatus(address(this)) != TROVE_ACTIVE) return 0;

        uint256 spent = block.timestamp < uint256(s.windowStart) + WINDOW ? s.spentInWindow : 0;
        uint256 bal = musd.balanceOf(agent);
        if (spent >= p.dailyCap || bal >= p.maxFloat) return 0;
        uint256 cap = Math.min(p.maxDrawPerTx, Math.min(p.dailyCap - spent, p.maxFloat - bal));

        uint256 price = priceFeed.fetchPrice();
        (uint256 coll, uint256 debt,) = _trove();
        if (!_aboveFloor(coll, debt, price)) return 0;
        uint256 vaultBal = musd.balanceOf(address(this));
        if (cap <= vaultBal) return cap;

        // borrow headroom: debt + b + fee(b) <= coll * price / floor
        uint256 maxDebt = Math.mulDiv(coll, price * BPS, uint256(icrFloorBps) * 1e18);
        if (maxDebt <= debt) return vaultBal;
        uint256 feePerUnit = borrowerOperations.getBorrowingFee(1e18);
        uint256 maxBorrow = Math.mulDiv(maxDebt - debt, 1e18, 1e18 + feePerUnit);
        uint256 limit = maxBorrow > borrowBuffer ? vaultBal + (maxBorrow - borrowBuffer) : vaultBal;
        return Math.min(cap, limit);
    }

    function agents(address agent) external view returns (AgentState memory) {
        return _agents[agent];
    }

    function agentList() external view returns (address[] memory) {
        return _agentList;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _borrow(uint256 amount) internal {
        uint256 price = priceFeed.fetchPrice();
        (uint256 coll, uint256 debt, uint256 principal) = _trove();
        uint256 fee = borrowerOperations.getBorrowingFee(amount);
        if (!_aboveFloor(coll, debt + amount + fee, price)) revert IcrTooLow();

        uint256 nicr = Math.mulDiv(coll, NICR_PRECISION, principal + amount + fee);
        // fixed seed: the same troves are sampled at estimate time and when mined, so gas use is stable
        (address hint,,) = hintHelpers.getApproxHint(nicr, hintTrials, uint256(uint160(address(this))));
        (address upper, address lower) = sortedTroves.findInsertPosition(nicr, hint, hint);
        borrowerOperations.withdrawMUSD(amount, upper, lower);
        emit Borrowed(amount);
    }

    /// @return coll collateral incl. pending redistribution
    /// @return debt principal + interest incl. accrued and pending
    /// @return principal principal incl. pending (Mezo sorts troves by coll / principal)
    function _trove() internal view returns (uint256 coll, uint256 debt, uint256 principal) {
        uint256 interest;
        (coll, principal, interest,,,) = troveManager.getEntireDebtAndColl(address(this));
        debt = principal + interest;
    }

    /// @dev Debt that can be repaid while keeping net debt (debt - gas compensation) >= minNetDebt.
    function _maxRepayable() internal view returns (uint256) {
        (, uint256 principal, uint256 interest,, uint256 pendingPrincipal, uint256 pendingInterest) =
            troveManager.getEntireDebtAndColl(address(this));
        // Mezo checks against the stored debt (without pending redistribution), so leave pending out.
        uint256 debt = principal + interest - pendingPrincipal - pendingInterest;
        uint256 floorDebt = borrowerOperations.MUSD_GAS_COMPENSATION() + borrowerOperations.minNetDebt();
        return debt > floorDebt ? debt - floorDebt : 0;
    }

    function _requireLineOpen() internal view {
        if (!lineOpen || troveManager.getTroveStatus(address(this)) != TROVE_ACTIVE) revert LineNotOpen();
    }

    function _requireAboveFloor() internal view {
        (uint256 coll, uint256 debt,) = _trove();
        if (!_aboveFloor(coll, debt, priceFeed.fetchPrice())) revert IcrTooLow();
    }

    /// @dev coll * price / debt >= floor, compared without rounding.
    function _aboveFloor(uint256 coll, uint256 debt, uint256 price) internal view returns (bool) {
        if (debt == 0) return true;
        return Math.mulDiv(coll, price, debt) >= uint256(icrFloorBps) * 1e14;
    }

    function _icrBps(uint256 coll, uint256 debt, uint256 price) internal pure returns (uint256) {
        if (debt == 0) return type(uint256).max;
        return Math.mulDiv(coll, price * BPS, debt * 1e18);
    }

    function _sendBtc(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert BtcTransferFailed();
    }
}
