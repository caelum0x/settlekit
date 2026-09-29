/**
 * x402 self-hosted facilitator replay protection. One row per claimed
 * authorization (chain | token | payer | nonce). The primary key is the atomic
 * claim: `INSERT ... ON CONFLICT DO NOTHING` succeeds for exactly one settle
 * across every API instance.
 */
import { pgTable, text, index } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared.js";

export const x402Nonces = pgTable(
  "x402_nonces",
  {
    key: text("key").primaryKey(),
    /** pending | broadcast | settled */
    state: text("state").notNull(),
    txHash: text("tx_hash"),
    ...timestamps,
  },
  (table) => ({
    stateIdx: index("x402_nonces_state_idx").on(table.state),
  }),
);
