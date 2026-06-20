/**
 * Env-gated Arc settlement provider wiring.
 *
 * Asserts the contract that preserves default behavior while enabling a live
 * provider on demand:
 *   1. Default config (no SETTLEMENT_PROVIDER) → no provider, no warn.
 *   2. `arc` with all required vars → an `ArcSettlementProvider` (name "circle").
 *   3. `arc` missing the private key → no throw, no provider, a logged warn.
 *
 * Fully offline: the viem account + wallet client are lazy at construction and
 * `settle()` is never called, so no RPC is hit.
 */

import { describe, it, expect } from "vitest";
import { ArcSettlementProvider } from "@settlekit/app-kit";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi, DiscordRoleRef } from "@settlekit/discord";
import type { ArcRpc, ArcTransactionReceipt } from "@settlekit/arc";
import { loadConfig } from "../src/config.js";
import { buildJobContext } from "../src/runtime.js";
import { InMemoryWorkerStore } from "../src/stores.js";
import type { Logger } from "../src/logger.js";

/** Base env that satisfies every required worker config var (local provider). */
const TEST_ENV: Record<string, string> = {
  ARC_RPC_URL: "http://localhost:8545",
  ARC_USDC_ADDRESS: "0x1111111111111111111111111111111111111111",
  ARC_CHAIN_ID: "8453",
  ARC_MIN_CONFIRMATIONS: "2",
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "SettleKit <receipts@settlekit.dev>",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  GITHUB_INSTALLATION_ID: "9999",
  DISCORD_BOT_TOKEN: "bot.token.value",
  FILE_DELIVERY_BASE_URL: "https://dl.settlekit.dev/download",
  FILE_DELIVERY_SECRET: "file-secret-value",
  LICENSE_TOKEN_SECRET: "license-token-secret",
  WEBHOOK_SIGNING_SECRET: "wh-signing-secret",
};

/** A deterministic, valid 0x-prefixed 32-byte private key (never a real key). */
const SETTLER_PRIVATE_KEY = `0x${"11".repeat(32)}`;

/** Minimal in-memory GitHub double (no calls are made in these tests). */
function createInMemoryGitHub(): GitHubApi {
  return {
    async listInstallationRepositories() {
      return [];
    },
    async listOrgTeams() {
      return [];
    },
    async getUser() {
      return undefined;
    },
    async addRepoCollaborator() {
      return {};
    },
    async removeRepoCollaborator() {},
    async getRepoCollaboratorPermission() {
      return "write";
    },
    async listRepoInvitations() {
      return [];
    },
    async cancelRepoInvitation() {},
    async addTeamMembership() {},
    async removeTeamMembership() {},
  };
}

/** Minimal in-memory Discord double. */
function createInMemoryDiscord(): DiscordApi {
  return {
    async listGuilds() {
      return [];
    },
    async listGuildRoles() {
      return [];
    },
    async addRole(_ref: DiscordRoleRef) {},
    async removeRole(_ref: DiscordRoleRef) {},
  };
}

/** Arc RPC double; never invoked because no settlement runs. */
function createArcRpc(): ArcRpc {
  return {
    async getTransactionReceipt(): Promise<ArcTransactionReceipt | null> {
      return null;
    },
    async getBlockNumber(): Promise<bigint> {
      return 0n;
    },
  };
}

/** A logger that records every warn message for assertions. */
function createRecordingLogger(): Logger & { warns: string[] } {
  const warns: string[] = [];
  const logger: Logger & { warns: string[] } = {
    warns,
    debug() {},
    info() {},
    warn(message: string) {
      warns.push(message);
    },
    error() {},
    child() {
      return logger;
    },
  };
  return logger;
}

function buildWith(env: Record<string, string>) {
  const logger = createRecordingLogger();
  const { ctx } = buildJobContext({
    config: loadConfig(env),
    githubApi: createInMemoryGitHub(),
    discordApi: createInMemoryDiscord(),
    stores: new InMemoryWorkerStore(),
    arcRpc: createArcRpc(),
    logger,
  });
  return { ctx, logger };
}

describe("worker settlement-provider wiring", () => {
  it("default config yields no live provider and emits no warning", () => {
    const { ctx, logger } = buildWith(TEST_ENV);
    expect(ctx.settlementProvider).toBeUndefined();
    expect(logger.warns).toHaveLength(0);
  });

  it("arc config with all vars yields an ArcSettlementProvider (name circle)", () => {
    const { ctx } = buildWith({
      ...TEST_ENV,
      SETTLEMENT_PROVIDER: "arc",
      ARC_SETTLER_PRIVATE_KEY: SETTLER_PRIVATE_KEY,
    });
    expect(ctx.settlementProvider).toBeInstanceOf(ArcSettlementProvider);
    expect(ctx.settlementProvider?.name).toBe("circle");
  });

  it("arc config missing the private key falls back to local without throwing", () => {
    const build = () => buildWith({ ...TEST_ENV, SETTLEMENT_PROVIDER: "arc" });
    expect(build).not.toThrow();
    const { ctx, logger } = build();
    expect(ctx.settlementProvider).toBeUndefined();
    expect(logger.warns.length).toBeGreaterThanOrEqual(1);
  });
});
