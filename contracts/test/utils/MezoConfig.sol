// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";

struct MezoAddrs {
    uint256 chainId;
    address musd;
    address borrowerOperations;
    address troveManager;
    address hintHelpers;
    address sortedTroves;
    address priceFeed;
}

/// Reads Mezo addresses from deployments/<CHAIN_ID>.json so nothing is hard-coded in tests or scripts.
abstract contract MezoConfig {
    Vm private constant _vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function deploymentsPath() internal view returns (string memory) {
        uint256 id = _vm.envOr("CHAIN_ID", uint256(31611));
        return string.concat(_vm.projectRoot(), "/../deployments/", _vm.toString(id), ".json");
    }

    function loadMezo() internal view returns (MezoAddrs memory m) {
        string memory json = _vm.readFile(deploymentsPath());
        m.chainId = _vm.parseJsonUint(json, ".chainId");
        m.musd = _vm.parseJsonAddress(json, ".mezo.musd");
        m.borrowerOperations = _vm.parseJsonAddress(json, ".mezo.borrowerOperations");
        m.troveManager = _vm.parseJsonAddress(json, ".mezo.troveManager");
        m.hintHelpers = _vm.parseJsonAddress(json, ".mezo.hintHelpers");
        m.sortedTroves = _vm.parseJsonAddress(json, ".mezo.sortedTroves");
        m.priceFeed = _vm.parseJsonAddress(json, ".mezo.priceFeed");
    }

    /// Mezo's PriceFeed reads an oracle precompile that a local fork cannot execute.
    /// Fetch the live price from the forked node over RPC and mock fetchPrice() with it.
    function mockLivePrice(address priceFeed) internal returns (uint256 price) {
        string memory data = _vm.toString(abi.encodeCall(IPriceFeed.fetchPrice, ()));
        string memory params =
            string.concat('[{"to":"', _vm.toString(priceFeed), '","data":"', data, '"},"latest"]');
        price = abi.decode(_vm.rpc("eth_call", params), (uint256));
        setMockPrice(priceFeed, price);
    }

    function setMockPrice(address priceFeed, uint256 price) internal {
        _vm.mockCall(priceFeed, abi.encodeCall(IPriceFeed.fetchPrice, ()), abi.encode(price));
    }
}
