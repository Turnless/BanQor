// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultFixture} from "./utils/VaultFixture.sol";
import {BanQorVault} from "../src/BanQorVault.sol";
import {Policy, AgentState, LineStatus} from "../src/BanQorTypes.sol";
import {MockMUSD, MockPriceFeed} from "./mocks/MezoMocks.sol";

/// Stateless fuzz tests.
contract BanQorVaultFuzzTest is VaultFixture {
    function setUp() public override {
        super.setUp();
        openLine(MIN_NET_DEBT, 30000);
    }

    /// A draw either succeeds within every limit or reverts; it never breaks a limit.
    function testFuzz_drawRespectsPolicy(uint128 cap, uint128 maxFloat, uint128 maxDraw, uint256 amount) public {
        cap = uint128(bound(cap, 1, 100e18));
        maxFloat = uint128(bound(maxFloat, 1, 100e18));
        maxDraw = uint128(bound(maxDraw, 1, 100e18));
        amount = bound(amount, 1, 200e18);
        setAgent(agent, Policy(cap, maxFloat, maxDraw, 0, true));

        vm.prank(agent);
        try vault.draw(amount) {
            assertLe(amount, maxDraw);
            assertLe(vault.agents(agent).spentInWindow, cap);
            assertLe(musd.balanceOf(agent), maxFloat);
        } catch {
            assertTrue(amount > maxDraw || amount > cap || amount > maxFloat, "valid draw reverted");
        }
    }

    /// After any successful draw that borrowed, ICR >= floor, for any price and floor.
    function testFuzz_borrowNeverBreachesFloor(uint256 priceBps, uint16 floor, uint256 amount) public {
        floor = uint16(bound(floor, vault.MIN_FLOOR_BPS(), 40000));
        vm.prank(owner);
        vault.setIcrFloor(floor);
        Policy memory p = Policy(type(uint128).max, type(uint128).max, type(uint128).max, 0, true);
        setAgent(agent, p);
        vm.prank(owner);
        vault.sweep(owner, MIN_NET_DEBT); // every draw must borrow
        pf.setPrice((PRICE * bound(priceBps, 3000, 30000)) / 10_000);
        amount = bound(amount, 1, 5000e18);

        vm.prank(agent);
        try vault.draw(amount) {
            assertGe(vault.lineStatus().icrBps, floor);
        } catch {}
    }

    /// maxDrawable() is always drawable (when > 0).
    function testFuzz_maxDrawableIsDrawable(uint256 priceBps, uint256 sweepAmt) public {
        Policy memory p = Policy(5000e18, 5000e18, 5000e18, 0, true);
        setAgent(agent, p);
        vm.prank(owner);
        vault.sweep(owner, bound(sweepAmt, 1, MIN_NET_DEBT));
        pf.setPrice((PRICE * bound(priceBps, 5000, 20000)) / 10_000);
        uint256 m = vault.maxDrawable(agent);
        if (m == 0) return;
        vm.prank(agent);
        vault.draw(m);
    }

    /// No address other than the owner can change policy, collateral, debt or pause state.
    function testFuzz_ownerOnly(address caller) public {
        vm.assume(caller != owner);
        Policy memory p = demoPolicy();
        vm.deal(caller, 1 ether);
        vm.startPrank(caller);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.setAgent(caller, p);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.revokeAgent(agent);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.pause();
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.unpause();
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.setIcrFloor(30000);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.setBorrowBuffer(0);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.addCollateral{value: 1}(address(0), address(0));
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.withdrawCollateral(1, address(0), address(0));
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.repay(1, address(0), address(0));
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.sweep(caller, 1);
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.closeLine();
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.openLine{value: 1}(1, address(0), address(0));
        vm.expectRevert(BanQorVault.NotOwner.selector);
        vault.claimCollateral();
        vm.stopPrank();
    }
}

/// Drives random agent draws, spending, time, price and owner actions for invariant tests.
contract VaultHandler is Test {
    BanQorVault public immutable vault;
    MockMUSD public immutable musd;
    MockPriceFeed public immutable pf;
    address public immutable owner;
    uint256 public immutable basePrice;
    address public immutable sink = makeAddr("sink");
    address[] public actors;

    uint256 public borrowsBelowFloor;
    uint256 public nonOwnerSuccesses;
    uint256 public withdrawsBelowFloor;
    uint256 public rebalancesBelowMinDebt;
    uint256 public totalDrawn;
    uint256 public immutable minDebtFloor;

    constructor(BanQorVault v, MockMUSD m, MockPriceFeed p, address o, address[] memory a, uint256 _minDebtFloor) {
        minDebtFloor = _minDebtFloor;
        vault = v;
        musd = m;
        pf = p;
        owner = o;
        basePrice = p.price();
        actors = a;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function draw(uint256 who, uint256 amount) external {
        address a = actors[who % actors.length];
        amount = bound(amount, 1, 3e18);
        uint256 debtBefore = vault.lineStatus().debt;
        vm.prank(a);
        try vault.draw(amount) {
            totalDrawn += amount;
            LineStatus memory st = vault.lineStatus();
            if (st.debt > debtBefore && st.icrBps < st.icrFloorBps) borrowsBelowFloor++;
        } catch {}
    }

    function spend(uint256 who, uint256 amount) external {
        address a = actors[who % actors.length];
        amount = bound(amount, 0, musd.balanceOf(a));
        vm.prank(a);
        musd.transfer(sink, amount);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    function movePrice(uint256 bps) external {
        pf.setPrice((basePrice * bound(bps, 5000, 15000)) / 10_000);
    }

    function togglePause(bool on) external {
        vm.prank(owner);
        if (on) vault.pause();
        else vault.unpause();
    }

    function sweepToOwner(uint256 amount) external {
        amount = bound(amount, 0, musd.balanceOf(address(vault)));
        if (amount == 0) return;
        vm.prank(owner);
        vault.sweep(owner, amount);
    }

    function withdrawCollateral(uint256 amount) external {
        amount = bound(amount, 1, vault.lineStatus().coll / 4 + 1);
        vm.prank(owner);
        try vault.withdrawCollateral(amount, address(0), address(0)) {
            LineStatus memory st = vault.lineStatus();
            if (st.icrBps < st.icrFloorBps) withdrawsBelowFloor++;
        } catch {}
    }

    function rebalance() external {
        try vault.rebalance(address(0), address(0)) {
            if (vault.lineStatus().debt < minDebtFloor) rebalancesBelowMinDebt++;
        } catch {}
    }

    function strangerAttack(address caller, uint256 amount) external {
        if (caller == owner) return;
        vm.startPrank(caller);
        try vault.sweep(caller, bound(amount, 1, 1e18)) {
            nonOwnerSuccesses++;
        } catch {}
        try vault.pause() {
            nonOwnerSuccesses++;
        } catch {}
        try vault.setAgent(caller, Policy(type(uint128).max, type(uint128).max, type(uint128).max, 0, true)) {
            nonOwnerSuccesses++;
        } catch {}
        try vault.repay(bound(amount, 1, 1e18), address(0), address(0)) {
            nonOwnerSuccesses++;
        } catch {}
        vm.stopPrank();
    }
}

contract BanQorVaultInvariantTest is VaultFixture {
    VaultHandler internal handler;
    address[] internal actors;

    function setUp() public override {
        super.setUp();
        openLine(MIN_NET_DEBT, 30000);
        actors.push(makeAddr("a1"));
        actors.push(makeAddr("a2"));
        actors.push(makeAddr("unregistered"));
        setAgent(actors[0], Policy(20e18, 2e18, 1e18, 0, true));
        setAgent(actors[1], Policy(50e18, 5e18, 3e18, 0, true));
        handler = new VaultHandler(vault, musd, pf, owner, actors, MIN_NET_DEBT + GAS_COMP);
        targetContract(address(handler));
    }

    /// 1. spentInWindow <= dailyCap for every agent
    function invariant_spentWithinCap() public view {
        for (uint256 i; i < actors.length; i++) {
            AgentState memory s = vault.agents(actors[i]);
            assertLe(s.spentInWindow, s.policy.dailyCap);
        }
    }

    /// 2. after any successful borrowing draw, ICR >= floor
    function invariant_borrowAboveFloor() public view {
        assertEq(handler.borrowsBelowFloor(), 0);
    }

    /// 3. a non-owner never changes owner-controlled state
    function invariant_ownerOnly() public view {
        assertEq(handler.nonOwnerSuccesses(), 0);
        assertEq(vault.agentList().length, 2);
    }

    /// FR-C7: withdrawCollateral never leaves the trove below the floor
    function invariant_withdrawAboveFloor() public view {
        assertEq(handler.withdrawsBelowFloor(), 0);
    }

    /// FR-C8: rebalance never repays below the protocol minimum debt
    function invariant_rebalanceKeepsMinDebt() public view {
        assertEq(handler.rebalancesBelowMinDebt(), 0);
        assertGe(vault.lineStatus().debt, MIN_NET_DEBT + GAS_COMP);
    }

    /// Agents (and their payees) only ever received MUSD through successful draws.
    function invariant_agentsFundedOnlyByDraw() public view {
        uint256 held = musd.balanceOf(actors[0]) + musd.balanceOf(actors[1]) + musd.balanceOf(handler.sink());
        assertEq(held, handler.totalDrawn());
    }

    /// 4. MUSD only leaves the vault via draw (to registered agents) or owner actions:
    /// every MUSD in existence sits in the vault, a registered agent, the agents' payees, or the owner.
    function invariant_musdConservation() public view {
        uint256 accounted = musd.balanceOf(address(vault)) + musd.balanceOf(actors[0]) + musd.balanceOf(actors[1])
            + musd.balanceOf(handler.sink()) + musd.balanceOf(owner);
        assertEq(accounted, musd.totalSupply());
        assertEq(musd.balanceOf(actors[2]), 0, "unregistered agent never receives MUSD");
    }
}
