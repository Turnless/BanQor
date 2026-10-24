// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BanQorFactory} from "../src/BanQorFactory.sol";
import {BanQorVault} from "../src/BanQorVault.sol";
import {MezoContracts, VaultConfig, Policy, LineStatus} from "../src/BanQorTypes.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";
import {MezoConfig, MezoAddrs} from "./utils/MezoConfig.sol";

/// Full flow against the real Mezo MUSD contracts on a testnet fork:
/// `forge test --match-contract BanQorFork --fork-url $MEZO_RPC`
contract BanQorForkTest is Test, MezoConfig {
    MezoAddrs internal m;
    IBorrowerOperations internal bo;
    IERC20 internal musd;
    BanQorFactory internal factory;
    BanQorVault internal vault;
    uint256 internal price;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");

    function setUp() public {
        m = loadMezo();
        vm.skip(block.chainid != m.chainId);
        bo = IBorrowerOperations(m.borrowerOperations);
        musd = IERC20(m.musd);
        price = mockLivePrice(m.priceFeed);

        MezoContracts memory mc =
            MezoContracts(m.musd, m.borrowerOperations, m.troveManager, m.hintHelpers, m.sortedTroves, m.priceFeed);
        factory = new BanQorFactory(mc, VaultConfig(20000, 1000, 10e18, 15));
        vm.prank(owner);
        vault = BanQorVault(payable(factory.createVault()));
        vm.deal(owner, 10 ether);
    }

    function _open(uint256 icrBps) internal returns (uint256 coll) {
        uint256 debt = bo.minNetDebt();
        uint256 composite = debt + bo.getBorrowingFee(debt) + bo.MUSD_GAS_COMPENSATION();
        coll = (composite * icrBps * 1e14) / price + 1;
        vm.prank(owner);
        vault.openLine{value: coll}(debt, address(0), address(0));
    }

    function test_fork_fullFlow() public {
        uint256 coll = _open(30000);
        uint256 debt0 = bo.minNetDebt();
        assertEq(ITroveManager(m.troveManager).getTroveStatus(address(vault)), 1, "vault owns an active trove");
        assertEq(musd.balanceOf(address(vault)), debt0);

        vm.prank(owner);
        vault.setAgent(agent, Policy(20e18, 2e18, 1e18, uint64(block.timestamp + 30 days), true));

        // empty the vault so the next draw must borrow from the trove
        vm.prank(owner);
        vault.sweep(owner, debt0);
        uint256 debtBefore = vault.lineStatus().debt;

        vm.prank(agent);
        vault.draw(1e18);
        assertEq(musd.balanceOf(agent), 1e18, "agent got its float");
        LineStatus memory st = vault.lineStatus();
        uint256 borrowed = 1e18 + vault.borrowBuffer();
        assertEq(st.debt, debtBefore + borrowed + bo.getBorrowingFee(borrowed), "trove debt grew by borrow + fee");
        assertEq(st.vaultFloat, vault.borrowBuffer());
        assertGe(st.icrBps, st.icrFloorBps);
        assertEq(st.coll, coll);

        // second draw is served from the buffer, no new borrow
        vm.prank(agent);
        vault.draw(1e18);
        assertEq(vault.lineStatus().debt, st.debt);

        // owner returns MUSD and repays what Mezo allows above its minimum net debt
        vm.prank(owner);
        musd.transfer(address(vault), 100e18);
        uint256 headroom = st.debt - bo.MUSD_GAS_COMPENSATION() - bo.minNetDebt();
        vm.prank(owner);
        vault.repay(headroom / 2, address(0), address(0));
        assertLt(vault.lineStatus().debt, st.debt);

        // repaying past the minimum is refused by Mezo
        vm.prank(owner);
        vm.expectRevert(bytes("BorrowerOps: Trove's net debt must be greater than minimum"));
        vault.repay(headroom, address(0), address(0));
    }

    function test_fork_priceDropBlocksDrawThenRebalance() public {
        _open(30000);
        vm.prank(owner);
        vault.setAgent(agent, Policy(20e18, 2e18, 1e18, 0, true));
        // empty the vault so the draw borrows, leaving debt above the minimum for rebalance to repay
        uint256 initial = bo.minNetDebt();
        vm.prank(owner);
        vault.sweep(owner, initial);
        vm.prank(agent);
        vault.draw(1e18);

        setMockPrice(m.priceFeed, (price * 1950) / 3000); // ICR ~195%
        vm.prank(agent);
        vm.expectRevert(BanQorVault.IcrTooLow.selector);
        vault.draw(1e18);

        vm.prank(owner);
        musd.transfer(address(vault), 20e18);
        uint256 icrBefore = vault.lineStatus().icrBps;
        vault.rebalance(address(0), address(0));
        assertGt(vault.lineStatus().icrBps, icrBefore);
    }

    function test_fork_pauseAndClose() public {
        uint256 coll = _open(30000);
        vm.prank(owner);
        vault.setAgent(agent, Policy(20e18, 2e18, 1e18, 0, true));
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(BanQorVault.ErrPaused.selector);
        vault.draw(1e18);

        // close: vault needs debt - gas compensation; it holds minNetDebt, so top up the fee + interest
        uint256 owed = vault.lineStatus().debt - bo.MUSD_GAS_COMPENSATION();
        uint256 short = owed > musd.balanceOf(address(vault)) ? owed - musd.balanceOf(address(vault)) : 0;
        deal(m.musd, owner, short + 1e18);
        vm.prank(owner);
        musd.transfer(address(vault), short + 1e18);
        uint256 bal = owner.balance;
        vm.prank(owner);
        vault.closeLine();
        assertFalse(vault.lineOpen());
        assertEq(owner.balance, bal + coll, "collateral returned to owner");
    }
}
