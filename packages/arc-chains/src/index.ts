/**
 * @settlekit/arc-chains — dependency-light source of truth for Arc / Circle
 * chain, token, and contract constants. Pure data + pure functions only.
 *
 * No symbol collisions: SupportedChain lives in chains.ts, SupportedToken in
 * tokens.ts; Erc8004Registries in contracts.ts.
 */

export * from "./chains.js";
export * from "./tokens.js";
export * from "./contracts.js";
