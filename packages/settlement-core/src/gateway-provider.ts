/**
 * Settlement via Circle's Gateway — gas-free, batched USDC nanopayments.
 *
 * The Gateway burn-intent → attestation → mint flow needs an EIP-712 signer and
 * a transaction submitter (a viem wallet in production). That chain wiring lives
 * behind a small {@link GatewayTransferPort}, so this provider stays unit-test-
 * able and the integration seam is explicit. `createGatewayTransferPort`
 * orchestrates the real `@settlekit/gateway` client against injected signer /
 * sender deps.
 */

import { type Hex, type GatewayClient, type TxRequest } from "@settlekit/gateway";
import { money, toIso } from "@settlekit/common";
import { type Money, toBaseUnits } from "@settlekit/common";
import { InMemoryIdempotencyStore, settlementId, withIdempotency } from "./idempotency.js";
import type {
  IdempotencyStore,
  SettlementProvider,
  SettlementReceipt,
  SettlementRequest,
} from "./types.js";

/** A single Gateway transfer request (amounts in USDC base units). */
export interface GatewayTransferInput {
  to: string;
  amountBase: bigint;
  network: SettlementRequest["network"];
  reference: string;
}

/** The chain-touching seam: execute one Gateway transfer, return its tx hash. */
export interface GatewayTransferPort {
  transfer(input: GatewayTransferInput): Promise<{ txHash: string; batchId?: string }>;
}

/** Dependencies for the production {@link createGatewayTransferPort}. */
export interface GatewayPortDeps {
  client: GatewayClient;
  /** Destination Gateway minter address. */
  gatewayMinter: string;
  /** EIP-712 signer over the burn-intent typed data (viem wallet, etc.). */
  signTypedData: (typedData: ReturnType<GatewayClient["burnIntentTypedData"]>) => Promise<Hex>;
  /** Submit the mint transaction; resolves with its on-chain hash. */
  sendTransaction: (tx: TxRequest) => Promise<string>;
  /** Map a transfer request into burn-intent params (depositor, tokens, etc.). */
  toBurnIntentParams: (
    input: GatewayTransferInput,
  ) => Parameters<GatewayClient["buildBurnIntent"]>[0];
}

/**
 * Orchestrate the real Gateway flow: build burn intent → sign → request
 * attestation → build mint tx → submit. Returns the mint transaction hash.
 */
export function createGatewayTransferPort(deps: GatewayPortDeps): GatewayTransferPort {
  return {
    async transfer(input: GatewayTransferInput): Promise<{ txHash: string }> {
      const intent = deps.client.buildBurnIntent(deps.toBurnIntentParams(input));
      const typedData = deps.client.burnIntentTypedData(intent);
      const signature = await deps.signTypedData(typedData);
      const attestation = await deps.client.requestTransferAttestation([{ burnIntent: intent, signature }]);
      const mintTx = deps.client.buildGatewayMint({
        gatewayMinter: deps.gatewayMinter,
        attestation: attestation.attestation,
        signature: attestation.signature,
      });
      const txHash = await deps.sendTransaction(mintTx);
      return { txHash };
    },
  };
}

/** Settlement provider backed by a {@link GatewayTransferPort}. */
export class GatewaySettlementProvider implements SettlementProvider {
  readonly name = "gateway" as const;
  private readonly port: GatewayTransferPort;
  private readonly idempotency: IdempotencyStore;

  constructor(port: GatewayTransferPort, idempotency: IdempotencyStore = new InMemoryIdempotencyStore()) {
    this.port = port;
    this.idempotency = idempotency;
  }

  async settle(request: SettlementRequest): Promise<SettlementReceipt> {
    return withIdempotency(this.idempotency, request, "gateway", async () => {
      const createdAt = toIso(new Date());
      const amount: Money = money(request.amountUsdc);
      const { txHash, batchId } = await this.port.transfer({
        to: request.to,
        amountBase: toBaseUnits(amount.amount),
        network: request.network,
        reference: request.reference,
      });
      return {
        id: settlementId(),
        reference: request.reference,
        to: request.to,
        amount,
        network: request.network,
        status: "settled",
        provider: "gateway",
        txHash,
        ...(batchId !== undefined ? { batchId } : {}),
        createdAt,
        settledAt: toIso(new Date()),
      };
    });
  }
}
