// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BanQorVault} from "./BanQorVault.sol";
import {MezoContracts, VaultConfig, MIN_ICR_FLOOR_BPS} from "./BanQorTypes.sol";

/// @title BanQorFactory
/// @notice Deploys one BanQorVault per owner, wired to the Mezo MUSD system.
/// @dev Testnet, unaudited.
contract BanQorFactory {
    MezoContracts internal _mezo;
    VaultConfig internal _defaults;

    mapping(address => address) public vaultOf;
    address[] internal _vaults;

    event VaultCreated(address indexed owner, address vault);

    error VaultExists();

    constructor(MezoContracts memory mezo_, VaultConfig memory defaults_) {
        // Same checks the vault constructor makes, so a bad config fails at deploy time.
        if (
            mezo_.musd == address(0) || mezo_.borrowerOperations == address(0) || mezo_.troveManager == address(0)
                || mezo_.hintHelpers == address(0) || mezo_.sortedTroves == address(0) || mezo_.priceFeed == address(0)
        ) revert BanQorVault.ZeroAddress();
        if (defaults_.icrFloorBps < MIN_ICR_FLOOR_BPS) revert BanQorVault.FloorTooLow();
        _mezo = mezo_;
        _defaults = defaults_;
    }

    function createVault() external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert VaultExists();
        vault = address(new BanQorVault(msg.sender, _mezo, _defaults));
        vaultOf[msg.sender] = vault;
        _vaults.push(vault);
        emit VaultCreated(msg.sender, vault);
    }

    function mezo() external view returns (MezoContracts memory) {
        return _mezo;
    }

    function defaults() external view returns (VaultConfig memory) {
        return _defaults;
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaults(uint256 index) external view returns (address) {
        return _vaults[index];
    }
}
