/**
 * Lepton schema — nanopayment modules (citation tolls, streaming, autonomous
 * agents) plus the production settlement spine (wallets, payees, settlement
 * receipts, nonces). Canonical entities live in `metadata.__doc`; the columns
 * here are projections for queries, following the SettleKit persistence pattern.
 */

import { pgTable, text, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import {
  idColumn,
  amountColumn,
  metadataColumn,
  nullableTimestamp,
  requiredTimestamp,
  timestamps,
} from "./_shared.js";

/** A citeable, per-access-priced work. */
export const leptonSources = pgTable(
  "lepton_sources",
  {
    id: idColumn(),
    organizationId: text("organization_id").notNull(),
    title: text("title").notNull(),
    authorWallet: text("author_wallet").notNull(),
    network: text("network").notNull().default("arc"),
    priceUsdc: amountColumn("price_usdc").notNull(),
    summary: text("summary").notNull().default(""),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (t) => ({
    orgIdx: index("lepton_sources_org_idx").on(t.organizationId),
    authorIdx: index("lepton_sources_author_idx").on(t.authorWallet),
  }),
);

/** A citation edge: `sourceId` routes `shareBps` of its revenue to `citedSourceId`. */
export const leptonCitations = pgTable(
  "lepton_citations",
  {
    id: idColumn(),
    sourceId: text("source_id").notNull(),
    citedSourceId: text("cited_source_id").notNull(),
    shareBps: integer("share_bps").notNull(),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    sourceIdx: index("lepton_citations_source_idx").on(t.sourceId),
  }),
);

/** One recipient's cut of a single paid access. */
export const leptonRoyaltyLegs = pgTable(
  "lepton_royalty_legs",
  {
    id: idColumn(),
    sourceId: text("source_id").notNull(),
    accessId: text("access_id").notNull(),
    wallet: text("wallet").notNull(),
    amount: amountColumn("amount").notNull(),
    depth: integer("depth").notNull().default(0),
    settlementId: text("settlement_id"),
    status: text("status").notNull().default("pending"),
    metadata: metadataColumn(),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    sourceIdx: index("lepton_royalty_legs_source_idx").on(t.sourceId),
    walletIdx: index("lepton_royalty_legs_wallet_idx").on(t.wallet),
    accessIdx: index("lepton_royalty_legs_access_idx").on(t.accessId),
  }),
);

/** A continuous-authorization payment stream. */
export const leptonStreams = pgTable(
  "lepton_streams",
  {
    id: idColumn(),
    payer: text("payer").notNull(),
    payee: text("payee").notNull(),
    network: text("network").notNull().default("arc"),
    ratePerSecondUsdc: amountColumn("rate_per_second_usdc").notNull(),
    reserveUsdc: amountColumn("reserve_usdc").notNull(),
    state: text("state").notNull().default("active"),
    accruedUsdc: amountColumn("accrued_usdc").notNull().default("0"),
    settledUsdc: amountColumn("settled_usdc").notNull().default("0"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (t) => ({
    payeeIdx: index("lepton_streams_payee_idx").on(t.payee),
    payerIdx: index("lepton_streams_payer_idx").on(t.payer),
  }),
);

/** A batched settlement of accrued stream value. */
export const leptonStreamSettlements = pgTable(
  "lepton_stream_settlements",
  {
    id: idColumn(),
    streamId: text("stream_id").notNull(),
    amount: amountColumn("amount").notNull(),
    settledTotal: amountColumn("settled_total").notNull(),
    txHash: text("tx_hash"),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    streamIdx: index("lepton_stream_settlements_stream_idx").on(t.streamId),
  }),
);

/** A recorded autonomous-agent run. */
export const leptonAgentRuns = pgTable(
  "lepton_agent_runs",
  {
    id: idColumn(),
    agentFrom: text("agent_from").notNull(),
    objective: text("objective").notNull(),
    engine: text("engine").notNull(),
    totalSpentUsdc: amountColumn("total_spent_usdc").notNull().default("0"),
    purchases: integer("purchases").notNull().default(0),
    metadata: metadataColumn(),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    agentIdx: index("lepton_agent_runs_agent_idx").on(t.agentFrom),
  }),
);

/** A single paid call an agent made during a run. */
export const leptonAgentPurchases = pgTable(
  "lepton_agent_purchases",
  {
    id: idColumn(),
    runId: text("run_id").notNull(),
    serviceId: text("service_id").notNull(),
    amount: amountColumn("amount").notNull(),
    txHash: text("tx_hash").notNull().default(""),
    rating: integer("rating"),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    runIdx: index("lepton_agent_purchases_run_idx").on(t.runId),
  }),
);

/** A managed fleet wallet (agent / creator / author / platform). */
export const leptonWallets = pgTable(
  "lepton_wallets",
  {
    id: idColumn(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    address: text("address").notNull(),
    network: text("network").notNull().default("arc"),
    circleWalletId: text("circle_wallet_id"),
    label: text("label"),
    killed: boolean("killed").notNull().default(false),
    metadata: metadataColumn(),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    ownerIdx: index("lepton_wallets_owner_idx").on(t.ownerType, t.ownerId),
    addressIdx: index("lepton_wallets_address_idx").on(t.address),
  }),
);

/** A payee identity (MusicBrainz MBID, immich author, handle) -> wallet. */
export const leptonPayees = pgTable(
  "lepton_payees",
  {
    id: idColumn(),
    kind: text("kind").notNull(),
    externalId: text("external_id").notNull(),
    wallet: text("wallet").notNull(),
    metadata: metadataColumn(),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    externalIdx: uniqueIndex("lepton_payees_kind_external_idx").on(t.kind, t.externalId),
  }),
);

/** An attribution split edge between payees (the payout rule from credits). */
export const leptonPayeeSplits = pgTable(
  "lepton_payee_splits",
  {
    id: idColumn(),
    payeeId: text("payee_id").notNull(),
    parentExternalId: text("parent_external_id"),
    shareBps: integer("share_bps").notNull(),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    payeeIdx: index("lepton_payee_splits_payee_idx").on(t.payeeId),
  }),
);

/** A settlement receipt — the idempotency record for the settlement spine. */
export const leptonSettlements = pgTable(
  "lepton_settlements",
  {
    id: idColumn(),
    reference: text("reference").notNull(),
    recipient: text("recipient").notNull(),
    amount: amountColumn("amount").notNull(),
    network: text("network").notNull().default("arc"),
    status: text("status").notNull().default("pending"),
    provider: text("provider").notNull(),
    txHash: text("tx_hash"),
    batchId: text("batch_id"),
    metadata: metadataColumn(),
    createdAt: requiredTimestamp("created_at"),
    settledAt: nullableTimestamp("settled_at"),
  },
  (t) => ({
    referenceIdx: uniqueIndex("lepton_settlements_reference_idx").on(t.reference),
    statusIdx: index("lepton_settlements_status_idx").on(t.status),
  }),
);

/** One-time x402 nonces for replay protection. */
export const leptonNonces = pgTable(
  "lepton_nonces",
  {
    id: idColumn(),
    nonce: text("nonce").notNull(),
    consumedAt: nullableTimestamp("consumed_at"),
    createdAt: requiredTimestamp("created_at"),
  },
  (t) => ({
    nonceIdx: uniqueIndex("lepton_nonces_nonce_idx").on(t.nonce),
  }),
);
