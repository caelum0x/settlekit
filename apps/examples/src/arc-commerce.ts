/**
 * Arc-commerce checkout — App Kit money movement in one runnable command.
 *
 *   pnpm --filter @settlekit/examples arc-commerce
 *
 * An eCommerce checkout that accepts USDC on Arc, with an optional bridged
 * payment for a customer whose USDC lives on another chain. Everything here
 * runs offline over {@link LocalAppKitSdk} — deterministic, no network, no
 * credentials — so it executes in CI.
 *
 * Two legs are demonstrated:
 *   1. Same-chain    customer pays USDC on Arc            → arc.send(...)
 *   2. Bridged       customer's USDC starts on Base       → arc.bridge(...)
 *
 * ── Going live (one-line swap, no flow changes) ──────────────────────────────
 * The viem / Circle path is external to this repo (the consumer owns the SDK
 * dependency), so it is shown here in comments only:
 *
 *   import { AppKit } from "@circle-fin/app-kit";
 *   import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
 *   import { configureAppKit } from "@settlekit/app-kit";
 *
 *   const arc = configureAppKit({ sdk: new AppKit() }); // kit key ← CIRCLE_KIT_KEY
 *   const adapter = createViemAdapterFromProvider(provider);
 *   await arc.send({ adapter, chain: "Arc_Testnet", to, amount: "49", token: "USDC" });
 *
 * The only edits versus this demo: `sdk: new AppKit()` instead of
 * `new LocalAppKitSdk()`, and a real signing `adapter` instead of the string
 * label. The order math, validation, and receipts are identical.
 */

import { fromBaseUnits, toBaseUnits, unwrap } from "@settlekit/common";
import {
  type SupportedChain,
  type SupportedToken,
  type TransferStatus,
  LocalAppKitSdk,
  configureAppKit,
} from "@settlekit/app-kit";

/** A single line item in a checkout order. */
export interface CheckoutLineItem {
  /** Stable SKU / product identifier. */
  readonly sku: string;
  /** Human-readable product name. */
  readonly name: string;
  /** Unit price as a decimal USDC string, e.g. "19.99". */
  readonly priceUsdc: string;
}

/** A checkout order: line items plus where the funds are paid. */
export interface CheckoutOrder {
  /** Order identifier. */
  readonly orderId: string;
  /** Merchant wallet that receives payment on Arc. */
  readonly merchantWallet: string;
  /** Line items the customer is buying. */
  readonly items: readonly CheckoutLineItem[];
  /** Order total as a normalized decimal USDC string (sum of items). */
  readonly totalUsdc: string;
  /** Token the order is denominated in. */
  readonly token: SupportedToken;
}

/** A normalized receipt for one settled payment leg. */
export interface CheckoutReceipt {
  /** Which leg produced this receipt. */
  readonly leg: "same-chain" | "bridged";
  /** Normalized status of the transfer. */
  readonly status: TransferStatus;
  /** Decimal USDC amount moved on this leg. */
  readonly amountUsdc: string;
  /** On-chain transaction hash. */
  readonly txHash: string;
  /** Block-explorer URL for {@link txHash}. */
  readonly explorerUrl: string;
}

/** The structured outcome of the Arc-commerce checkout demo. */
export interface ArcCommerceResult {
  /** The built order. */
  readonly order: CheckoutOrder;
  /** Order total (== {@link CheckoutOrder.totalUsdc}), surfaced for tests. */
  readonly total: string;
  /** Receipt for the same-chain (Arc → Arc) USDC payment. */
  readonly sameChain: CheckoutReceipt;
  /** Receipt for the bridged (Base → Arc) USDC payment. */
  readonly bridged: CheckoutReceipt;
  /** True when both legs settled to `success`. */
  readonly allSucceeded: boolean;
}

/** A demo signing-adapter label. Live code passes a real viem/Circle adapter. */
const DEMO_ADAPTER = "demo-viem-adapter";

/** Arc is the settlement chain for this storefront. */
const ARC: SupportedChain = "Arc_Testnet";

/** A customer whose USDC starts on Base bridges in via CCTP. */
const BRIDGE_FROM: SupportedChain = "Base_Sepolia";

/** Build an order, summing line items in base units to avoid float drift. */
function buildOrder(): CheckoutOrder {
  const items: readonly CheckoutLineItem[] = [
    { sku: "sku-tee", name: "SettleKit Tee", priceUsdc: "19.99" },
    { sku: "sku-cap", name: "Greenbar Cap", priceUsdc: "29.01" },
  ];
  const totalBase = items.reduce((sum, item) => sum + toBaseUnits(item.priceUsdc), 0n);
  return {
    orderId: "ord_arc_demo_0001",
    merchantWallet: "0xMerchantArcWallet",
    items,
    totalUsdc: fromBaseUnits(totalBase),
    token: "USDC",
  };
}

/**
 * Run the Arc-commerce checkout end-to-end against {@link LocalAppKitSdk}.
 *
 * Builds an order, charges the total once same-chain on Arc, then demonstrates
 * the bridged variant (USDC arriving from Base). Both legs are unwrapped from
 * `Result<TransferResult>` and projected into plain receipts.
 */
export async function main(): Promise<ArcCommerceResult> {
  const order = buildOrder();

  // Offline, deterministic App Kit client. Swap `new LocalAppKitSdk()` for
  // `new AppKit()` (see file header) to settle real testnet USDC on Arc.
  const sdk = new LocalAppKitSdk();
  const arc = configureAppKit({ sdk, kitKey: "kit_demo" });

  // Leg 1 — same-chain: customer pays USDC directly on Arc to the merchant.
  const sendResult = unwrap(
    await arc.send({
      adapter: DEMO_ADAPTER,
      chain: ARC,
      to: order.merchantWallet,
      amount: order.totalUsdc,
      token: order.token,
    }),
  );
  const sameChain: CheckoutReceipt = {
    leg: "same-chain",
    status: sendResult.status,
    amountUsdc: order.totalUsdc,
    txHash: sendResult.txHash ?? "",
    explorerUrl: sendResult.explorerUrl ?? "",
  };

  // Leg 2 — bridged: a second customer's USDC starts on Base and bridges to
  // Arc (Gateway/CCTP under the hood). Bridge is USDC-only and key-free.
  const bridgeResult = unwrap(
    await arc.bridge({
      adapter: DEMO_ADAPTER,
      fromChain: BRIDGE_FROM,
      toChain: ARC,
      amount: order.totalUsdc,
    }),
  );
  const bridged: CheckoutReceipt = {
    leg: "bridged",
    status: bridgeResult.status,
    amountUsdc: order.totalUsdc,
    txHash: bridgeResult.txHash ?? "",
    explorerUrl: bridgeResult.explorerUrl ?? "",
  };

  return {
    order,
    total: order.totalUsdc,
    sameChain,
    bridged,
    allSucceeded: sameChain.status === "success" && bridged.status === "success",
  };
}

/** Print a line to stdout (only used inside the run-guard, never on import). */
function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

/** Print a labeled receipt block. */
function printReceipt(receipt: CheckoutReceipt): void {
  out(`     leg          ${receipt.leg}`);
  out(`     status       ${receipt.status}`);
  out(`     amount       ${receipt.amountUsdc} USDC`);
  out(`     txHash       ${receipt.txHash}`);
  out(`     explorerUrl  ${receipt.explorerUrl}`);
  out("");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      out("");
      out("  ╔══════════════════════════════════════════════════════════════╗");
      out("  ║   Arc-commerce checkout — accept USDC on Arc (App Kit)        ║");
      out("  ║   SettleKit · offline LocalAppKitSdk · flips live in one line ║");
      out("  ╚══════════════════════════════════════════════════════════════╝");
      out("");
      out(`  order ${result.order.orderId} → ${result.order.merchantWallet}`);
      for (const item of result.order.items) {
        out(`     ${item.name.padEnd(18)} ${item.priceUsdc.padStart(8)} USDC  (${item.sku})`);
      }
      out(`     ${"total".padEnd(18)} ${result.total.padStart(8)} USDC`);
      out("");
      out("  ── Receipt · same-chain (Arc → Arc) ────────────────────────────");
      out("");
      printReceipt(result.sameChain);
      out("  ── Receipt · bridged (Base → Arc) ──────────────────────────────");
      out("");
      printReceipt(result.bridged);
      out(`  all legs succeeded: ${result.allSucceeded ? "yes" : "NO"}`);
      out("");
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `arc-commerce demo failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
