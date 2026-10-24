// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Subset of Mezo MUSD TroveManager used by BanQor.
interface ITroveManager {
    /// Status enum on Mezo: 0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption
    function getTroveStatus(address _borrower) external view returns (uint8);
    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);
    function getEntireDebtAndColl(address _borrower)
        external
        view
        returns (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingCollateral,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        );
}
