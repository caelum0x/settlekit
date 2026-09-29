// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Yield adapter surface used by OperatorVault's YIELD sleeve (e.g. a USYC
 * adapter on Arc). The vault pushes USDC to the adapter and then calls
 * `deposit`; `redeem` sends USDC back to `to`. The vault measures the USDC it
 * actually receives (balance delta), so an adapter cannot inflate the bucket.
 */
interface IYieldAdapter {
    /// Notify the adapter that `usdcAmount` was transferred to it; returns shares minted.
    function deposit(uint256 usdcAmount) external returns (uint256 shares);

    /// Redeem enough position to send `usdcAmount` USDC to `to`; returns USDC sent.
    function redeem(uint256 usdcAmount, address to) external returns (uint256 usdcOut);

    /// Current USDC value of `holder`'s position.
    function totalValue(address holder) external view returns (uint256);
}
