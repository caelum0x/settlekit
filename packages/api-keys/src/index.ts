export { hashApiKey } from "./hash.js";
export { issueApiKey } from "./issue.js";
export { verifyApiKey } from "./verify.js";
export { hasScope, hasAllScopes } from "./scopes.js";
export { recordUsage, revoke } from "./lifecycle.js";
export { ApiKeyService } from "./service.js";
export { InMemoryApiKeyStore } from "./store.js";
export type { ApiKeyStore } from "./store.js";
export type {
  ApiKeyEnv,
  IssueApiKeyInput,
  IssueApiKeyResult,
  VerifyApiKeyResult,
} from "./types.js";
export {
  WILDCARD_SCOPE,
  PLATFORM_ADMIN_SCOPE,
  PLATFORM_KEY_PRODUCT,
  SCOPE_RESOURCES,
  MANAGEMENT_SCOPES,
  TEAM_ROLES,
  isManagementScope,
  isPlatformKey,
  isTeamRole,
  requiredScope,
  scopesAllow,
  scopesForRole,
} from "./policy.js";
export type { ManagementScope, ScopeAction, ScopeResource, TeamRole } from "./policy.js";
