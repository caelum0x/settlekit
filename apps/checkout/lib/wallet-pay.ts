/**
 * Server-only "Pay with wallet" helper. Builds an {@link ArcPaymentClient} from
 * @settlekit/app-kit and runs a simulated Arc USDC `send` for the order amount.
 *
 * Offline + deterministic by design: it injects {@link LocalAppKitSdk}, an
 * in-memory SDK that returns synthetic, monotonically-numbered transaction
 * hashes. No secrets are required — `send` needs no Circle kit key (only `swap`
 * does), so wallet-pay works with zero configuration.
 *
 * The signing adapter type `A` is a plain string label for the Local SDK; the
 * live swap (below) replaces it with a viem-backed adapter, so going live is an
 * isolated, well-documented change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SWAP TO LIVE (viem backend) — one place to change, in this module only:
 *
 *   // 1. Add deps to apps/checkout/package.json (kept OUT of the offline build):
 *   //      "@circle-fin/app-kit": "<version>",
 *   //      "@circle-fin/adapter-viem-v2": "<version>"
 *   //
 *   // 2. Replace createWalletPayClient() below with the live wiring:
 *   //
 *   //      import { AppKit } from "@circle-fin/app-kit";
 *   //      const client = configureAppKit<ReturnType<typeof createViemAdapterFromProvider>>({
 *   //        sdk: new AppKit(),       // kitKey falls back to CIRCLE_KIT_KEY env
 *   //      });
 *   //
 *   // 3. In payWithWallet(), build the real signer and pass it as `adapter`:
 *   //
 *   //      import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
 *   //      const adapter = createViemAdapterFromProvider(provider);
 *   //      const result = await client.send({ adapter, chain, to, amount });
 *   //
 * Nothing else in the app changes: the Server Action, component, and receipt
 * rendering all consume the same normalized {@link WalletPayReceipt}.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  configureAppKit,
  LocalAppKitSdk,
  type AppKitSdk,
  type ArcPaymentClient,
  type SupportedChain,
} from "@settlekit/app-kit";

/** Adapter label used by the offline Local SDK (live: a viem adapter). */
const LOCAL_ADAPTER = "local-wallet";

/** Normalized, serializable outcome of a successful wallet-pay send. */
export interface WalletPayReceipt {
  /** Normalized terminal status ("success" when the receipt is rendered). */
  status: "success" | "pending" | "failed";
  /** On-chain (here: simulated) transaction hash. */
  txHash: string;
  /** Block-explorer URL for {@link txHash} (from the SDK, not re-derived). */
  explorerUrl: string;
  /** Raw SDK operation name, e.g. "transfer". */
  operation: string;
}

/** Inputs for a single wallet-pay send. */
export interface PayWithWalletParams {
  /** Decimal amount string, up to 6 dp, > 0 (use session.amount.amount). */
  amount: string;
  /** Recipient address (use session.payToAddress). */
  to: string;
  /** Target chain; the checkout demo uses "Arc_Testnet". */
  chain: SupportedChain;
}

/**
 * Build the {@link ArcPaymentClient}.
 *
 * Default: the offline {@link LocalAppKitSdk} (deterministic, zero-config demo).
 * When `WALLET_PAY_LIVE=true`, it instead injects the REAL Circle App Kit
 * (`new AppKit()` from `@circle-fin/app-kit`, loaded dynamically so the SDK only
 * enters the bundle when live mode is on). A live `send` additionally needs a
 * configured signer adapter + (for swap) `CIRCLE_KIT_KEY`; without them, the
 * returned client's `send` surfaces a typed error rather than moving funds.
 */
export async function createWalletPayClient(): Promise<ArcPaymentClient<string>> {
  if (process.env.WALLET_PAY_LIVE === "true") {
    const { AppKit } = await import("@circle-fin/app-kit");
    // The real AppKit satisfies our injected port; the adapter generic is opaque
    // here (a real viem adapter is threaded through per-call by the live caller).
    return configureAppKit<string>({ sdk: new AppKit() as unknown as AppKitSdk<string> });
  }
  return configureAppKit<string>({ sdk: new LocalAppKitSdk() });
}

/**
 * Run a simulated Arc USDC send for the order amount and return a normalized
 * receipt. {@link ArcPaymentClient.send} never throws — it returns a `Result` —
 * so on failure we throw a friendly error the Server Action can map to a string.
 *
 * The synthetic hash from {@link LocalAppKitSdk} is intentionally NOT a real
 * 0x+64-hex hash, so it must NOT be fed into the checkout's confirm flow. Callers
 * render this self-contained receipt instead.
 */
export async function payWithWallet(
  params: PayWithWalletParams,
): Promise<WalletPayReceipt> {
  const client = await createWalletPayClient();

  const result = await client.send({
    adapter: LOCAL_ADAPTER,
    chain: params.chain,
    to: params.to,
    amount: params.amount,
    // token defaults to "USDC" in ArcPaymentClient.send.
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  const { status, txHash, explorerUrl, operation } = result.value;
  if (txHash === undefined || explorerUrl === undefined) {
    throw new Error("Wallet payment did not return a transaction.");
  }

  return {
    status,
    txHash,
    explorerUrl,
    operation: operation ?? "transfer",
  };
}
