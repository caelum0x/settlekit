/**
 * Maintainer resolution.
 *
 * Maps a package name to the wallet that should receive its share. The chain is:
 *   package name → GitHub maintainer handle → payout wallet (payee registry).
 *
 * The package→handle map comes from the manifest's `repository` field, npm/PyPI
 * metadata, or a `FUNDING.yml`; the handle→wallet binding lives in the existing
 * {@link PayeeRegistry} (kind "handle"). A maintainer who has not registered a
 * wallet resolves to the unclaimed-earnings escrow, so their share is still set
 * aside, conserved, and claimable the moment they register.
 */

import { walletFor, type PayeeRegistry } from "@settlekit/payee-registry";
import type { ResolvedMaintainer } from "./types.js";

/** What we know about a package's maintainer ahead of wallet resolution. */
export interface MaintainerInfo {
  /** GitHub login / org handle. */
  handle: string;
  /** Known existing monthly funding, decimal USD. Defaults to "0". */
  existingMonthlyUsd?: string;
}

/** Resolves a package name to a payout wallet + funding context. */
export interface MaintainerResolver {
  resolve(packageName: string): Promise<ResolvedMaintainer>;
}

/** Options for {@link RegistryMaintainerResolver}. */
export interface RegistryResolverOptions {
  /** Wallet that holds shares for maintainers who have not registered yet. */
  escrowWallet: string;
  /** package name → maintainer info (handle + known funding). */
  maintainers: ReadonlyMap<string, MaintainerInfo>;
}

/**
 * A {@link MaintainerResolver} backed by the SettleKit payee registry. The
 * registry is the source of truth for handle→wallet; this class layers the
 * package→handle lookup and the escrow fallback on top of it.
 */
export class RegistryMaintainerResolver implements MaintainerResolver {
  constructor(
    private readonly registry: PayeeRegistry,
    private readonly options: RegistryResolverOptions,
  ) {}

  async resolve(packageName: string): Promise<ResolvedMaintainer> {
    const info = this.options.maintainers.get(packageName);
    const existingMonthlyUsd = info?.existingMonthlyUsd ?? "0";

    if (info === undefined) {
      // No known maintainer mapping at all — earmark to escrow.
      return { wallet: this.options.escrowWallet, claimed: false, existingMonthlyUsd };
    }

    const wallet = await walletFor(this.registry, "handle", info.handle, this.options.escrowWallet);
    const resolved = wallet ?? this.options.escrowWallet;
    return {
      handle: info.handle,
      wallet: resolved,
      claimed: resolved !== this.options.escrowWallet,
      existingMonthlyUsd,
    };
  }
}
