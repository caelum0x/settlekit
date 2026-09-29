/**
 * Operator-signed HyperCore `usdSend` (refunds and payouts from SettleKit's
 * own HyperCore account). The operator key signs the same EIP-712 action a
 * buyer's wallet signs at checkout; the client submits it to the exchange
 * endpoint. Hyperliquid's response carries no hash, so the sender reads the
 * operator's ledger back to find the transfer's L1 hash; when the ledger has
 * not caught up yet it returns the action's EIP-712 digest as a stable
 * reference (`hashKind: "action_digest"`) — never a fabricated L1 hash.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { HyperCoreClient } from "./client.js";
import { usdcTransferOf } from "./ledger.js";
import { buildUsdSendAction, splitSignature, usdSendDigest, usdSendTypedData } from "./typed-data.js";

/** Arbitrum One / Arbitrum Sepolia: the chain ids Hyperliquid's own UI signs with. */
const DEFAULT_SIGNATURE_CHAIN_ID = { mainnet: 42_161, testnet: 421_614 } as const;

export interface HyperCoreUsdSenderConfig {
  client: HyperCoreClient;
  /** Operator EVM private key (its address is the HyperCore account that pays). */
  privateKey: Hex;
  signatureChainId?: number;
  now?: () => number;
  /** Ledger read-back attempts after submission (default 3, 1s apart). */
  lookupAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface UsdSendRequest {
  destination: string;
  /** Decimal USD amount. */
  amount: string;
  /** Caller's business key (logged by the caller; not sent onchain). */
  reference: string;
}

export interface UsdSendResult {
  txHash: string;
  hashKind: "l1" | "action_digest";
}

export interface HyperCoreUsdSender {
  readonly address: Hex;
  usdSend(request: UsdSendRequest): Promise<UsdSendResult>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHyperCoreUsdSender(config: HyperCoreUsdSenderConfig): HyperCoreUsdSender {
  const account = privateKeyToAccount(config.privateKey);
  const now = config.now ?? (() => Date.now());
  const sleep = config.sleep ?? realSleep;
  const attempts = config.lookupAttempts ?? 3;
  const signatureChainId = config.signatureChainId ?? DEFAULT_SIGNATURE_CHAIN_ID[config.client.config.network];

  async function findHash(destination: string, amount: string, time: number): Promise<string | undefined> {
    const from = account.address.toLowerCase();
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(1_000);
      try {
        const updates = await config.client.ledgerUpdates(from, time - 5_000);
        const match = updates
          .map(usdcTransferOf)
          .find(
            (credit) =>
              credit !== null &&
              credit.from === from &&
              credit.to === destination &&
              Number(credit.amount) === Number(amount) &&
              Math.abs(credit.time - time) <= 120_000,
          );
        if (match) return match.hash;
      } catch {
        // Ledger read-back is best effort; the transfer itself already succeeded.
      }
    }
    return undefined;
  }

  return {
    address: account.address,
    async usdSend(request) {
      const time = now();
      const action = buildUsdSendAction({
        destination: request.destination,
        amount: request.amount,
        time,
        hyperliquidChain: config.client.config.hyperliquidChain,
        signatureChainId,
      });
      const signature = await account.signTypedData(usdSendTypedData(action));
      await config.client.submitUsdSend(action, splitSignature(signature));
      const hash = await findHash(action.destination, action.amount, time);
      return hash ? { txHash: hash, hashKind: "l1" } : { txHash: usdSendDigest(action), hashKind: "action_digest" };
    },
  };
}
