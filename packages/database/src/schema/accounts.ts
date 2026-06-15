import { pgTable, text, boolean, index } from "drizzle-orm/pg-core";
import {
  idColumn,
  timestamps,
  metadataColumn,
  nullableTimestamp,
} from "./_shared.js";

/** Top-level tenant. Every other row is scoped (directly or transitively) to one. */
export const organizations = pgTable("organizations", {
  id: idColumn(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  metadata: metadataColumn(),
  ...timestamps,
});

/** A human principal belonging to an organization. */
export const users = pgTable(
  "users",
  {
    id: idColumn(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role").notNull().default("member"),
    emailVerifiedAt: nullableTimestamp("email_verified_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    organizationIdx: index("users_organization_id_idx").on(
      table.organizationId,
    ),
    emailIdx: index("users_email_idx").on(table.email),
  }),
);

/** A seller account: the org configured to receive money for sales. */
export const merchants = pgTable(
  "merchants",
  {
    id: idColumn(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    displayName: text("display_name").notNull(),
    supportEmail: text("support_email"),
    defaultCurrency: text("default_currency").notNull().default("USDC"),
    payoutWalletId: text("payout_wallet_id"),
    status: text("status").notNull().default("active"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    organizationIdx: index("merchants_organization_id_idx").on(
      table.organizationId,
    ),
  }),
);

/** A buyer record tied to a merchant. */
export const customers = pgTable(
  "customers",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    email: text("email").notNull(),
    name: text("name"),
    walletAddress: text("wallet_address"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("customers_merchant_id_idx").on(table.merchantId),
    emailIdx: index("customers_email_idx").on(table.email),
  }),
);

/** A destination wallet for merchant payouts. */
export const payoutWallets = pgTable(
  "payout_wallets",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    network: text("network").notNull(),
    address: text("address").notNull(),
    label: text("label"),
    isDefault: boolean("is_default").notNull().default(false),
    verifiedAt: nullableTimestamp("verified_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("payout_wallets_merchant_id_idx").on(table.merchantId),
  }),
);
