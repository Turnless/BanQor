// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./utils/VaultFixture.sol";
import {BanQorFactory} from "../src/BanQorFactory.sol";
import {BanQorVault} from "../src/BanQorVault.sol";
import {MezoContracts, VaultConfig, Policy, LineStatus, AgentStatus, AgentState} from "../src/BanQorTypes.sol";

contract BanQorFactoryTest is VaultFixture {
    function test_createVault_setsOwnerAndConfig() public view {
        assertEq(factory.vaultOf(owner), address(vault));
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaults(0), address(vault));
        assertEq(vault.owner(), owner);
        assertEq(vault.icrFloorBps(), FLOOR);
        assertEq(vault.borrowBuffer(), BORROW_BUF);
        assertEq(vault.rebalanceBufferBps(), REBAL_BUF);
        assertEq(vault.hintTrials(), TRIALS);
        assertEq(address(vault.musd()), address(musd));
    }

    function test_createVault_emits() public {
        vm.expectEmit(true, false, false, false);
        emit BanQorFactory.VaultCreated(stranger, address(0));
        vm.prank(stranger);
        factory.createVault();
    }

    function test_createVault_revertsWhenOwnerHasVault() public {
        vm.prank(owner);
        vm.expectRevert(BanQorFactory.VaultExists.selector);
        factory.createVault();
    }

    function test_constructor_revertsOnZeroAddress() public {
        MezoContracts memory m = mezoContracts();
        m.troveManager = address(0);
        vm.expectRevert(BanQorVault.ZeroAddress.selector);
        new BanQorFactory(m, VaultConfig(FLOOR, REBAL_BUF, BORROW_BUF, TRIALS));
    }

    function test_constructor_revertsOnLowFloor() public {
        vm.expectRevert(BanQorVault.FloorTooLow.selector);
        new BanQorFactory(mezoContracts(), VaultConfig(14999, REBAL_BUF, BORROW_BUF, TRIALS));
    }

    function test_vaultConstructor_revertsOnZeroOwner() public {
        vm.expectRevert(BanQorVault.ZeroAddress.selector);
        new BanQorVault(address(0), mezoContracts(), VaultConfig(FLOOR, REBAL_BUF, BORROW_BUF, TRIALS));
    }
}

contract BanQorVaultLineTest is VaultFixture {
    function test_openLine_opensTroveAndKeepsMusd() public {
        uint256 coll = collFor(MIN_NET_DEBT, 30000);
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.LineOpened(coll, MIN_NET_DEBT + mezo.getBorrowingFee(MIN_NET_DEBT) + GAS_COMP);
        vm.prank(owner);
        vault.openLine{value: coll}(MIN_NET_DEBT, address(0), address(0));

        assertTrue(vault.lineOpen());
        assertEq(mezo.getTroveStatus(address(vault)), 1);
        assertEq(musd.balanceOf(address(vault)), MIN_NET_DEBT);
        LineStatus memory st = vault.lineStatus();
        assertEq(st.coll, coll);
        assertEq(st.debt, MIN_NET_DEBT + mezo.getBorrowingFee(MIN_NET_DEBT) + GAS_COMP);
        assertApproxEqAbs(st.icrBps, 30000, 1);
        assertEq(st.price, PRICE);
        assertEq(st.vaultFloat, MIN_NET_DEBT);
        assertEq(st.icrFloorBps, FLOOR);
    }

    function test_openLine_onlyOwner() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.openLine{value: 1 ether}(MIN_NET_DEBT, address(0), address(0));
    }

    function test_openLine_revertsWhenAlreadyOpen() public {
        openLine(MIN_NET_DEBT, 30000);
        vm.prank(owner);
        vm.expectRevert(BanQorVault.LineAlreadyOpen.selector);
        vault.openLine{value: 1 ether}(MIN_NET_DEBT, address(0), address(0));
    }

    function test_openLine_revertsOnZero() public {
        vm.prank(owner);
        vm.expectRevert(BanQorVault.ZeroAmount.selector);
        vault.openLine{value: 0}(MIN_NET_DEBT, address(0), address(0));
    }

    function test_openLine_revertsBelowFloor() public {
        uint256 coll = collFor(MIN_NET_DEBT, 15000); // above Mezo MCR, below the 200% floor
        vm.prank(owner);
        vm.expectRevert(BanQorVault.IcrTooLow.selector);
        vault.openLine{value: coll}(MIN_NET_DEBT, address(0), address(0));
    }

    function test_addCollateral() public {
        openLine(MIN_NET_DEBT, 30000);
        uint256 before = vault.lineStatus().coll;
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.CollateralAdded(0.01 ether);
        vm.prank(owner);
        vault.addCollateral{value: 0.01 ether}(address(0), address(0));
        assertEq(vault.lineStatus().coll, before + 0.01 ether);
    }

    function test_addCollateral_revertsOnZeroAndClosedLine() public {
        vm.prank(owner);
        vm.expectRevert(BanQorVault.LineNotOpen.selector);
        vault.addCollateral{value: 1}(address(0), address(0));
        openLine(MIN_NET_DEBT, 30000);
        vm.prank(owner);
        vm.expectRevert(BanQorVault.ZeroAmount.selector);
        vault.addCollateral{value: 0}(address(0), address(0));
    }

    function test_withdrawCollateral_sendsBtcToOwner() public {
        openLine(MIN_NET_DEBT, 30000);
        uint256 bal = owner.balance;
        vm.prank(owner);
        vault.withdrawCollateral(0.001 ether, address(0), address(0));
        assertEq(owner.balance, bal + 0.001 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_withdrawCollateral_revertsBelowFloor() public {
        openLine(MIN_NET_DEBT, 21000);
        uint256 coll = vault.lineStatus().coll;
        vm.prank(owner);
        vm.expectRevert(BanQorVault.IcrTooLow.selector);
        vault.withdrawCollateral(coll / 10, address(0), address(0));
    }

    function test_withdrawCollateral_onlyOwnerAndZero() public {
        openLine(MIN_NET_DEBT, 30000);
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.withdrawCollateral(1, address(0), address(0));
        vm.prank(owner);
        vm.expectRevert(BanQorVault.ZeroAmount.selector);
        vault.withdrawCollateral(0, address(0), address(0));
    }

    function test_repay_reducesDebtFromVaultMusd() public {
        openLine(MIN_NET_DEBT + 100e18, 30000);
        uint256 debtBefore = vault.lineStatus().debt;
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.Repaid(50e18);
        vm.prank(owner);
        vault.repay(50e18, address(0), address(0));
        assertEq(vault.lineStatus().debt, debtBefore - 50e18);
        assertEq(musd.balanceOf(address(vault)), MIN_NET_DEBT + 50e18);
    }

    function test_repay_onlyOwnerAndZero() public {
        openLine(MIN_NET_DEBT, 30000);
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.repay(1, address(0), address(0));
        vm.prank(owner);
        vm.expectRevert(BanQorVault.ZeroAmount.selector);
        vault.repay(0, address(0), address(0));
    }

    function test_sweep() public {
        openLine(MIN_NET_DEBT, 30000);
        vm.expectEmit(true, false, false, true);
        emit BanQorVault.Swept(owner, 100e18);
        vm.prank(owner);
        vault.sweep(owner, 100e18);
        assertEq(musd.balanceOf(owner), 100e18);
    }

    function test_sweep_reverts() public {
        openLine(MIN_NET_DEBT, 30000);
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.sweep(stranger, 1);
        vm.startPrank(owner);
        vm.expectRevert(BanQorVault.ZeroAddress.selector);
        vault.sweep(address(0), 1);
        vm.expectRevert(BanQorVault.ZeroAmount.selector);
        vault.sweep(owner, 0);
        vm.stopPrank();
    }

    function test_closeLine_returnsBtc() public {
        openLine(MIN_NET_DEBT, 30000);
        uint256 coll = vault.lineStatus().coll;
        uint256 owed = vault.lineStatus().debt - GAS_COMP;
        // vault holds MIN_NET_DEBT; owner tops up the fee
        musd.faucet(address(vault), owed - MIN_NET_DEBT);
        uint256 bal = owner.balance;
        vm.prank(owner);
        vault.closeLine();
        assertFalse(vault.lineOpen());
        assertEq(mezo.getTroveStatus(address(vault)), 2);
        assertEq(owner.balance, bal + coll);
    }

    function test_closeLine_revertsWithoutEnoughMusd() public {
        openLine(MIN_NET_DEBT, 30000);
        vm.prank(owner);
        vm.expectRevert(bytes("BorrowerOps: Caller doesnt have enough mUSD to make repayment"));
        vault.closeLine();
    }

    function test_closeLine_afterExternalClose_resets() public {
        openLine(MIN_NET_DEBT, 30000);
        mezo.forceClose(address(vault), 4); // closedByRedemption
        vm.prank(owner);
        vault.closeLine();
        assertFalse(vault.lineOpen());
        // can open again
        openLine(MIN_NET_DEBT, 30000);
        assertTrue(vault.lineOpen());
    }

    function test_closeLine_reverts() public {
        vm.prank(owner);
        vm.expectRevert(BanQorVault.LineNotOpen.selector);
        vault.closeLine();
        openLine(MIN_NET_DEBT, 30000);
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.closeLine();
    }
}

contract BanQorVaultPolicyTest is VaultFixture {
    function test_setAgent_registersAndEmits() public {
        Policy memory p = demoPolicy();
        vm.expectEmit(true, false, false, true);
        emit BanQorVault.AgentSet(agent, p);
        setAgent(agent, p);
        AgentState memory s = vault.agents(agent);
        assertEq(s.policy.dailyCap, p.dailyCap);
        assertEq(s.windowStart, block.timestamp);
        assertEq(vault.agentList().length, 1);
        assertEq(vault.agentList()[0], agent);
    }

    function test_setAgent_updateKeepsWindowAndList() public {
        openLine(MIN_NET_DEBT, 30000);
        setAgent(agent, demoPolicy());
        vm.prank(agent);
        vault.draw(1e18);
        uint64 start = vault.agents(agent).windowStart;
        vm.warp(block.timestamp + 1 hours);
        Policy memory p = demoPolicy();
        p.dailyCap = 5e18;
        setAgent(agent, p);
        AgentState memory s = vault.agents(agent);
        assertEq(s.windowStart, start);
        assertEq(s.spentInWindow, 1e18);
        assertEq(s.policy.dailyCap, 5e18);
        assertEq(vault.agentList().length, 1);
    }

    function test_setAgent_reverts() public {
        Policy memory p = demoPolicy();
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.setAgent(agent, p);
        vm.prank(owner);
        vm.expectRevert(BanQorVault.ZeroAddress.selector);
        vault.setAgent(address(0), p);
    }

    function test_revokeAgent() public {
        setAgent(agent, demoPolicy());
        vm.expectEmit(true, false, false, false);
        emit BanQorVault.AgentRevoked(agent);
        vm.prank(owner);
        vault.revokeAgent(agent);
        assertFalse(vault.agents(agent).policy.active);
    }

    function test_revokeAgent_reverts() public {
        vm.prank(owner);
        vm.expectRevert(BanQorVault.NotAgent.selector);
        vault.revokeAgent(agent);
        setAgent(agent, demoPolicy());
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.revokeAgent(agent);
    }

    function test_setIcrFloor() public {
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.IcrFloorSet(25000);
        vm.prank(owner);
        vault.setIcrFloor(25000);
        assertEq(vault.icrFloorBps(), 25000);
    }

    function test_setIcrFloor_reverts() public {
        vm.prank(owner);
        vm.expectRevert(BanQorVault.FloorTooLow.selector);
        vault.setIcrFloor(14999);
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.setIcrFloor(25000);
    }

    function test_setBorrowBuffer() public {
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.BorrowBufferSet(1e18);
        vm.prank(owner);
        vault.setBorrowBuffer(1e18);
        assertEq(vault.borrowBuffer(), 1e18);
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.setBorrowBuffer(0);
    }

    function test_pauseUnpause() public {
        vm.expectEmit(false, false, false, false);
        emit BanQorVault.VaultPaused();
        vm.prank(owner);
        vault.pause();
        assertTrue(vault.paused());
        vm.expectEmit(false, false, false, false);
        emit BanQorVault.VaultUnpaused();
        vm.prank(owner);
        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_pauseUnpause_onlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.pause();
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.unpause();
        vm.stopPrank();
    }
}

contract BanQorVaultDrawTest is VaultFixture {
    function setUp() public override {
        super.setUp();
        openLine(MIN_NET_DEBT, 30000);
        setAgent(agent, demoPolicy());
    }

    function test_draw_fromVaultFloat() public {
        vm.expectEmit(true, false, false, true);
        emit BanQorVault.Drawn(agent, 1e18, 0);
        vm.prank(agent);
        vault.draw(1e18);
        assertEq(musd.balanceOf(agent), 1e18);
        assertEq(vault.agents(agent).spentInWindow, 1e18);
    }

    function test_draw_borrowsShortfallPlusBuffer() public {
        vm.prank(owner);
        vault.sweep(owner, MIN_NET_DEBT - 0.4e18); // vault keeps 0.4 MUSD
        uint256 debtBefore = vault.lineStatus().debt;
        uint256 expectBorrow = 1e18 - 0.4e18 + BORROW_BUF;

        vm.expectEmit(false, false, false, true);
        emit BanQorVault.Borrowed(expectBorrow);
        vm.expectEmit(true, false, false, true);
        emit BanQorVault.Drawn(agent, 1e18, expectBorrow);
        vm.prank(agent);
        vault.draw(1e18);

        assertEq(musd.balanceOf(agent), 1e18);
        assertEq(musd.balanceOf(address(vault)), BORROW_BUF);
        assertEq(vault.lineStatus().debt, debtBefore + expectBorrow + mezo.getBorrowingFee(expectBorrow));
        assertTrue(mezo.lastUpperHint() != address(0), "hints computed on-chain");
    }

    function test_draw_revertsForUnknownAgent() public {
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotAgent.selector);
        vault.draw(1e18);
    }

    function test_draw_revertsWhenPaused() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(BanQorVault.ErrPaused.selector);
        vault.draw(1e18);
    }

    function test_draw_revertsWhenRevoked() public {
        vm.prank(owner);
        vault.revokeAgent(agent);
        vm.prank(agent);
        vm.expectRevert(BanQorVault.AgentInactive.selector);
        vault.draw(1e18);
    }

    function test_draw_revertsWhenExpired() public {
        vm.warp(demoPolicy().expiry);
        vm.prank(agent);
        vm.expectRevert(BanQorVault.AgentExpired.selector);
        vault.draw(1e18);
    }

    function test_draw_noExpiryWhenZero() public {
        Policy memory p = demoPolicy();
        p.expiry = 0;
        setAgent(agent, p);
        vm.warp(block.timestamp + 3650 days);
        vm.prank(agent);
        vault.draw(1e18);
    }

    function test_draw_revertsOnZero() public {
        vm.prank(agent);
        vm.expectRevert(BanQorVault.ZeroAmount.selector);
        vault.draw(0);
    }

    function test_draw_revertsAboveMaxPerTx() public {
        vm.prank(agent);
        vm.expectRevert(BanQorVault.DrawTooLarge.selector);
        vault.draw(1e18 + 1);
    }

    function test_draw_revertsAboveFloat() public {
        vm.startPrank(agent);
        vault.draw(1e18);
        vault.draw(1e18);
        vm.expectRevert(BanQorVault.FloatExceeded.selector);
        vault.draw(1);
        vm.stopPrank();
    }

    function test_draw_revertsAboveDailyCapThenResets() public {
        for (uint256 i; i < 20; i++) {
            vm.prank(agent);
            vault.draw(1e18);
            spend(agent, 1e18);
        }
        vm.prank(agent);
        vm.expectRevert(BanQorVault.DailyCapExceeded.selector);
        vault.draw(1);

        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vault.draw(1e18);
        assertEq(vault.agents(agent).spentInWindow, 1e18);
        assertEq(vault.agents(agent).windowStart, block.timestamp);
    }

    function test_draw_revertsWhenBorrowWouldBreachFloor() public {
        vm.prank(owner);
        vault.sweep(owner, MIN_NET_DEBT); // force a borrow
        // ICR 300% -> ~201%: still above floor, but a borrow of 11 MUSD pushes it under
        pf.setPrice((PRICE * 2005) / 3000);
        vm.prank(agent);
        vm.expectRevert(BanQorVault.IcrTooLow.selector);
        vault.draw(1e18);
    }

    function test_draw_revertsBelowFloorEvenWithoutBorrow() public {
        pf.setPrice((PRICE * 1900) / 3000); // ICR ~190%
        vm.prank(agent);
        vm.expectRevert(BanQorVault.IcrTooLow.selector);
        vault.draw(1e18);
    }

    function test_draw_revertsWhenLineNotOpen() public {
        mezo.forceClose(address(vault), 3); // liquidated
        vm.prank(agent);
        vm.expectRevert(BanQorVault.LineNotOpen.selector);
        vault.draw(1e18);
    }

    function test_draw_minimumFloorStillBlocksNearLiquidation() public {
        vm.prank(owner);
        vault.sweep(owner, MIN_NET_DEBT);
        vm.prank(owner);
        vault.setIcrFloor(15000);
        // ICR ~111%: just above Mezo's 110% MCR, but below even the lowest allowed floor (150%)
        pf.setPrice((PRICE * 1110) / 3000);
        vm.prank(agent);
        vm.expectRevert(BanQorVault.IcrTooLow.selector);
        vault.draw(1e18);
    }
}

contract BanQorVaultRebalanceTest is VaultFixture {
    function setUp() public override {
        super.setUp();
        openLine(MIN_NET_DEBT + 500e18, 30000);
    }

    function test_rebalance_revertsWhenHealthy() public {
        vm.expectRevert(BanQorVault.NothingToRebalance.selector);
        vault.rebalance(address(0), address(0));
    }

    function test_rebalance_repaysIdleMusdKeepingMinDebt() public {
        pf.setPrice((PRICE * 1500) / 3000); // ICR ~150%: restoring 210% needs more than the min-debt headroom
        uint256 icrBefore = vault.lineStatus().icrBps;
        uint256 debtBefore = vault.lineStatus().debt;
        uint256 maxRepay = debtBefore - GAS_COMP - MIN_NET_DEBT;

        vm.prank(stranger); // anyone can call
        vault.rebalance(address(0), address(0));

        LineStatus memory st = vault.lineStatus();
        assertEq(st.debt, debtBefore - maxRepay);
        assertEq(st.debt - GAS_COMP, MIN_NET_DEBT);
        assertGt(st.icrBps, icrBefore);
    }

    function test_rebalance_limitedByIdleMusd() public {
        vm.prank(owner);
        vault.sweep(owner, MIN_NET_DEBT + 480e18); // vault keeps 20
        pf.setPrice((PRICE * 2050) / 3000);
        uint256 debtBefore = vault.lineStatus().debt;
        vm.expectEmit(false, false, false, false);
        emit BanQorVault.Rebalanced(0, 0, 0);
        vault.rebalance(address(0), address(0));
        assertEq(vault.lineStatus().debt, debtBefore - 20e18);
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    function test_rebalance_revertsWithNoIdleMusd() public {
        vm.prank(owner);
        vault.sweep(owner, MIN_NET_DEBT + 500e18);
        pf.setPrice((PRICE * 2050) / 3000);
        vm.expectRevert(BanQorVault.NothingToRebalance.selector);
        vault.rebalance(address(0), address(0));
    }

    function test_rebalance_revertsAtMinDebt() public {
        uint256 excess = 500e18 + mezo.getBorrowingFee(MIN_NET_DEBT + 500e18);
        vm.prank(owner);
        vault.repay(excess, address(0), address(0));
        pf.setPrice((PRICE * 2050) / 3000);
        vm.expectRevert(BanQorVault.NothingToRebalance.selector);
        vault.rebalance(address(0), address(0));
    }

    function test_rebalance_includesInterest() public {
        mezo.accrueInterest(address(vault), 30e18);
        pf.setPrice((PRICE * 1500) / 3000);
        uint256 debtBefore = vault.lineStatus().debt;
        vault.rebalance(address(0), address(0));
        assertEq(vault.lineStatus().debt, GAS_COMP + MIN_NET_DEBT);
        assertLt(vault.lineStatus().debt, debtBefore);
    }
}

contract BanQorVaultViewsTest is VaultFixture {
    function setUp() public override {
        super.setUp();
        openLine(MIN_NET_DEBT, 30000);
        setAgent(agent, demoPolicy());
    }

    function test_agentStatus() public {
        vm.prank(agent);
        vault.draw(1e18);
        AgentStatus memory st = vault.agentStatus(agent);
        assertEq(st.spentInWindow, 1e18);
        assertEq(st.windowResetsAt, block.timestamp + 1 days);
        assertEq(st.agentBalance, 1e18);
        assertEq(st.drawableNow, 1e18);
        assertTrue(st.policy.active);

        vm.warp(block.timestamp + 1 days);
        st = vault.agentStatus(agent);
        assertEq(st.spentInWindow, 0);
        assertEq(st.windowResetsAt, block.timestamp);
    }

    function test_maxDrawable_policyLimits() public {
        assertEq(vault.maxDrawable(agent), 1e18);
        vm.prank(agent);
        vault.draw(1e18);
        assertEq(vault.maxDrawable(agent), 1e18);
        vm.prank(agent);
        vault.draw(1e18);
        assertEq(vault.maxDrawable(agent), 0); // float full
        assertEq(vault.maxDrawable(stranger), 0);
        vm.prank(owner);
        vault.pause();
        spend(agent, 2e18);
        assertEq(vault.maxDrawable(agent), 0);
    }

    function test_maxDrawable_icrLimited_isDrawable() public {
        Policy memory p = demoPolicy();
        p.maxDrawPerTx = 1000e18;
        p.maxFloat = 1000e18;
        p.dailyCap = 1000e18;
        setAgent(agent, p);
        vm.prank(owner);
        vault.sweep(owner, MIN_NET_DEBT);
        pf.setPrice((PRICE * 2100) / 3000); // ~210%: some headroom left

        uint256 m = vault.maxDrawable(agent);
        assertGt(m, 0);
        assertLt(m, 1000e18);
        vm.prank(agent);
        vault.draw(m);
        assertGe(vault.lineStatus().icrBps, FLOOR);
    }

    function test_maxDrawable_zeroBelowFloor() public {
        pf.setPrice((PRICE * 1900) / 3000);
        assertEq(vault.maxDrawable(agent), 0);
    }

    function test_lineStatus_noDebt() public {
        vm.prank(stranger);
        BanQorVault v = BanQorVault(payable(factory.createVault()));
        LineStatus memory st = v.lineStatus();
        assertEq(st.icrBps, type(uint256).max);
        assertFalse(st.lineOpen);
        assertEq(st.troveStatus, 0);
    }

    function test_receive() public {
        (bool ok,) = address(vault).call{value: 1}("");
        assertTrue(ok);
    }
}

/// Owner contract that tries to re-enter the vault when it receives BTC.
contract ReentrantOwner {
    BanQorVault public vault;
    bool public reentered;

    function createVault(BanQorFactory f) external {
        vault = BanQorVault(payable(f.createVault()));
    }

    function open(uint256 debt) external payable {
        vault.openLine{value: msg.value}(debt, address(0), address(0));
    }

    function withdraw(uint256 amt) external {
        vault.withdrawCollateral(amt, address(0), address(0));
    }

    receive() external payable {
        if (address(vault) != address(0) && vault.lineOpen()) {
            reentered = true;
            vault.pause(); // any nonReentrant function
        }
    }
}

contract BanQorVaultCoverageTest is VaultFixture {
    function test_lineNotOpen_onAllLinePaths() public {
        vm.startPrank(owner);
        vm.expectRevert(BanQorVault.LineNotOpen.selector);
        vault.withdrawCollateral(1, address(0), address(0));
        vm.expectRevert(BanQorVault.LineNotOpen.selector);
        vault.repay(1, address(0), address(0));
        vm.stopPrank();
        vm.expectRevert(BanQorVault.LineNotOpen.selector);
        vault.rebalance(address(0), address(0));
    }

    function test_drawChecksPausedBeforeLine() public {
        setAgent(agent, demoPolicy());
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(BanQorVault.ErrPaused.selector); // line is not open, but paused is reported first
        vault.draw(1e18);
    }

    function test_withdrawCollateral_emits() public {
        openLine(MIN_NET_DEBT, 30000);
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.CollateralWithdrawn(0.001 ether);
        vm.prank(owner);
        vault.withdrawCollateral(0.001 ether, address(0), address(0));
    }

    function test_rebalance_emitsArgs() public {
        openLine(MIN_NET_DEBT + 500e18, 30000);
        pf.setPrice((PRICE * 1500) / 3000);
        uint256 icrBefore = vault.lineStatus().icrBps;
        uint256 debt = vault.lineStatus().debt;
        uint256 repayAmt = debt - GAS_COMP - MIN_NET_DEBT;
        uint256 coll = vault.lineStatus().coll;
        uint256 icrAfter = (coll * pf.price() * 10_000) / ((debt - repayAmt) * 1e18);
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.Repaid(repayAmt);
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.Rebalanced(repayAmt, icrBefore, icrAfter);
        vault.rebalance(address(0), address(0));
    }

    function test_rebalance_leavesPendingRedistributionOut() public {
        openLine(MIN_NET_DEBT + 500e18, 30000);
        mezo.setPending(0, 40e18, 2e18);
        pf.setPrice((PRICE * 1500) / 3000);
        uint256 stored = MIN_NET_DEBT + 500e18 + mezo.getBorrowingFee(MIN_NET_DEBT + 500e18) + GAS_COMP;
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.Repaid(stored - GAS_COMP - MIN_NET_DEBT);
        vault.rebalance(address(0), address(0)); // would revert in Mezo if pending were counted as repayable
    }

    function test_rebalance_repaysOnlyWhatRestoresTarget() public {
        openLine(MIN_NET_DEBT + 500e18, 30000);
        pf.setPrice((PRICE * 2050) / 3000); // ~205%, target 210%
        uint256 floatBefore = musd.balanceOf(address(vault));
        vm.prank(stranger);
        vault.rebalance(address(0), address(0));
        LineStatus memory st = vault.lineStatus();
        assertGe(st.icrBps, uint256(FLOOR) + REBAL_BUF, "back at floor + buffer");
        assertLt(st.icrBps, uint256(FLOOR) + REBAL_BUF + 5, "and not far above it");
        assertGt(st.vaultFloat, floatBefore / 2, "most of the agents' float is kept");
        // a second call has nothing to do, so it can't be used to drain the float
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NothingToRebalance.selector);
        vault.rebalance(address(0), address(0));
    }

    function test_claimCollateral_afterRedemption() public {
        openLine(MIN_NET_DEBT, 30000);
        vm.deal(address(mezo), 1 ether);
        mezo.forceRedeemWithSurplus(address(vault), 0.02 ether);
        uint256 bal = owner.balance;
        vm.expectEmit(false, false, false, true);
        emit BanQorVault.CollateralClaimed(0.02 ether);
        vm.prank(owner);
        vault.claimCollateral();
        assertEq(owner.balance, bal + 0.02 ether);
        // nothing left: Mezo reverts
        vm.prank(owner);
        vm.expectRevert(bytes("CollSurplusPool: No collateral available to claim"));
        vault.claimCollateral();
        vm.prank(stranger);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.claimCollateral();
    }

    function test_window_doesNotResetEarly_andIsFixed() public {
        openLine(MIN_NET_DEBT, 30000);
        setAgent(agent, demoPolicy());
        uint256 start = block.timestamp;
        for (uint256 i; i < 20; i++) {
            vm.prank(agent);
            vault.draw(1e18);
            spend(agent, 1e18);
            vm.warp(block.timestamp + 1 hours); // spread over the window: not a rolling window
        }
        vm.warp(start + 1 days - 1);
        vm.prank(agent);
        vm.expectRevert(BanQorVault.DailyCapExceeded.selector);
        vault.draw(1);
        vm.warp(start + 1 days);
        vm.prank(agent);
        vault.draw(1e18);
    }

    function test_maxDrawable_branches() public {
        openLine(MIN_NET_DEBT, 30000);
        Policy memory p = demoPolicy();
        p.maxDrawPerTx = 100e18;
        p.maxFloat = 100e18;
        p.dailyCap = 100e18;
        setAgent(agent, p);

        // expired
        vm.warp(p.expiry);
        assertEq(vault.maxDrawable(agent), 0);
        p.expiry = 0;
        setAgent(agent, p);

        // borrow needed but no headroom: ICR just above floor
        vm.prank(owner);
        vault.sweep(owner, MIN_NET_DEBT - 1e18);
        pf.setPrice((PRICE * 20001) / 30000);
        assertEq(vault.maxDrawable(agent), 1e18, "only vault float, borrow headroom below buffer");

        // closed line
        mezo.forceClose(address(vault), 3);
        assertEq(vault.maxDrawable(agent), 0);
    }

    function test_factoryGetters() public view {
        assertEq(factory.mezo().troveManager, address(mezo));
        assertEq(factory.mezo().priceFeed, address(pf));
        assertEq(factory.defaults().icrFloorBps, FLOOR);
        assertEq(factory.defaults().hintTrials, TRIALS);
    }

    function test_createVault_emitsVaultAddress() public {
        vm.prank(stranger);
        address v = factory.createVault();
        assertEq(factory.vaultOf(stranger), v);
        assertEq(BanQorVault(payable(v)).owner(), stranger);
    }

    function test_reentrancy_blockedOnBtcSend() public {
        ReentrantOwner ro = new ReentrantOwner();
        ro.createVault(factory);
        uint256 coll = collFor(MIN_NET_DEBT, 30000);
        vm.deal(address(this), coll);
        ro.open{value: coll}(MIN_NET_DEBT);
        // re-entry inside receive() hits nonReentrant, so the BTC send fails and the whole tx reverts
        vm.expectRevert(BanQorVault.BtcTransferFailed.selector);
        ro.withdraw(0.001 ether);
        assertFalse(ro.vault().paused());
    }
}
