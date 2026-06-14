import { verifyEntitlement, type VerifyEntitlementInput } from "@settlekit/entitlements";

export interface SettleKitClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export function createSettleKitClient(options: SettleKitClientOptions) {
  if (!options.apiKey) throw new Error("apiKey is required");
  return {
    entitlements: {
      verify(input: VerifyEntitlementInput) {
        return verifyEntitlement(input);
      },
    },
  };
}

export const settlekit = createSettleKitClient({ apiKey: "sk_test_local" });
