/**
 * Local re-export of the `@settlekit/sdk` public API.
 *
 * The `examples/` directory is NOT part of the pnpm workspace (the workspace
 * globs only cover `packages/*` and `apps/*`), so a `workspace:*` dependency
 * would not resolve here. To keep this example runnable with zero extra install
 * steps, we import the package by a relative path to its compiled output.
 *
 * Prerequisite: build the SDK first from the monorepo root:
 *
 *     pnpm --filter @settlekit/sdk build
 *
 * NodeNext resolution picks up the sibling `index.d.ts` for types and
 * `index.js` for runtime, so both `tsc` and `tsx`/`node` work unchanged. If you
 * install `@settlekit/sdk` as a real dependency, change the import below to
 * `"@settlekit/sdk"` — nothing else in this example needs to change.
 */
export { SettleKit, SettleKitApiError } from "../../../packages/sdk/dist/index.js";

export type {
  Product,
  Price,
  Customer,
  Subscription,
  Entitlement,
  DunningState,
} from "../../../packages/sdk/dist/index.js";
