/**
 * Real Circle Developer-Controlled-Wallets client via the official
 * `@circle-fin/developer-controlled-wallets` SDK — an alternative to this
 * package's raw-HTTP `WalletsClient` for callers who want Circle's maintained
 * SDK (entity-secret ciphertext handling, typed responses, contract execution).
 *
 * The SDK is loaded via dynamic `import()` so it never enters a bundle unless a
 * caller builds a live client. Credentials come from config/env, never hardcoded.
 *
 * Usage:
 * ```ts
 * const dcw = await createDcwSdkClient({
 *   apiKey: process.env.CIRCLE_API_KEY!,
 *   entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
 * });
 * await dcw.createContractExecutionTransaction({ ... });
 * ```
 */

/** Credentials for the real Circle DCW SDK. */
export interface DcwSdkConfig {
  /** Circle Developer API key (Standard key). */
  apiKey: string;
  /** Registered Entity Secret. */
  entitySecret: string;
  /** Optional base URL override. */
  baseUrl?: string;
}

/**
 * The official DCW client (typed loosely so this package needs no compile-time
 * dependency on the SDK's surface). Call its methods —
 * `createWalletSet`, `createWallets`, `createContractExecutionTransaction`,
 * `getTransaction`, etc. — per Circle's docs.
 */
export type DcwSdkClient = Record<string, unknown> & {
  [method: string]: unknown;
};

/** Build a real Circle DCW SDK client. Throws if credentials are missing. */
export async function createDcwSdkClient(config: DcwSdkConfig): Promise<DcwSdkClient> {
  if (!config.apiKey || !config.entitySecret) {
    throw new Error("createDcwSdkClient: apiKey and entitySecret are required");
  }
  const mod = await import("@circle-fin/developer-controlled-wallets");
  return mod.initiateDeveloperControlledWalletsClient({
    apiKey: config.apiKey,
    entitySecret: config.entitySecret,
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
  }) as unknown as DcwSdkClient;
}
