// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISortedTroves {
    function findInsertPosition(uint256 _NICR, address _prevId, address _nextId)
        external
        view
        returns (address, address);
}
