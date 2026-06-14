import { generateSecret } from "@settlekit/common";
import type { DeliveryHandler } from "../types.js";

export const issueApiKey: DeliveryHandler = async (action) => {
  if (action.type !== "api_key_create") throw new Error("invalid action");
  return { scopes: action.scopes, key: `sk_live_${generateSecret(18)}` };
};
