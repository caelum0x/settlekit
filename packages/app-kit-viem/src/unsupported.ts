/**
 * Single source of truth for the "unsupported capability" contract.
 *
 * PROMINENT CAVEAT: the viem backend implements ONLY the SEND capability (a
 * USDC ERC-20 transfer on Arc). bridge / swap / unified-balance deposit & spend
 * are NOT supported — they require Circle's cross-chain infrastructure. Use
 * `@circle-fin/app-kit` (via the default App Kit SDK) for those flows.
 */

import { SettleKitError } from "@settlekit/common";

/** The exact substring all callers/tests can assert against. */
export const UNSUPPORTED_MESSAGE_SUFFIX =
  "not supported by the viem backend — use @circle-fin/app-kit for bridge/swap/unified balance";

/**
 * Throw the canonical "unsupported capability" error.
 *
 * @throws {SettleKitError} always — `validation_error`.
 */
export function notSupported(capability: string): never {
  throw new SettleKitError({
    code: "validation_error",
    message: `${capability} is ${UNSUPPORTED_MESSAGE_SUFFIX}`,
  });
}
