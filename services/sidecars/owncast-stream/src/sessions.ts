/**
 * Viewer-session metering for live streams.
 *
 * A viewer joining opens a per-second {@link PaymentStream} (authorizing a rate
 * + reserve); leaving closes it — the time actually watched accrues to the
 * streamer as a royalty leg, and the reserved-but-unused remainder is reported
 * as a refund. You pay for the rate of flow, by the second (RFB 4).
 */

import { toIso, uuid } from "@settlekit/common";
import type { RoyaltyLegStore } from "@settlekit/citation-toll";
import { type PayeeRegistry, walletFor } from "@settlekit/payee-registry";
import { type PaymentStream, openStream } from "@settlekit/streaming";
import type { OwncastConfig } from "./config.js";

/** The streamer being watched (Owncast instance / channel identity). */
export interface StreamerRef {
  externalId: string;
  displayName?: string;
  wallet?: string;
}

export interface JoinEvent {
  sessionId: string;
  streamer: StreamerRef;
}

export interface LeaveResult {
  accruedUsdc: string;
  refundUsdc: string;
}

export interface OwncastSessions {
  /** Begin metering a viewer session. Returns false if no streamer wallet. */
  join(event: JoinEvent): Promise<boolean>;
  /** End a session: settle watched time to the streamer, report the refund. */
  leave(sessionId: string): Promise<LeaveResult | undefined>;
  /** Number of live sessions. */
  active(): number;
}

interface LiveSession {
  stream: PaymentStream;
  streamerWallet: string;
}

export interface OwncastSessionsDeps {
  payees: PayeeRegistry;
  royaltyLegStore: RoyaltyLegStore;
  config: OwncastConfig;
  /** Epoch-ms clock (injectable for deterministic tests). */
  now?: () => number;
}

export function createOwncastSessions(deps: OwncastSessionsDeps): OwncastSessions {
  const now = deps.now ?? (() => Date.now());
  const sessions = new Map<string, LiveSession>();

  async function streamerWallet(streamer: StreamerRef): Promise<string | undefined> {
    if (streamer.wallet !== undefined && streamer.wallet.length > 0) {
      await deps.payees.register({
        kind: "handle",
        externalId: streamer.externalId,
        wallet: streamer.wallet,
        ...(streamer.displayName !== undefined ? { displayName: streamer.displayName } : {}),
      });
      return streamer.wallet;
    }
    return walletFor(deps.payees, "handle", streamer.externalId, deps.config.escrowWallet);
  }

  return {
    async join(event: JoinEvent): Promise<boolean> {
      const wallet = await streamerWallet(event.streamer);
      if (wallet === undefined) {
        return false;
      }
      const stream = openStream({
        payer: event.sessionId,
        payee: wallet,
        network: deps.config.network,
        ratePerSecondUsdc: deps.config.perSecondUsdc,
        reserveUsdc: deps.config.reserveUsdc,
        now,
      });
      sessions.set(event.sessionId, { stream, streamerWallet: wallet });
      return true;
    },

    async leave(sessionId: string): Promise<LeaveResult | undefined> {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        return undefined;
      }
      sessions.delete(sessionId);
      const { finalSettlement, refund } = await session.stream.close();
      const accrued = finalSettlement.settledTotal;
      if (accrued.amount !== "0") {
        await deps.royaltyLegStore.append({
          id: `leg_${uuid().replace(/-/g, "").slice(0, 24)}`,
          sourceId: sessionId,
          accessId: sessionId,
          wallet: session.streamerWallet,
          network: deps.config.network,
          amount: accrued,
          depth: 0,
          status: "pending",
          createdAt: toIso(new Date(now())),
        });
      }
      return { accruedUsdc: accrued.amount, refundUsdc: refund.amount };
    },

    active(): number {
      return sessions.size;
    },
  };
}
