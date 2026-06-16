// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * Circle CCTP V2 message-handler interface (verbatim signatures from
 * circlefin/evm-cctp-contracts `src/interfaces/v2/IMessageHandlerV2.sol`,
 * re-declared under ^0.8 — interfaces are ABI-compatible across compiler
 * versions). After minting USDC to a contract `mintRecipient`, the local
 * `MessageTransmitterV2` invokes the matching handler with the burn message
 * body (which carries the `hookData` appended by `depositForBurnWithHook`).
 */
interface IMessageHandlerV2 {
    function handleReceiveFinalizedMessage(
        uint32 sourceDomain,
        bytes32 sender,
        uint32 finalityThresholdExecuted,
        bytes calldata messageBody
    ) external returns (bool);

    function handleReceiveUnfinalizedMessage(
        uint32 sourceDomain,
        bytes32 sender,
        uint32 finalityThresholdExecuted,
        bytes calldata messageBody
    ) external returns (bool);
}
