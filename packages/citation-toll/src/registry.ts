/**
 * Source creation, validation, and an in-memory registry.
 */

import {
  type Result,
  type SettleKitError,
  err,
  money,
  ok,
  toIso,
  uuid,
  validationError,
} from "@settlekit/common";
import type { CreateSourceInput, Source } from "./types.js";

const MAX_BPS = 10_000;

function sourceId(): string {
  return `src_${uuid().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Validate and construct a {@link Source}. Fails if the price is not positive or
 * the citation shares sum to more than 100% (which would leave the author a
 * negative share).
 */
export function createSource(
  input: CreateSourceInput,
  now: Date = new Date(),
): Result<Source, SettleKitError> {
  let price;
  try {
    price = money(input.priceUsdc);
  } catch {
    return err(validationError(`invalid price "${input.priceUsdc}"`));
  }
  if (price.amount === "0") {
    return err(validationError("source price must be greater than zero"));
  }

  const cites = input.cites ?? [];
  let totalBps = 0;
  for (const c of cites) {
    if (!Number.isInteger(c.shareBps) || c.shareBps < 0 || c.shareBps > MAX_BPS) {
      return err(validationError(`citation shareBps must be an integer in [0, ${MAX_BPS}]`));
    }
    totalBps += c.shareBps;
  }
  if (totalBps > MAX_BPS) {
    return err(
      validationError(
        `citation shares sum to ${totalBps} bps, exceeding 100% (${MAX_BPS} bps)`,
      ),
    );
  }

  return ok({
    id: sourceId(),
    organizationId: input.organizationId,
    title: input.title,
    authorWallet: input.authorWallet,
    network: input.network ?? "arc",
    priceUsdc: price.amount,
    body: input.body,
    summary: input.summary ?? input.title,
    cites,
    createdAt: toIso(now),
  });
}

/** Read interface over sources, used by the split engine and handlers. */
export interface SourceRegistry {
  get(id: string): Source | undefined;
  all(): readonly Source[];
}

/** A mutable in-memory {@link SourceRegistry}. */
export class InMemorySourceRegistry implements SourceRegistry {
  private readonly sources = new Map<string, Source>();

  add(source: Source): void {
    this.sources.set(source.id, source);
  }

  get(id: string): Source | undefined {
    return this.sources.get(id);
  }

  all(): readonly Source[] {
    return [...this.sources.values()];
  }
}
