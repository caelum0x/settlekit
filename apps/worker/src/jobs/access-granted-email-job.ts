/**
 * Access-granted email job.
 *
 * Once a delivery run reaches `succeeded`, email the buyer a summary of exactly
 * what they unlocked — invite links, download URLs, license/api keys — rendered
 * with `renderAccessGrantedEmail` / `renderAccessGrantedText`. Idempotency is
 * keyed by delivery run id (`sentAccessEmails`) so a run is summarized once.
 *
 * Each succeeded `DeliveryActionRun` is mapped to a concrete
 * {@link AccessInstruction}, reading the action's recorded `output` (e.g. invite
 * url, signed download url, issued key) so the email reflects the real grant.
 */

import {
  renderAccessGrantedEmail,
  renderAccessGrantedText,
  type AccessGrantedArgs,
  type AccessInstruction,
} from "@settlekit/notifications";
import { toIso } from "@settlekit/common";
import type {
  Customer,
  DeliveryAction,
  DeliveryActionRun,
  Entitlement,
  EntitlementType,
} from "@settlekit/common";
import { errorMessage } from "../logger.js";
import { resolveCustomer, resolveMerchant } from "./email-helpers.js";
import type { QueuedDeliveryRun } from "../stores.js";
import type { Job, JobContext, JobResult } from "./types.js";

/** Read a string field from an action-run output bag, if present. */
function outputString(output: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = output?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Map a delivery action type to the entitlement type it provisions. */
function entitlementTypeFor(action: DeliveryAction): EntitlementType {
  switch (action.type) {
    case "github_invite":
      return "github_repo_access";
    case "github_team_add":
      return "github_team_access";
    case "license_key_create":
      return "license_key";
    case "api_key_create":
      return "api_access";
    case "file_access_grant":
      return "file_access";
    case "discord_role_add":
      return "discord_role";
    case "saas_entitlement_create":
      return "saas_feature";
    case "webhook_send":
    case "email_send":
      return "support_plan";
  }
}

/** Build a buyer-facing instruction from a single succeeded action run. */
function instructionFor(run: DeliveryActionRun): AccessInstruction {
  const action = run.action;
  const type = entitlementTypeFor(action);
  const url = outputString(run.output, "url") ?? outputString(run.output, "inviteUrl");

  switch (action.type) {
    case "github_invite":
      return {
        entitlementType: type,
        title: "GitHub repository access",
        description: "You've been invited as a collaborator. Accept the invite to get access.",
        ...(url ? { url } : {}),
      };
    case "github_team_add":
      return {
        entitlementType: type,
        title: "GitHub team access",
        description: `You've been added to the ${action.orgLogin}/${action.teamSlug} team.`,
        ...(url ? { url } : {}),
      };
    case "license_key_create": {
      const secret = outputString(run.output, "key") ?? outputString(run.output, "licenseKey");
      return {
        entitlementType: type,
        title: "License key",
        description: "Use this license key to activate your purchase.",
        ...(secret ? { secret } : {}),
      };
    }
    case "api_key_create": {
      const secret = outputString(run.output, "plaintext") ?? outputString(run.output, "apiKey");
      return {
        entitlementType: type,
        title: "API key",
        description: "Store this API key securely — it is shown only once.",
        ...(secret ? { secret } : {}),
      };
    }
    case "file_access_grant":
      return {
        entitlementType: type,
        title: "File download",
        description: "Your download is ready at the link below.",
        ...(url ? { url } : {}),
      };
    case "discord_role_add":
      return {
        entitlementType: type,
        title: "Discord access",
        description: "Your Discord role has been granted.",
        ...(url ? { url } : {}),
      };
    case "saas_entitlement_create":
      return {
        entitlementType: type,
        title: "Plan features unlocked",
        description: "Your account has been upgraded with the purchased features.",
        ...(url ? { url } : {}),
      };
    case "webhook_send":
    case "email_send":
      return {
        entitlementType: type,
        title: "Purchase confirmed",
        description: "Your purchase has been processed.",
        ...(url ? { url } : {}),
      };
  }
}

/** Synthesize a minimal Entitlement record to pair with each instruction. */
function entitlementFor(item: QueuedDeliveryRun, instruction: AccessInstruction, now: Date): Entitlement {
  const stamp = toIso(now);
  return {
    id: `${item.entitlementId}_${instruction.entitlementType}`,
    organizationId: item.organizationId,
    customerId: item.customerId,
    productId: item.productId,
    grantedBy: { type: "payment", id: item.paymentId },
    entitlementType: instruction.entitlementType,
    status: "active",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

async function buildArgs(item: QueuedDeliveryRun, customer: Customer, ctx: JobContext, now: Date): Promise<AccessGrantedArgs> {
  const succeeded = item.run.actionRuns.filter((r) => r.status === "succeeded");
  const entitlements = succeeded.map((run) => {
    const instruction = instructionFor(run);
    return { entitlement: entitlementFor(item, instruction, now), instruction };
  });
  const merchant = await resolveMerchant(ctx, item.organizationId);
  return {
    customer,
    entitlements,
    ...(merchant ? { merchant } : {}),
  };
}

export const accessGrantedEmailJob: Job = {
  name: "access-granted-email",
  async run(ctx: JobContext): Promise<JobResult> {
    const now = ctx.now();
    let processed = 0;
    let failed = 0;

    const succeededRuns = await ctx.stores.succeededDeliveryRuns();

    for (const item of succeededRuns) {
      if (await ctx.stores.hasSentEmail("access_granted", item.run.id)) continue;

      // Prefer the stored customer contact; fall back to the email captured on
      // the queued run from the original checkout.
      const customer =
        (await resolveCustomer(ctx, item.customerId)) ??
        (item.customerEmail
          ? ({
              id: item.customerId,
              organizationId: item.organizationId,
              email: item.customerEmail,
              metadata: {},
              createdAt: toIso(now),
            } satisfies Customer)
          : undefined);

      if (!customer) {
        ctx.logger.warn("access-granted email skipped; no recipient on record", {
          deliveryRunId: item.run.id,
          customerId: item.customerId,
        });
        continue;
      }

      const args = await buildArgs(item, customer, ctx, now);
      if (args.entitlements.length === 0) {
        // Nothing actionable to summarize; mark sent so we don't re-scan it.
        await ctx.stores.markEmailSent("access_granted", item.run.id);
        continue;
      }

      try {
        const html = renderAccessGrantedEmail(args);
        const text = renderAccessGrantedText(args);
        const result = await ctx.email.send({
          to: customer.email,
          subject: args.merchant ? `Your access from ${args.merchant.displayName}` : "Your access is ready",
          html,
          text,
          ...(args.merchant?.supportEmail ? { replyTo: args.merchant.supportEmail } : {}),
          tags: [
            { name: "type", value: "access_granted" },
            { name: "delivery_run_id", value: item.run.id },
          ],
        });

        await ctx.stores.markEmailSent("access_granted", item.run.id);
        processed += 1;
        ctx.logger.info("access-granted email sent", {
          deliveryRunId: item.run.id,
          to: customer.email,
          grants: args.entitlements.length,
          messageId: result.id,
        });
      } catch (error) {
        failed += 1;
        ctx.logger.error("access-granted email failed", {
          deliveryRunId: item.run.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
