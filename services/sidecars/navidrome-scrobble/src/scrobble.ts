/**
 * Per-listen royalty processing for self-hosted music servers (Navidrome /
 * Subsonic). A scrobble is a play event; the artist earns a per-listen rate when
 * the play is long enough to count (a skip in the first seconds costs nothing),
 * bounded by an optional per-listener daily spending cap. Each qualifying play
 * records a pending royalty leg to the artist's wallet; the sweep settles them
 * in batches via the settlement spine — user-centric royalties: your money goes
 * to the artists you actually played.
 */

import { type Money, money, toIso, uuid } from "@settlekit/common";
import type { RoyaltyLegStore } from "@settlekit/citation-toll";
import { type PayeeRegistry, walletFor } from "@settlekit/payee-registry";
import { type FleetWallet, SpendingCapEnforcer } from "@settlekit/wallet-fleet";
import type { NavidromeConfig } from "./config.js";

/** The artist credited for a play (MusicBrainz MBID or name). */
export interface ScrobbleArtist {
  externalId: string;
  displayName?: string;
  wallet?: string;
}

/** A single play event from the music server. */
export interface ScrobbleEvent {
  /** The listener (for per-user caps). */
  userId: string;
  trackId: string;
  artist: ScrobbleArtist;
  /** How many seconds of the track were actually played. */
  playedSeconds: number;
}

/** Outcome of processing one scrobble. */
export interface ScrobbleResult {
  charged: boolean;
  reason?: string;
  artistWallet?: string;
  amountUsdc?: string;
}

export interface ScrobbleProcessorDeps {
  payees: PayeeRegistry;
  royaltyLegStore: RoyaltyLegStore;
  caps: SpendingCapEnforcer;
  config: NavidromeConfig;
  now?: () => Date;
}

export interface ScrobbleProcessor {
  process(event: ScrobbleEvent): Promise<ScrobbleResult>;
}

function userWallet(userId: string, network: NavidromeConfig["network"]): FleetWallet {
  return {
    id: userId,
    ownerType: "creator",
    ownerId: userId,
    address: "",
    network,
    killed: false,
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}

export function createScrobbleProcessor(deps: ScrobbleProcessorDeps): ScrobbleProcessor {
  const now = deps.now ?? (() => new Date());
  const rate: Money = money(deps.config.perListenUsdc);

  async function resolveArtistWallet(artist: ScrobbleArtist): Promise<string | undefined> {
    if (artist.wallet !== undefined && artist.wallet.length > 0) {
      await deps.payees.register({
        kind: "musicbrainz",
        externalId: artist.externalId,
        wallet: artist.wallet,
        ...(artist.displayName !== undefined ? { displayName: artist.displayName } : {}),
      });
      return artist.wallet;
    }
    return walletFor(deps.payees, "musicbrainz", artist.externalId, deps.config.escrowWallet);
  }

  return {
    async process(event: ScrobbleEvent): Promise<ScrobbleResult> {
      // Play-gating: a skip in the first seconds is free.
      if (event.playedSeconds < deps.config.minPlaySeconds) {
        return { charged: false, reason: "play too short" };
      }

      const artistWallet = await resolveArtistWallet(event.artist);
      if (artistWallet === undefined) {
        return { charged: false, reason: "no artist wallet" };
      }

      // Per-listener daily cap.
      if (deps.config.perUserDailyCapUsdc !== undefined) {
        const at = now().getTime();
        const decision = deps.caps.authorize(
          userWallet(event.userId, deps.config.network),
          { perDayUsdc: deps.config.perUserDailyCapUsdc },
          rate,
          at,
        );
        if (!decision.allowed) {
          return { charged: false, reason: decision.reason ?? "user cap reached" };
        }
      }

      await deps.royaltyLegStore.append({
        id: `leg_${uuid().replace(/-/g, "").slice(0, 24)}`,
        sourceId: event.trackId,
        accessId: `play_${uuid().replace(/-/g, "").slice(0, 24)}`,
        wallet: artistWallet,
        network: deps.config.network,
        amount: rate,
        depth: 0,
        status: "pending",
        createdAt: toIso(now()),
      });

      if (deps.config.perUserDailyCapUsdc !== undefined) {
        deps.caps.record(event.userId, rate, now().getTime());
      }

      return { charged: true, artistWallet, amountUsdc: rate.amount };
    },
  };
}
