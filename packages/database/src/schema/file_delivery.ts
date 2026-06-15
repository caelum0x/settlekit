import { pgTable, text, integer, index } from "drizzle-orm/pg-core";
import {
  idColumn,
  timestamps,
  metadataColumn,
  nullableTimestamp,
} from "./_shared.js";

/**
 * A download grant tracking how many times a customer may download a file,
 * bound to the opaque `dl` token embedded in a signed URL. The canonical
 * DownloadGrant document lives in `metadata.__doc`; typed columns are projected
 * for querying. `merchant_id` carries no FK (the seeded default id is projected
 * here, and the document is the source of truth for the entity itself).
 */
export const downloadGrants = pgTable(
  "download_grants",
  {
    id: idColumn(),
    merchantId: text("merchant_id"),
    fileId: text("file_id").notNull(),
    customerId: text("customer_id"),
    downloadToken: text("download_token").notNull(),
    status: text("status").notNull().default("active"),
    downloadsRemaining: integer("downloads_remaining"),
    expiresAt: nullableTimestamp("expires_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    fileIdx: index("download_grants_file_id_idx").on(table.fileId),
    tokenIdx: index("download_grants_download_token_idx").on(
      table.downloadToken,
    ),
  }),
);
