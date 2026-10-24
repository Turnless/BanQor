// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockMUSD is ERC20 {
    address public minter;

    constructor() ERC20("Mezo USD", "MUSD") {}

    function setMinter(address m) external {
        minter = m;
    }

    function mint(address to, uint256 amt) external {
        require(msg.sender == minter, "not minter");
        _mint(to, amt);
    }

    function burn(address from, uint256 amt) external {
        require(msg.sender == minter, "not minter");
        _burn(from, amt);
    }

    /// test helper
    function faucet(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

contract MockPriceFeed {
    uint256 public price;

    constructor(uint256 p) {
        price = p;
    }

    function setPrice(uint256 p) external {
        price = p;
    }

    function fetchPrice() external view returns (uint256) {
        return price;
    }
}

/// @notice One contract that plays BorrowerOperations, TroveManager, HintHelpers and SortedTroves.
/// Models Mezo's rules that matter to the vault: min net debt, gas compensation, borrowing fee,
/// MCR on borrow/withdraw, burn-on-repay, and BTC returned to msg.sender.
contract MockMezo {
    struct Trove {
        uint8 status;
        uint256 coll;
        uint256 principal; // includes gas compensation and fees
        uint256 interest;
    }

    MockMUSD public immutable musd;
    MockPriceFeed public immutable priceFeed;
    uint256 public minNetDebt;
    uint256 public MUSD_GAS_COMPENSATION;
    uint256 public feeBps;
    uint256 public constant MCR = 1.1e18;
    mapping(address => Trove) public troves;

    // records the last hints so tests can assert draw() computed them
    address public lastUpperHint;
    address public lastLowerHint;

    constructor(MockMUSD _musd, MockPriceFeed _pf, uint256 _minNetDebt, uint256 _gasComp, uint256 _feeBps) {
        musd = _musd;
        priceFeed = _pf;
        minNetDebt = _minNetDebt;
        MUSD_GAS_COMPENSATION = _gasComp;
        feeBps = _feeBps;
    }

    receive() external payable {}

    // ---- BorrowerOperations ----
    function getBorrowingFee(uint256 debt) public view returns (uint256) {
        return (debt * feeBps) / 10_000;
    }

    function openTrove(uint256 debt, address upper, address lower) external payable {
        Trove storage t = troves[msg.sender];
        require(t.status != 1, "BorrowerOps: Trove is active");
        uint256 net = debt + getBorrowingFee(debt);
        require(net >= minNetDebt, "BorrowerOps: Trove's net debt must be greater than minimum");
        t.status = 1;
        t.coll = msg.value;
        t.principal = net + MUSD_GAS_COMPENSATION;
        t.interest = 0;
        require(_icr(t) >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
        _hints(upper, lower);
        musd.mint(msg.sender, debt);
    }

    function addColl(address upper, address lower) external payable {
        Trove storage t = _active(msg.sender);
        t.coll += msg.value;
        _hints(upper, lower);
    }

    function withdrawColl(uint256 amt, address upper, address lower) external {
        Trove storage t = _active(msg.sender);
        t.coll -= amt;
        require(_icr(t) >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
        _hints(upper, lower);
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "Sending BTC failed");
    }

    function withdrawMUSD(uint256 amt, address upper, address lower) external {
        Trove storage t = _active(msg.sender);
        require(amt > 0, "BorrowerOps: Debt increase requires non-zero debtChange");
        t.principal += amt + getBorrowingFee(amt);
        require(_icr(t) >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
        _hints(upper, lower);
        musd.mint(msg.sender, amt);
    }

    function repayMUSD(uint256 amt, address upper, address lower) external {
        Trove storage t = _active(msg.sender);
        uint256 debt = t.principal + t.interest;
        require(amt <= debt - MUSD_GAS_COMPENSATION, "BorrowerOps: Amount repaid must not be larger than the Trove's debt");
        require(
            debt - MUSD_GAS_COMPENSATION - amt >= minNetDebt,
            "BorrowerOps: Trove's net debt must be greater than minimum"
        );
        require(musd.balanceOf(msg.sender) >= amt, "BorrowerOps: Caller doesnt have enough mUSD to make repayment");
        // interest first, like Mezo
        uint256 fromInterest = amt < t.interest ? amt : t.interest;
        t.interest -= fromInterest;
        t.principal -= amt - fromInterest;
        _hints(upper, lower);
        musd.burn(msg.sender, amt);
    }

    function closeTrove() external {
        Trove storage t = _active(msg.sender);
        uint256 debt = t.principal + t.interest;
        require(
            musd.balanceOf(msg.sender) >= debt - MUSD_GAS_COMPENSATION,
            "BorrowerOps: Caller doesnt have enough mUSD to make repayment"
        );
        musd.burn(msg.sender, debt - MUSD_GAS_COMPENSATION);
        uint256 coll = t.coll;
        t.status = 2;
        t.coll = 0;
        t.principal = 0;
        t.interest = 0;
        (bool ok,) = msg.sender.call{value: coll}("");
        require(ok, "Sending BTC failed");
    }

    // ---- TroveManager ----
    function getTroveStatus(address b) external view returns (uint8) {
        return troves[b].status;
    }

    function getCurrentICR(address b, uint256 price) external view returns (uint256) {
        Trove storage t = troves[b];
        uint256 debt = t.principal + t.interest;
        return debt == 0 ? type(uint256).max : (t.coll * price) / debt;
    }

    /// Like Mezo, returned coll/principal/interest already include the pending amounts.
    function getEntireDebtAndColl(address b)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        Trove storage t = troves[b];
        return (
            t.coll + pendingColl,
            t.principal + pendingPrincipal,
            t.interest + pendingInterest,
            pendingColl,
            pendingPrincipal,
            pendingInterest
        );
    }

    uint256 public pendingColl;
    uint256 public pendingPrincipal;
    uint256 public pendingInterest;

    /// simulate an unapplied redistribution (Mezo applies it to the trove on the next adjustment)
    function setPending(uint256 coll, uint256 principal, uint256 interest) external {
        pendingColl = coll;
        pendingPrincipal = principal;
        pendingInterest = interest;
    }

    // ---- HintHelpers / SortedTroves ----
    function getApproxHint(uint256 nicr, uint256, uint256 seed) external pure returns (address, uint256, uint256) {
        return (address(uint160(nicr % type(uint160).max)), 0, seed);
    }

    function computeNominalCR(uint256 coll, uint256 debt) external pure returns (uint256) {
        return (coll * 1e20) / debt;
    }

    function findInsertPosition(uint256, address prev, address next) external pure returns (address, address) {
        return (prev, next);
    }

    // ---- test helpers ----
    function accrueInterest(address b, uint256 amt) external {
        troves[b].interest += amt;
    }

    /// simulate Mezo closing the trove (e.g. full redemption)
    function forceClose(address b, uint8 status) external {
        Trove storage t = troves[b];
        t.status = status;
        t.coll = 0;
        t.principal = 0;
        t.interest = 0;
    }

    mapping(address => uint256) public surplus;

    /// simulate a redemption that leaves `amount` BTC in CollSurplusPool for `b` (mock must hold the BTC)
    function forceRedeemWithSurplus(address b, uint256 amount) external {
        Trove storage t = troves[b];
        t.status = 4;
        t.coll = 0;
        t.principal = 0;
        t.interest = 0;
        surplus[b] += amount;
    }

    function claimCollateral() external {
        uint256 amt = surplus[msg.sender];
        require(amt > 0, "CollSurplusPool: No collateral available to claim");
        surplus[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "Sending BTC failed");
    }

    function _active(address b) internal view returns (Trove storage t) {
        t = troves[b];
        require(t.status == 1, "BorrowerOps: Trove does not exist or is closed");
    }

    function _icr(Trove storage t) internal view returns (uint256) {
        return (t.coll * priceFeed.fetchPrice()) / (t.principal + t.interest);
    }

    function _hints(address upper, address lower) internal {
        lastUpperHint = upper;
        lastLowerHint = lower;
    }
}
