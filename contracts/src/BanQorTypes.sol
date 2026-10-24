// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Lowest ICR floor an owner may set (150%, Mezo's critical collateral ratio).
uint16 constant MIN_ICR_FLOOR_BPS = 15000;

/// @notice Addresses of the Mezo MUSD system a vault talks to.
struct MezoContracts {
    address musd;
    address borrowerOperations;
    address troveManager;
    address hintHelpers;
    address sortedTroves;
    address priceFeed;
}

/// @notice Defaults the factory hands to every new vault.
struct VaultConfig {
    /// Initial ICR floor in basis points (20000 = 200%). Owner can change it later (>= MIN_FLOOR_BPS).
    uint16 icrFloorBps;
    /// rebalance() is allowed while ICR < icrFloorBps + rebalanceBufferBps.
    uint16 rebalanceBufferBps;
    /// Extra MUSD borrowed on top of a draw's shortfall, so the vault doesn't borrow on every draw.
    uint128 borrowBuffer;
    /// Trials passed to HintHelpers.getApproxHint when draw() borrows.
    uint32 hintTrials;
}

/// @notice Per-agent spending rules. All MUSD amounts have 18 decimals.
struct Policy {
    uint128 dailyCap;
    uint128 maxFloat;
    uint128 maxDrawPerTx;
    /// Unix seconds; 0 = never expires.
    uint64 expiry;
    bool active;
}

struct AgentState {
    Policy policy;
    uint128 spentInWindow;
    /// Start of the current 24h window. 0 means the address was never registered.
    uint64 windowStart;
}

struct LineStatus {
    bool lineOpen;
    uint8 troveStatus;
    uint256 coll;
    uint256 debt;
    /// type(uint256).max when there is no debt
    uint256 icrBps;
    uint256 price;
    uint256 vaultFloat;
    bool paused;
    uint16 icrFloorBps;
}

struct AgentStatus {
    Policy policy;
    uint256 spentInWindow;
    uint256 windowResetsAt;
    uint256 agentBalance;
    uint256 drawableNow;
}
