#!/usr/bin/env node
/**
 * `settlekit` — the official SettleKit command-line interface.
 *
 * Wires every command group onto a single commander program with global
 * connection flags (`--api-url`, `--api-key`, `--json`) and a top-level error
 * handler that prints a clean message and exits non-zero on failure.
 *
 * Usage:
 *   settlekit products list
 *   settlekit checkout create --merchant-id mch_1 --organization-id org_1 ...
 *   settlekit license-keys verify --license-key SK-... --product-id prod_1 --machine-id m1
 */
import { Command } from "commander";
import { formatError } from "./output.js";
import { DEFAULT_API_URL } from "./config.js";
import { registerProducts } from "./commands/products.js";
import { registerCustomers } from "./commands/customers.js";
import { registerCheckout } from "./commands/checkout.js";
import { registerPayments } from "./commands/payments.js";
import { registerLicenseKeys } from "./commands/license-keys.js";
import { registerApiKeys } from "./commands/api-keys.js";
import { registerCoupons } from "./commands/coupons.js";
import { registerInvoices } from "./commands/invoices.js";
import { registerMarketplace } from "./commands/marketplace.js";
import { registerAgentServices } from "./commands/agent-services.js";
import { registerPayouts } from "./commands/payouts.js";
import { registerUsage } from "./commands/usage.js";
import { registerWebhooks } from "./commands/webhooks.js";
import { registerSubscriptions } from "./commands/subscriptions.js";
import { registerEntitlements } from "./commands/entitlements.js";
import { registerRefunds } from "./commands/refunds.js";
import { registerDisputes } from "./commands/disputes.js";
import { registerDunning } from "./commands/dunning.js";
import { registerSettings } from "./commands/settings.js";

function buildProgram(): Command {
  const program = new Command();
  program
    .name("settlekit")
    .description("Official SettleKit CLI — sell software, repos, SaaS, APIs, and AI tools in USDC.")
    .version("0.0.0")
    .option("--api-url <url>", `SettleKit API base URL (env SETTLEKIT_API_URL)`, undefined)
    .option("--api-key <key>", "API key for Bearer auth (env SETTLEKIT_API_KEY)", undefined)
    .option("--json", "Print raw JSON instead of formatted tables", false)
    .addHelpText("after", `\nConnection:\n  Defaults to ${DEFAULT_API_URL}. Set SETTLEKIT_API_URL / SETTLEKIT_API_KEY or pass --api-url / --api-key.`);

  registerProducts(program);
  registerCustomers(program);
  registerCheckout(program);
  registerPayments(program);
  registerLicenseKeys(program);
  registerApiKeys(program);
  registerCoupons(program);
  registerInvoices(program);
  registerMarketplace(program);
  registerAgentServices(program);
  registerPayouts(program);
  registerUsage(program);
  registerWebhooks(program);
  registerSubscriptions(program);
  registerEntitlements(program);
  registerRefunds(program);
  registerDisputes(program);
  registerDunning(program);
  registerSettings(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    process.stderr.write(`${formatError(err)}\n`);
    process.exitCode = 1;
  }
}

void main();
