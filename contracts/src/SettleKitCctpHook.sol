// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";
import {IMessageHandlerV2} from "./interfaces/IMessageHandlerV2.sol";

/**
 * SettleKitCctpHook — atomic "credit the merchant on cross-chain mint".
 *
 * Deploy this as the CCTP `mintRecipient`. A pay-in burned on the source chain
 * with `depositForBurnWithHook(..., hookData)` mints USDC to this contract on
 * Arc; `MessageTransmitterV2` then calls a handler here with the burn message
 * body. We decode the trailing `hookData` as `(address merchant, bytes32 orderId)`
 * and forward the freshly-minted USDC to the merchant, emitting an event the
 * SettleKit backend (or the arc-indexer) settles the order from.
 *
 * The amount forwarded is this contract's USDC balance (which equals the minted
 * amount, since the contract holds funds only transiently per settlement) — so
 * we never depend on parsing the amount field, only the trailing hookData.
 *
 * BurnMessageV2 layout (CCTP V2): version(4) | burnToken(32) | mintRecipient(32)
 * | amount(32) | messageSender(32) | maxFee(32) | feeExecuted(32) |
 * expirationBlock(32) | hookData(dynamic). hookData therefore begins at byte 228.
 */
contract SettleKitCctpHook is IMessageHandlerV2 {
    /// Byte offset of `hookData` within a BurnMessageV2 body.
    uint256 internal constant HOOK_DATA_OFFSET = 228;

    /// The local CCTP MessageTransmitterV2 allowed to call the handlers.
    address public immutable messageTransmitter;
    /// The USDC token minted to this contract.
    IERC20 public immutable usdc;

    event OrderSettled(
        bytes32 indexed orderId,
        address indexed merchant,
        uint256 amount,
        uint32 sourceDomain
    );

    error NotMessageTransmitter();
    error NoHookData();
    error TransferFailed();

    constructor(address messageTransmitter_, IERC20 usdc_) {
        require(messageTransmitter_ != address(0) && address(usdc_) != address(0), "zero addr");
        messageTransmitter = messageTransmitter_;
        usdc = usdc_;
    }

    modifier onlyTransmitter() {
        if (msg.sender != messageTransmitter) revert NotMessageTransmitter();
        _;
    }

    function handleReceiveFinalizedMessage(
        uint32 sourceDomain,
        bytes32,
        uint32,
        bytes calldata messageBody
    ) external override onlyTransmitter returns (bool) {
        _settle(sourceDomain, messageBody);
        return true;
    }

    function handleReceiveUnfinalizedMessage(
        uint32 sourceDomain,
        bytes32,
        uint32,
        bytes calldata messageBody
    ) external override onlyTransmitter returns (bool) {
        _settle(sourceDomain, messageBody);
        return true;
    }

    /** Decode the hook payload and forward the minted USDC to the merchant. */
    function _settle(uint32 sourceDomain, bytes calldata messageBody) internal {
        if (messageBody.length <= HOOK_DATA_OFFSET) revert NoHookData();
        bytes calldata hookData = messageBody[HOOK_DATA_OFFSET:];
        (address merchant, bytes32 orderId) = abi.decode(hookData, (address, bytes32));

        uint256 amount = usdc.balanceOf(address(this));
        emit OrderSettled(orderId, merchant, amount, sourceDomain);
        if (amount > 0) {
            if (!usdc.transfer(merchant, amount)) revert TransferFailed();
        }
    }
}
