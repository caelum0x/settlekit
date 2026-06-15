/**
 * Aggregates every built-in action handler and exposes a helper that builds a
 * fully-populated {@link HandlerRegistry}.
 */

import type { ActionHandler } from "../types.js";
import { HandlerRegistry } from "../registry.js";
import { grantGithubRepoHandler } from "./grant-github-repo.js";
import { grantGithubTeamHandler } from "./grant-github-team.js";
import { issueLicenseKeyHandler } from "./issue-license-key.js";
import { issueApiKeyHandler } from "./issue-api-key.js";
import { grantFileAccessHandler } from "./grant-file-access.js";
import { grantDiscordRoleHandler } from "./grant-discord-role.js";
import { createSaasEntitlementHandler } from "./create-saas-entitlement.js";
import { sendWebhookHandler } from "./send-webhook.js";
import { sendEmailHandler } from "./send-email.js";

export { grantGithubRepoHandler } from "./grant-github-repo.js";
export { grantGithubTeamHandler } from "./grant-github-team.js";
export { issueLicenseKeyHandler } from "./issue-license-key.js";
export { issueApiKeyHandler } from "./issue-api-key.js";
export { grantFileAccessHandler } from "./grant-file-access.js";
export { grantDiscordRoleHandler } from "./grant-discord-role.js";
export { createSaasEntitlementHandler } from "./create-saas-entitlement.js";
export { sendWebhookHandler } from "./send-webhook.js";
export { sendEmailHandler } from "./send-email.js";

/** Every built-in handler, one per {@link DeliveryActionType}. */
export function allHandlers(): ActionHandler[] {
  return [
    grantGithubRepoHandler(),
    grantGithubTeamHandler(),
    issueLicenseKeyHandler(),
    issueApiKeyHandler(),
    grantFileAccessHandler(),
    grantDiscordRoleHandler(),
    createSaasEntitlementHandler(),
    sendWebhookHandler(),
    sendEmailHandler(),
  ];
}

/** Build a registry pre-loaded with every built-in handler. */
export function createDefaultRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry();
  for (const handler of allHandlers()) {
    registry.register(handler);
  }
  return registry;
}
