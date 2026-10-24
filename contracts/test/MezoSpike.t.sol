// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";
import {MezoConfig, MezoAddrs} from "./utils/MezoConfig.sol";

/// Minimal contract borrower used to prove a contract can own a Mezo trove.
contract SpikeBorrower {
    IBorrowerOperations immutable bo;

    constructor(IBorrowerOperations _bo) {
        bo = _bo;
    }

    receive() external payable {}

    function open(uint256 debt) external payable {
        bo.openTrove{value: msg.value}(debt, address(0), address(0));
    }

    function borrow(uint256 amt) external {
        bo.withdrawMUSD(amt, address(0), address(0));
    }

    function repay(uint256 amt) external {
        bo.repayMUSD(amt, address(0), address(0));
    }
}

/// Day-0 spike: run with `forge test --match-contract MezoSpike --fork-url $MEZO_RPC`
contract MezoSpikeTest is Test, MezoConfig {
    function test_contractCanOpenBorrowRepay() public {
        MezoAddrs memory m = loadMezo();
        vm.skip(block.chainid != m.chainId);

        IBorrowerOperations bo = IBorrowerOperations(m.borrowerOperations);
        ITroveManager tm = ITroveManager(m.troveManager);
        uint256 price = mockLivePrice(m.priceFeed);
        uint256 minDebt = bo.minNetDebt();
        uint256 gasComp = bo.MUSD_GAS_COMPENSATION();

        // collateral for ~300% ICR on the composite debt
        uint256 coll = ((minDebt + gasComp) * 3e18) / price + 1;
        SpikeBorrower b = new SpikeBorrower(bo);
        vm.deal(address(this), coll);
        b.open{value: coll}(minDebt);

        assertEq(tm.getTroveStatus(address(b)), 1, "trove active");
        assertEq(IERC20(m.musd).balanceOf(address(b)), minDebt, "MUSD minted to contract");

        uint256 icrBefore = tm.getCurrentICR(address(b), price);
        b.borrow(10e18);
        assertEq(IERC20(m.musd).balanceOf(address(b)), minDebt + 10e18, "withdrawMUSD to contract");
        assertLt(tm.getCurrentICR(address(b), price), icrBefore, "ICR fell after borrow");

        b.repay(10e18);
        emit log_named_uint("borrowFee(1800e18)", bo.getBorrowingFee(minDebt));
        emit log_named_uint("ICR after repay (1e18)", tm.getCurrentICR(address(b), price));
    }
}
