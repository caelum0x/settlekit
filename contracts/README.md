# SettleKit contracts (Arc / EVM)

Solidity contracts for the on-chain pieces of SettleKit on Arc. Built + tested
with Foundry (`solc 0.8.30`).

```bash
cd contracts
forge build        # compile
forge test         # 13 tests (escrow + CCTP hook)
```

## Contracts

### `SettleKitEscrow.sol`
Trustless USDC escrow — the on-chain counterpart to the off-chain escrow product.
A buyer funds an escrow for a seller with a neutral arbiter:

- `createAndFund(id, seller, arbiter, amount)` — buyer pulls USDC into escrow (requires prior `approve`).
- `release(id)` — buyer **or** arbiter → pays the seller.
- `refund(id)` — seller **or** arbiter → returns to the buyer.
- `dispute(id)` — buyer **or** seller flags it; only the arbiter can then resolve.

Checks-effects-interactions ordering (state finalized before transfer) prevents
re-entrancy; custom errors for every guard.

### `SettleKitCctpHook.sol`
Implements Circle's published **CCTP V2** `IMessageHandlerV2`
(`circlefin/evm-cctp-contracts`). Deploy as the CCTP `mintRecipient`: a pay-in
burned on a source chain with `depositForBurnWithHook(..., hookData)` mints USDC
to this contract on Arc, then `MessageTransmitterV2` calls a handler here with
the burn message body. The contract decodes the trailing `hookData` as
`abi.encode(address merchant, bytes32 orderId)` and forwards the freshly-minted
USDC to the merchant, emitting `OrderSettled` — making **cross-chain pay-in →
merchant credit atomic**.

Only the configured `MessageTransmitterV2` may call the handlers. `hookData`
begins at byte 228 of a `BurnMessageV2` body (offset documented in-contract).

## Integration

- **Hook payload** — the API's `POST /v1/cctp/burn-tx` accepts a `hookData` hex
  field (Phase 3). Set it to `abi.encode(merchant, orderId)` and point
  `mintRecipient` at a deployed `SettleKitCctpHook` to settle a checkout the
  moment the cross-chain USDC mints on Arc.
- **Deploy** — use the deterministic `create2Factory` in
  `@settlekit/arc` `ARC_TESTNET.contracts.create2Factory` for stable addresses;
  pass the Arc USDC (`0x3600…0000`) and the Arc `MessageTransmitterV2`
  (`ARC_TESTNET.contracts.cctpMessageTransmitterV2`) to the hook constructor, and
  the USDC address to the escrow constructor.

Deploying to Arc testnet needs a faucet-funded deployer key (USDC is the gas
token) — gated on the same Circle/Arc provisioning as the rest of the stack.
