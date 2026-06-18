/**
 * Payee registry types.
 *
 * A {@link Payee} maps an external identity — a MusicBrainz MBID, an RSS author,
 * an immich photographer, a social handle — to the wallet that should receive
 * its payouts. This is the "payout rule": attribution metadata becomes
 * settlement logic. {@link PayeeSplit} optionally routes a share of a payee's
 * revenue to an ancestor (collaborators recorded in the credits graph).
 */

import type { IsoTimestamp } from "@settlekit/common";

/** The provenance system an external id comes from. */
export type PayeeKind = "musicbrainz" | "rss" | "immich" | "handle" | "wallet";

/** An external identity bound to a payout wallet. */
export interface Payee {
  id: string;
  kind: PayeeKind;
  /** Stable external identifier within the kind (MBID, author URI, handle). */
  externalId: string;
  wallet: string;
  displayName?: string;
  createdAt: IsoTimestamp;
}

/** Input to register or update a payee. */
export interface RegisterPayeeInput {
  kind: PayeeKind;
  externalId: string;
  wallet: string;
  displayName?: string;
}

/** A revenue-share edge from a payee to an ancestor external id. */
export interface PayeeSplit {
  payeeExternalId: string;
  parentExternalId: string;
  shareBps: number;
}
