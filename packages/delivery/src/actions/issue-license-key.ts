import { generateSecret } from "@settlekit/common";
import type { DeliveryHandler } from "../types.js";

export const issueLicenseKey: DeliveryHandler = async (action) => {
  if (action.type !== "license_key_create") throw new Error("invalid action");
  return { policyId: action.policyId, key: `sk_lic_${generateSecret(18)}` };
};
