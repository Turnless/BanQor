// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IPriceFeed {
    /// @return BTC/USD price with 18 decimals
    function fetchPrice() external view returns (uint256);
}
