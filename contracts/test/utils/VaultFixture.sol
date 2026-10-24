// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BanQorFactory} from "../../src/BanQorFactory.sol";
import {BanQorVault} from "../../src/BanQorVault.sol";
import {MezoContracts, VaultConfig, Policy} from "../../src/BanQorTypes.sol";
import {MockMUSD, MockPriceFeed, MockMezo} from "../mocks/MezoMocks.sol";

/// Shared setup for unit and fuzz tests, using mock Mezo contracts with Mezo's testnet parameters.
abstract contract VaultFixture is Test {
    uint256 internal constant PRICE = 80_000e18;
    uint256 internal constant MIN_NET_DEBT = 1800e18;
    uint256 internal constant GAS_COMP = 200e18;
    uint256 internal constant FEE_BPS = 10; // 0.1%, as read from testnet

    uint16 internal constant FLOOR = 20000;
    uint16 internal constant REBAL_BUF = 1000;
    uint128 internal constant BORROW_BUF = 10e18;
    uint32 internal constant TRIALS = 15;

    MockMUSD internal musd;
    MockPriceFeed internal pf;
    MockMezo internal mezo;
    BanQorFactory internal factory;
    BanQorVault internal vault;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal stranger = makeAddr("stranger");

    function setUp() public virtual {
        musd = new MockMUSD();
        pf = new MockPriceFeed(PRICE);
        mezo = new MockMezo(musd, pf, MIN_NET_DEBT, GAS_COMP, FEE_BPS);
        musd.setMinter(address(mezo));
        factory = new BanQorFactory(mezoContracts(), VaultConfig(FLOOR, REBAL_BUF, BORROW_BUF, TRIALS));
        vm.prank(owner);
        vault = BanQorVault(payable(factory.createVault()));
        vm.deal(owner, 100 ether);
    }

    function mezoContracts() internal view returns (MezoContracts memory) {
        return MezoContracts(address(musd), address(mezo), address(mezo), address(mezo), address(mezo), address(pf));
    }

    /// Collateral giving `icrBps` on a fresh trove that borrows `debt`.
    function collFor(uint256 debt, uint256 icrBps) internal view returns (uint256) {
        uint256 composite = debt + mezo.getBorrowingFee(debt) + GAS_COMP;
        return (composite * icrBps * 1e14) / PRICE + 1;
    }

    function openLine(uint256 debt, uint256 icrBps) internal {
        uint256 coll = collFor(debt, icrBps);
        vm.prank(owner);
        vault.openLine{value: coll}(debt, address(0), address(0));
    }

    function demoPolicy() internal view returns (Policy memory) {
        return Policy({
            dailyCap: 20e18,
            maxFloat: 2e18,
            maxDrawPerTx: 1e18,
            expiry: uint64(block.timestamp + 30 days),
            active: true
        });
    }

    function setAgent(address a, Policy memory p) internal {
        vm.prank(owner);
        vault.setAgent(a, p);
    }

    /// Agent spends its float (simulates x402 payments leaving the agent).
    function spend(address a, uint256 amt) internal {
        vm.prank(a);
        musd.transfer(makeAddr("payee"), amt);
    }
}
