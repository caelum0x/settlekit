/**
 * Derive a product's delivery actions for an agent purchase.
 *
 * `metadata.deliveryActions` (an explicit, validated action list) wins;
 * otherwise the action follows the product's `deliveryMode` + metadata, the
 * same mapping the checkout app uses. Actions that need a buyer identity
 * (GitHub login, Discord user, email) report it as a required field so the
 * API can reject the request BEFORE any payment is settled.
 */
import { z } from "zod";
import type { DeliveryAction, Product } from "@settlekit/common";

export type BuyerField = "githubUsername" | "discordUserId" | "email";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("github_invite"), repoId: z.string().min(1), permission: z.enum(["pull", "push", "maintain"]).optional() }),
  z.object({ type: z.literal("github_team_add"), orgLogin: z.string().min(1), teamSlug: z.string().min(1) }),
  z.object({ type: z.literal("license_key_create"), policyId: z.string().min(1) }),
  z.object({ type: z.literal("api_key_create"), scopes: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("file_access_grant"), fileId: z.string().min(1) }),
  z.object({ type: z.literal("discord_role_add"), guildId: z.string().min(1), roleId: z.string().min(1) }),
  z.object({ type: z.literal("saas_entitlement_create"), features: z.record(z.union([z.boolean(), z.number(), z.string()])) }),
  z.object({ type: z.literal("webhook_send"), url: z.string().url() }),
  z.object({ type: z.literal("email_send"), template: z.string().min(1) }),
]);

function str(meta: Record<string, unknown>, key: string, fallback = ""): string {
  const value = meta[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function strArray(meta: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const value = meta[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : fallback;
}

function fromMode(product: Product): DeliveryAction | undefined {
  const meta = product.metadata ?? {};
  switch (product.deliveryMode) {
    case "github_invite":
      return { type: "github_invite", repoId: str(meta, "repoId", product.id) };
    case "github_team_add":
      return { type: "github_team_add", orgLogin: str(meta, "orgLogin"), teamSlug: str(meta, "teamSlug") };
    case "license_key":
      return { type: "license_key_create", policyId: str(meta, "policyId", `pol_${product.id}`) };
    case "api_key":
      return { type: "api_key_create", scopes: strArray(meta, "scopes", ["read"]) };
    case "file_download":
      return { type: "file_access_grant", fileId: str(meta, "fileId", product.id) };
    case "discord_role":
      return { type: "discord_role_add", guildId: str(meta, "guildId"), roleId: str(meta, "roleId") };
    case "saas_entitlement": {
      const features = meta.features;
      return {
        type: "saas_entitlement_create",
        features: features && typeof features === "object" ? (features as Record<string, boolean | number | string>) : {},
      };
    }
    case "webhook":
      return { type: "webhook_send", url: str(meta, "url") };
    case "email":
      return { type: "email_send", template: str(meta, "template", "access_granted") };
    default:
      return undefined;
  }
}

/** The ordered delivery actions for `product` (empty for bundle/none). */
export function deliveryActionsFor(product: Product): DeliveryAction[] {
  const explicit = product.metadata?.deliveryActions;
  if (explicit !== undefined) {
    const parsed = z.array(actionSchema).safeParse(explicit);
    if (parsed.success) return parsed.data as DeliveryAction[];
  }
  const action = fromMode(product);
  return action ? [action] : [];
}

/** Buyer fields the actions need to execute. */
export function requiredBuyerFields(actions: readonly DeliveryAction[]): BuyerField[] {
  const fields = new Set<BuyerField>();
  for (const action of actions) {
    if (action.type === "github_invite" || action.type === "github_team_add") fields.add("githubUsername");
    if (action.type === "discord_role_add") fields.add("discordUserId");
    if (action.type === "email_send") fields.add("email");
  }
  return [...fields];
}
