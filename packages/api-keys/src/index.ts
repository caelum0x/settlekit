import { createHash } from "node:crypto";
import { generateId, generateSecret, type ApiKey } from "@settlekit/common";

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function issueApiKey(input: {
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  scopes: string[];
}, now = new Date()): { apiKey: ApiKey; secret: string } {
  const secret = `sk_live_${generateSecret(24)}`;
  return {
    secret,
    apiKey: {
      id: generateId("apiKey"),
      organizationId: input.organizationId,
      customerId: input.customerId,
      productId: input.productId,
      entitlementId: input.entitlementId,
      keyHash: hashApiKey(secret),
      keyPrefix: secret.slice(0, 15),
      scopes: input.scopes,
      status: "active",
      createdAt: now.toISOString(),
    },
  };
}

export function apiKeyHasScope(apiKey: ApiKey, scope: string): boolean {
  return apiKey.status === "active" && apiKey.scopes.includes(scope);
}
