/**
 * Refund to payer: SettleKit prepares the exact transfer back to the buyer's
 * wallet (no custody, SettleKit never signs), the merchant signs it with
 * their own wallet, and the refund is marked succeeded only after the
 * transfer is verified onchain with the same verifiers that confirm payments.
 *
 *   EVM (Base, Ethereum, Arbitrum, Robinhood, HyperEVM, Tempo): an ERC-20
 *     transfer (calldata + EIP-681 link for mobile wallets).
 *   Solana: a Solana Pay transfer request with a unique reference.
 *
 * HyperCore and Zcash refunds stay record-only (send from the wallet app,
 * then record the transaction).
 */
import {
  toBaseUnits,
  validationError,
  type CheckoutSession,
  type Payment,
  type PaymentNetwork,
} from "@settlekit/common";
import { checkPayTo, getEvmChain, isEvmChainKey } from "@settlekit/chains";
import { USDC_MINT_DEVNET, USDC_MINT_MAINNET, createReference, encodeTransferRequestUrl } from "@settlekit/solana";
import type { AppContext } from "../context.js";
import { apiConfig, networkCatalog } from "./network-catalog.js";

export interface RefundTransferPlan {
  network: PaymentNetwork;
  to: string;
  amount: string;
  asset: string;
  evm?: { chainId: number; token: string; data: string; eip681: string };
  solana?: { url: string; reference: string; mint: string };
}

/** ERC-20 `transfer(address,uint256)` calldata. */
export function erc20TransferData(to: string, amountBase: bigint): string {
  const addr = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const value = amountBase.toString(16).padStart(64, "0");
  return `0xa9059cbb${addr}${value}`;
}

function evmPlan(network: PaymentNetwork, to: string, amount: string): RefundTransferPlan {
  if (!isEvmChainKey(network)) throw validationError(`${network} is not an EVM network`);
  const cfg = apiConfig();
  const env = cfg.evm.enabled[network]?.spec.env ?? cfg.evm.env;
  const spec = cfg.evm.enabled[network]?.spec ?? getEvmChain(network, env);
  if (!spec) throw validationError(`refunds are not available on ${network} in this deployment`);
  const base = toBaseUnits(amount);
  return {
    network,
    to,
    amount,
    asset: spec.token.symbol,
    evm: {
      chainId: spec.chainId,
      token: spec.token.address,
      data: erc20TransferData(to, base),
      eip681: `ethereum:${spec.token.address}@${spec.chainId}/transfer?address=${to}&uint256=${base.toString()}`,
    },
  };
}

function solanaPlan(to: string, amount: string, refundId: string): RefundTransferPlan {
  const cluster = apiConfig().solana?.cluster;
  const mint = cluster === "devnet" ? USDC_MINT_DEVNET : USDC_MINT_MAINNET;
  const reference = createReference();
  const url = encodeTransferRequestUrl(
    { recipient: to, amount, splToken: mint, references: [reference], label: "Refund", memo: `refund:${refundId}` },
    { maxDecimals: 6 },
  );
  return { network: "solana", to, amount, asset: "USDC", solana: { url, reference, mint } };
}

/** Networks with a prepared refund transfer. */
export function supportsWalletRefund(network: PaymentNetwork): boolean {
  return network === "solana" || (isEvmChainKey(network) && network !== "arc");
}

/** Build the transfer the merchant signs. */
export function refundPlan(network: PaymentNetwork, to: string, amount: string, refundId: string): RefundTransferPlan {
  if (network === "solana") return solanaPlan(to, amount, refundId);
  if (supportsWalletRefund(network)) return evmPlan(network, to, amount);
  throw validationError(`prepared refunds are not available on ${network}; send it from your wallet and record the transaction`);
}

/** The buyer wallet a payment came from, when SettleKit knows it. */
export async function payerAddressFor(ctx: AppContext, payment: Payment): Promise<string | null> {
  const session: CheckoutSession | null = await ctx.checkouts.findById(payment.checkoutSessionId);
  if (session?.payerAddress) return session.payerAddress;
  const customer = await ctx.customers.findById(payment.customerId);
  return customer?.walletAddress ?? null;
}

/** Validate the refund destination for the payment's network. */
export function assertDestination(network: PaymentNetwork, to: string): void {
  const check = checkPayTo(network, to);
  if (!check.ok) throw validationError(`refund address is not a valid ${network} address: ${check.reason}`, { fields: ["to"] });
}

/** Asset label of the payment's network (USDC, USDG, USDC.e ...). */
export function assetFor(network: PaymentNetwork): string {
  return networkCatalog().find((n) => n.network === network)?.asset ?? "USDC";
}
