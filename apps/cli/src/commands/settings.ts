/**
 * `settlekit settings` — read and patch organization settings.
 *
 *   get                  GET  /v1/settings?organizationId=
 *   update               POST /v1/settings
 */
import type { Command } from "commander";
import { buildContext } from "../context.js";

const RAILS = ["arc", "circle", "x402"] as const;

interface OrgSettings extends Record<string, unknown> {
  orgName: string;
  supportEmail: string;
  payoutCurrency: string;
  webhookSecret: string;
  defaultRail: string;
}

export function registerSettings(program: Command): void {
  const settings = program.command("settings").description("Read and patch organization settings");

  settings
    .command("get")
    .description("Read organization settings (defaults to the platform org)")
    .option("--organization-id <id>", "Organization id")
    .action(async function (this: Command) {
      const opts = this.opts();
      const ctx = buildContext(this);
      const current = await ctx.client.get<OrgSettings>("/v1/settings", {
        organizationId: opts.organizationId,
      });
      ctx.printRecord(current);
    });

  settings
    .command("update")
    .description("Patch settings (only provided fields change)")
    .option("--organization-id <id>", "Organization id")
    .option("--org-name <name>", "Organization display name")
    .option("--support-email <email>", "Customer-facing support email")
    .option("--payout-currency <currency>", "Payout currency, e.g. USDC")
    .option("--webhook-secret <secret>", "Signing secret for outbound webhooks")
    .option("--default-rail <rail>", `Default payment rail (${RAILS.join(" | ")})`)
    .action(async function (this: Command) {
      const opts = this.opts();
      if (opts.defaultRail && !RAILS.includes(opts.defaultRail)) {
        throw new Error(`--default-rail must be one of: ${RAILS.join(", ")}`);
      }
      const ctx = buildContext(this);
      const body: Record<string, unknown> = {};
      if (opts.organizationId) body.organizationId = opts.organizationId;
      if (opts.orgName) body.orgName = opts.orgName;
      if (opts.supportEmail !== undefined) body.supportEmail = opts.supportEmail;
      if (opts.payoutCurrency) body.payoutCurrency = opts.payoutCurrency;
      if (opts.webhookSecret !== undefined) body.webhookSecret = opts.webhookSecret;
      if (opts.defaultRail) body.defaultRail = opts.defaultRail;
      const updated = await ctx.client.post<OrgSettings>("/v1/settings", body);
      ctx.printRecord(updated);
    });
}
