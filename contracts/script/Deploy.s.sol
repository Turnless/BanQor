// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {BanQorFactory} from "../src/BanQorFactory.sol";
import {MezoContracts, VaultConfig} from "../src/BanQorTypes.sol";
import {MezoConfig, MezoAddrs} from "../test/utils/MezoConfig.sol";

/// Deploys BanQorFactory.
///
///   pnpm contracts:deploy        (loads OWNER_KEY and MEZO_RPC from the repo-root .env)
///
/// The address is recorded in deployments/<CHAIN_ID>.json afterwards by scripts/record-deploy.mjs, which reads
/// the broadcast receipt and checks the code exists on-chain (writing here would also run when broadcast fails).
///
/// Vault defaults come from env (all optional):
///   DEPLOY_ICR_FLOOR_BPS (20000), DEPLOY_REBALANCE_BUFFER_BPS (1000),
///   DEPLOY_BORROW_BUFFER_WEI (5e18), DEPLOY_HINT_TRIALS (15)
contract Deploy is Script, MezoConfig {
    function run() external returns (BanQorFactory factory) {
        MezoAddrs memory m = loadMezo();
        require(block.chainid == m.chainId, "chain id does not match deployments file");

        uint256 floor = vm.envOr("DEPLOY_ICR_FLOOR_BPS", uint256(20000));
        uint256 rebal = vm.envOr("DEPLOY_REBALANCE_BUFFER_BPS", uint256(1000));
        uint256 buffer = vm.envOr("DEPLOY_BORROW_BUFFER_WEI", uint256(5e18));
        uint256 trials = vm.envOr("DEPLOY_HINT_TRIALS", uint256(15));
        require(floor <= type(uint16).max && rebal <= type(uint16).max, "bps value out of range");
        require(buffer <= type(uint128).max && trials <= type(uint32).max, "value out of range");
        VaultConfig memory cfg = VaultConfig({
            icrFloorBps: uint16(floor),
            rebalanceBufferBps: uint16(rebal),
            borrowBuffer: uint128(buffer),
            hintTrials: uint32(trials)
        });
        MezoContracts memory mc =
            MezoContracts(m.musd, m.borrowerOperations, m.troveManager, m.hintHelpers, m.sortedTroves, m.priceFeed);

        vm.startBroadcast(vm.envUint("OWNER_KEY"));
        factory = new BanQorFactory(mc, cfg);
        vm.stopBroadcast();

        console2.log("BanQorFactory", address(factory));
    }
}
