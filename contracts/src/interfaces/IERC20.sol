// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/** Minimal ERC-20 surface used by the SettleKit contracts (USDC). */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
