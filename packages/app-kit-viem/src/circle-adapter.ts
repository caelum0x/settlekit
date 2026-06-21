/**
 * Live App Kit signer adapters via Circle's official `@circle-fin/adapter-viem-v2`.
 *
 * These build the opaque signing adapter that the real Circle App Kit
 * (`@circle-fin/app-kit`) threads through `send`/`bridge`/`swap`. Pair with
 * `configureAppKit({ sdk: new AppKit() })` from `@settlekit/app-kit` for a true
 * on-chain send (unlike the offline `createViemAppKitSdk`, which is a local
 * ERC-20 simulation).
 *
 * The SDK is loaded via dynamic `import()` so it never enters a bundle unless a
 * caller actually builds a live adapter — keeping default/offline builds lean.
 * Server callers use a private key; browser callers pass an EIP-1193 provider.
 * Keys come from config/env, never hardcoded.
 */

/** The opaque adapter object Circle App Kit consumes; treated as unknown here. */
export type CircleViemAdapter = unknown;

/** Build a live adapter from a 0x private key (server-side signer). */
export async function createCircleViemAdapterFromPrivateKey(
  privateKey: string,
): Promise<CircleViemAdapter> {
  if (typeof privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("createCircleViemAdapterFromPrivateKey: a 0x 32-byte private key is required");
  }
  const mod = await import("@circle-fin/adapter-viem-v2");
  return mod.createViemAdapterFromPrivateKey({ privateKey: privateKey as `0x${string}` });
}

/** Build a live adapter from an injected EIP-1193 provider (browser wallet). */
export async function createCircleViemAdapterFromProvider(
  provider: unknown,
): Promise<CircleViemAdapter> {
  if (provider === undefined || provider === null) {
    throw new Error("createCircleViemAdapterFromProvider: an EIP-1193 provider is required");
  }
  const mod = await import("@circle-fin/adapter-viem-v2");
  // viem-v2's provider adapter; the provider is the wallet's EIP-1193 object.
  return mod.createViemAdapterFromProvider(provider as never);
}
