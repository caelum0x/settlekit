/**
 * Per-network refund execution.
 *
 *   Base escrow payment  -> AuthCaptureEscrow.refund via OperatorRefundCollector
 *   EVM chains           -> ERC-20 `transfer` of the chain's stablecoin back to the payer
 *   Solana               -> USDC TransferChecked back to the payer (settlement provider)
 *   HyperCore            -> `usdSend` through an injected sender (the
 *                           @settlekit/hyperliquid package is not on this branch;
 *                           without a sender HyperCore refunds are manual)
 *   Zcash                -> manual (transparent ZEC refunds need an operator wallet)
 *
 * Every automated route pays from the OPERATOR's own balance: merchants were
 * paid at capture/pull time, so the operator wallet must be funded to refund.
 */
import type { PaymentNetwork } from "@settlekit/common";
import { fromBaseUnits } from "@settlekit/common";
import type { Hex } from "@settlekit/chains";
import { erc20Abi } from "./abis.js";
import type { EscrowPaymentService } from "./escrow-records.js";
import type { EvmOperator } from "./evm.js";
import type { BillingNetwork } from "./types.js";

export type RefundRoute = "escrow_refund" | "evm_transfer" | "solana_transfer" | "hypercore_usd_send";

export class RefundUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundUnsupportedError";
  }
}

export interface RefundRequest {
  network: BillingNetwork;
  /** Recipient (the original payer). */
  to: string;
  /** Base units (6 decimals for every supported stablecoin). */
  amount: bigint;
  /** Business key: the @settlekit/refunds refund id. */
  reference: string;
  /** Refund through the Base escrow instead of a transfer. */
  escrowPaymentId?: string;
}

export interface RefundExecution {
  route: RefundRoute;
  txHash: string;
}

/** Structural subset of a @settlekit/settlement-core SettlementProvider. */
export interface SolanaRefundSender {
  settle(request: { reference: string; to: string; amountUsdc: string; network: PaymentNetwork; memo?: string }): Promise<{ txHash?: string }>;
}

export interface HyperCoreRefundSender {
  usdSend(request: { destination: string; amount: string; reference: string }): Promise<{ txHash: string }>;
}

export interface EvmRefundRoute {
  operator: EvmOperator;
  /** The stablecoin to send back on this network. */
  token: Hex;
}

export interface RefundDispatcherConfig {
  escrow?: EscrowPaymentService;
  evm?: Partial<Record<string, EvmRefundRoute>>;
  solana?: SolanaRefundSender;
  hypercore?: HyperCoreRefundSender;
}

export class RefundDispatcher {
  constructor(private readonly config: RefundDispatcherConfig) {}

  /** The route a refund on `network` would take, or null when it is manual. */
  routeFor(network: BillingNetwork, escrow: boolean): RefundRoute | null {
    if (escrow) return this.config.escrow ? "escrow_refund" : null;
    if (network === "solana") return this.config.solana ? "solana_transfer" : null;
    if (network === "hypercore") return this.config.hypercore ? "hypercore_usd_send" : null;
    if (network === "zcash") return null;
    return this.config.evm?.[network] ? "evm_transfer" : null;
  }

  async refund(request: RefundRequest): Promise<RefundExecution> {
    if (request.amount <= 0n) throw new RangeError("refund amount must be positive");
    const route = this.routeFor(request.network, request.escrowPaymentId !== undefined);
    if (route === null) {
      throw new RefundUnsupportedError(`automated refunds are not available on ${request.network}; refund manually`);
    }
    switch (route) {
      case "escrow_refund":
        return this.escrowRefund(request);
      case "solana_transfer":
        return this.solanaRefund(request);
      case "hypercore_usd_send":
        return this.hypercoreRefund(request);
      case "evm_transfer":
        return this.evmRefund(request);
    }
  }

  private async escrowRefund(request: RefundRequest): Promise<RefundExecution> {
    const escrow = this.config.escrow as EscrowPaymentService;
    const record = await escrow.refund(request.escrowPaymentId as string, request.amount);
    const last = record.txs.at(-1);
    if (!last || last.action !== "refund") throw new Error("escrow refund did not record a transaction");
    return { route: "escrow_refund", txHash: last.txHash };
  }

  private async evmRefund(request: RefundRequest): Promise<RefundExecution> {
    const target = this.config.evm?.[request.network] as EvmRefundRoute;
    const hash = await target.operator.write({
      address: target.token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [request.to as Hex, request.amount],
    });
    const receipt = await target.operator.waitForReceipt(hash);
    if (receipt.status !== "success") throw new Error(`refund transfer ${hash} reverted`);
    return { route: "evm_transfer", txHash: hash };
  }

  private async solanaRefund(request: RefundRequest): Promise<RefundExecution> {
    const receipt = await (this.config.solana as SolanaRefundSender).settle({
      reference: `refund:${request.reference}`,
      to: request.to,
      amountUsdc: fromBaseUnits(request.amount),
      network: "solana",
      memo: `refund ${request.reference}`,
    });
    if (!receipt.txHash) throw new Error("solana refund settled without a signature");
    return { route: "solana_transfer", txHash: receipt.txHash };
  }

  private async hypercoreRefund(request: RefundRequest): Promise<RefundExecution> {
    const result = await (this.config.hypercore as HyperCoreRefundSender).usdSend({
      destination: request.to,
      amount: fromBaseUnits(request.amount),
      reference: request.reference,
    });
    return { route: "hypercore_usd_send", txHash: result.txHash };
  }
}
