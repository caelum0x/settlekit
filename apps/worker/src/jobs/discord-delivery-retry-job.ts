/**
 * Discord delivery retry.
 *
 * The hosted checkout adds the paid Discord role right after a payment
 * confirms. When the seller's bot was not configured yet, the buyer had not
 * joined the server, or Discord failed, the entitlement is stored `pending`
 * and the buyer sees "pending setup". This job grants it: for every PENDING
 * Discord entitlement granted by a CONFIRMED payment it calls
 * PUT /guilds/{guild}/members/{user}/roles/{role} through the worker's bot,
 * records the grant (so access-sync revokes it on refund / expiry) and flips
 * the entitlement to `active`. Never fabricates access:
 *
 *   - it only runs when DISCORD_BOT_TOKEN is configured;
 *   - payments with a queued delivery run are left to the delivery runner;
 *   - guild/role come from the entitlement or product settings and the user id
 *     from the checkout session (Connect Discord / entered id), never guessed;
 *   - failures back off exponentially per entitlement (5 min doubling to 6 h).
 */
import type { Entitlement } from "@settlekit/common";
import { grantDiscordRole } from "@settlekit/discord";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

export const RETRY_BASE_MS = 5 * 60_000;
export const RETRY_MAX_MS = 6 * 60 * 60_000;
export const MAX_PER_TICK = 25;
const SNOWFLAKE = /^\d{15,21}$/;

interface Backoff {
  attempts: number;
  nextAt: number;
}

type Attempt = { status: "delivered"; resourceId: string } | { status: "skipped" } | { status: "failed"; reason: string };

function snowflake(value: unknown): string | undefined {
  return typeof value === "string" && SNOWFLAKE.test(value.trim()) ? value.trim() : undefined;
}

async function attempt(ctx: JobContext, entitlement: Entitlement): Promise<Attempt> {
  const payment = await ctx.stores.getPayment(entitlement.grantedBy.id);
  if (payment?.status !== "confirmed") return { status: "skipped" };
  if (await ctx.stores.deliveryRunByPayment(payment.id)) return { status: "skipped" };
  const session = await ctx.stores.getCheckoutSession(payment.checkoutSessionId);
  const userId = snowflake(session?.collectedFields.discordUserId);
  if (!userId) return { status: "failed", reason: "no Discord account was connected at checkout" };
  const product = await ctx.stores.getProduct(entitlement.productId);
  const [entGuild, entRole] = (entitlement.resourceId ?? "").split("/");
  const guildId = snowflake(entGuild) ?? snowflake(product?.metadata?.guildId);
  const roleId = snowflake(entRole) ?? snowflake(product?.metadata?.roleId);
  if (!guildId || !roleId) return { status: "failed", reason: "the product has no Discord server and role configured" };

  const grant = await grantDiscordRole(ctx.discordApi, {
    organizationId: entitlement.organizationId,
    guildId,
    roleId,
    customerId: entitlement.customerId,
    entitlementId: entitlement.id,
    discordUserId: userId,
  });
  if (grant.status !== "active") return { status: "failed", reason: "Discord refused the role (buyer not in the server, or bot role too low)" };
  await ctx.stores.upsertDiscordGrant(grant);
  return { status: "delivered", resourceId: `${guildId}/${roleId}` };
}

function isRetryCandidate(entitlement: Entitlement): boolean {
  return entitlement.status === "pending" && entitlement.grantedBy.type === "payment" && entitlement.entitlementType === "discord_role";
}

export function createDiscordDeliveryRetryJob(backoff: Map<string, Backoff> = new Map()): Job {
  return {
    name: "discord-delivery-retry",
    async run(ctx: JobContext): Promise<JobResult> {
      if (!ctx.config.discord.configured) return { processed: 0, failed: 0 };
      const now = ctx.now();
      const due = (await ctx.stores.allEntitlements())
        .filter(isRetryCandidate)
        .filter((e) => (backoff.get(e.id)?.nextAt ?? 0) <= now.getTime())
        .slice(0, MAX_PER_TICK);
      let processed = 0;
      let failed = 0;
      for (const entitlement of due) {
        let outcome: Attempt;
        try {
          outcome = await attempt(ctx, entitlement);
        } catch (error) {
          outcome = { status: "failed", reason: errorMessage(error) };
        }
        if (outcome.status === "skipped") continue;
        if (outcome.status === "delivered") {
          await ctx.stores.upsertEntitlement({ ...entitlement, status: "active", resourceId: outcome.resourceId, updatedAt: now.toISOString() });
          backoff.delete(entitlement.id);
          processed += 1;
          ctx.logger.info("discord role delivered on retry", { entitlementId: entitlement.id, target: outcome.resourceId });
          continue;
        }
        const attempts = (backoff.get(entitlement.id)?.attempts ?? 0) + 1;
        const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
        backoff.set(entitlement.id, { attempts, nextAt: now.getTime() + delay });
        failed += 1;
        ctx.logger.warn("discord delivery retry failed", { entitlementId: entitlement.id, attempts, retryInMs: delay, reason: outcome.reason });
      }
      return { processed, failed };
    },
  };
}

export const discordDeliveryRetryJob: Job = createDiscordDeliveryRetryJob();
