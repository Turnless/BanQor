// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Subset of Mezo MUSD BorrowerOperations used by BanQor.
/// Signatures taken from the verified implementation on Mezo testnet
/// (proxy 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5).
interface IBorrowerOperations {
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;
    function addColl(address _upperHint, address _lowerHint) external payable;
    function withdrawColl(uint256 _amount, address _upperHint, address _lowerHint) external;
    function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;
    function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;
    function closeTrove() external;
    /// Sends the caller's CollSurplusPool balance (left after a redemption or recovery-mode liquidation) to the caller.
    function claimCollateral() external;
    function getBorrowingFee(uint256 _debt) external view returns (uint256);
    function minNetDebt() external view returns (uint256);
    function MUSD_GAS_COMPENSATION() external view returns (uint256);
}
