// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interfaces/IERC20.sol";

/**
 * SafeTransfer — minimal SafeERC20 equivalent (no external dependency).
 *
 * Accepts tokens that return `true`, and tokens that return nothing (legacy
 * ERC-20s); reverts on a `false` return, a revert, or a call to a non-contract.
 */
library SafeTransfer {
    error SafeTransferFailed();

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
    }

    function _call(IERC20 token, bytes memory data) private {
        if (address(token).code.length == 0) revert SafeTransferFailed();
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok) revert SafeTransferFailed();
        if (ret.length != 0 && !abi.decode(ret, (bool))) revert SafeTransferFailed();
    }
}
