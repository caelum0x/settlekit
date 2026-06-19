/**
 * A realistic, runnable seed: the dependency tree of a typical web app, with
 * real maintainer handles, a funding profile, and a payee registry where some
 * maintainers have registered a wallet and some have not. It exercises the whole
 * pipeline offline — manifest + lockfile parsing, transitive criticality, the
 * claimed/escrow split — so the CLI and the public API route both run anywhere.
 *
 * The shape is the real story: well-funded orgs (facebook, vercel, microsoft)
 * sit next to the tiny, unfunded maintainers whose one-file packages the whole
 * tree leans on (loose-envify, color-name, is-number) — exactly the people the
 * tool is built to reach.
 */

import { InMemoryPayeeRegistry, type PayeeRegistry } from "@settlekit/payee-registry";
import { RegistryMaintainerResolver, type MaintainerInfo, type MaintainerResolver } from "./resolver.js";

/** A typical Next.js + Express app manifest. */
export function seedManifestJson(): string {
  return JSON.stringify({
    name: "acme-web",
    dependencies: {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      next: "^14.2.5",
      express: "^4.19.2",
      axios: "^1.7.2",
      chalk: "^5.3.0",
      lodash: "^4.17.21",
      zod: "^3.23.8",
      "is-number": "^7.0.0",
      "left-pad": "^1.3.0",
    },
    devDependencies: {
      typescript: "^5.5.4",
      vitest: "^2.0.5",
      eslint: "^9.7.0",
    },
  });
}

/** A matching npm `package-lock.json` (v3) giving the transitive edge set. */
export function seedLockJson(): string {
  const pkg = (version: string, deps?: Record<string, string>) => ({
    version,
    ...(deps !== undefined ? { dependencies: deps } : {}),
  });
  return JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "node_modules/react": pkg("18.3.1", { "loose-envify": "^1.1.0" }),
      "node_modules/react-dom": pkg("18.3.1", { "loose-envify": "^1.1.0", scheduler: "^0.23.2" }),
      "node_modules/scheduler": pkg("0.23.2", { "loose-envify": "^1.1.0" }),
      "node_modules/loose-envify": pkg("1.4.0", { "js-tokens": "^4.0.0" }),
      "node_modules/js-tokens": pkg("4.0.0"),
      "node_modules/next": pkg("14.2.5", { react: "^18.3.1", "react-dom": "^18.3.1", postcss: "8.4.31" }),
      "node_modules/postcss": pkg("8.4.31", { "color-convert": "^2.0.1" }),
      "node_modules/express": pkg("4.19.2", { "body-parser": "^1.20.2", debug: "^2.6.9", qs: "^6.11.0" }),
      "node_modules/body-parser": pkg("1.20.2", { debug: "^2.6.9", qs: "^6.11.0" }),
      "node_modules/debug": pkg("2.6.9", { ms: "^2.0.0" }),
      "node_modules/ms": pkg("2.0.0"),
      "node_modules/qs": pkg("6.12.1"),
      "node_modules/axios": pkg("1.7.2", { "follow-redirects": "^1.15.6" }),
      "node_modules/follow-redirects": pkg("1.15.6"),
      "node_modules/chalk": pkg("5.3.0", { "ansi-styles": "^6.2.1", "supports-color": "^9.4.0" }),
      "node_modules/ansi-styles": pkg("6.2.1", { "color-convert": "^2.0.1" }),
      "node_modules/color-convert": pkg("2.0.1", { "color-name": "^1.1.4" }),
      "node_modules/color-name": pkg("1.1.4"),
      "node_modules/supports-color": pkg("9.4.0", { "has-flag": "^4.0.0" }),
      "node_modules/has-flag": pkg("4.0.0"),
      "node_modules/lodash": pkg("4.17.21"),
      "node_modules/zod": pkg("3.23.8"),
      "node_modules/is-number": pkg("7.0.0"),
      "node_modules/left-pad": pkg("1.3.0"),
      "node_modules/typescript": pkg("5.5.4"),
      "node_modules/vitest": pkg("2.0.5", { chai: "^5.1.1", debug: "^4.3.5" }),
      "node_modules/chai": pkg("5.1.1"),
      "node_modules/eslint": pkg("9.7.0", { debug: "^4.3.5" }),
    },
  });
}

interface SeedEntry extends MaintainerInfo {
  /** Whether this maintainer has registered a payout wallet (else → escrow). */
  claimed: boolean;
}

/** package → maintainer handle, known monthly funding, and registration state. */
const SEED: Record<string, SeedEntry> = {
  react: { handle: "facebook", existingMonthlyUsd: "8000", claimed: true },
  "react-dom": { handle: "facebook", existingMonthlyUsd: "8000", claimed: true },
  scheduler: { handle: "facebook", existingMonthlyUsd: "8000", claimed: true },
  next: { handle: "vercel", existingMonthlyUsd: "12000", claimed: true },
  ms: { handle: "vercel", existingMonthlyUsd: "12000", claimed: true },
  express: { handle: "expressjs", existingMonthlyUsd: "3000", claimed: true },
  "body-parser": { handle: "expressjs", existingMonthlyUsd: "3000", claimed: true },
  qs: { handle: "ljharb", existingMonthlyUsd: "400", claimed: true },
  debug: { handle: "debug-js", existingMonthlyUsd: "150", claimed: true },
  axios: { handle: "axios", existingMonthlyUsd: "1200", claimed: true },
  chalk: { handle: "sindresorhus", existingMonthlyUsd: "5000", claimed: true },
  "ansi-styles": { handle: "sindresorhus", existingMonthlyUsd: "5000", claimed: true },
  "supports-color": { handle: "sindresorhus", existingMonthlyUsd: "5000", claimed: true },
  "has-flag": { handle: "sindresorhus", existingMonthlyUsd: "5000", claimed: true },
  lodash: { handle: "jdalton", existingMonthlyUsd: "600", claimed: true },
  zod: { handle: "colinhacks", existingMonthlyUsd: "800", claimed: true },
  typescript: { handle: "microsoft", existingMonthlyUsd: "50000", claimed: true },
  vitest: { handle: "vitest-dev", existingMonthlyUsd: "2000", claimed: true },
  eslint: { handle: "eslint", existingMonthlyUsd: "4000", claimed: true },
  // The tail: load-bearing, one-file packages whose maintainers get nothing and
  // have never registered a wallet — their share is set aside in escrow.
  "loose-envify": { handle: "zertosh", existingMonthlyUsd: "0", claimed: false },
  "js-tokens": { handle: "lydell", existingMonthlyUsd: "0", claimed: false },
  "color-convert": { handle: "qix-", existingMonthlyUsd: "0", claimed: false },
  "color-name": { handle: "dfcreative", existingMonthlyUsd: "0", claimed: false },
  "follow-redirects": { handle: "follow-redirects-org", existingMonthlyUsd: "0", claimed: false },
  postcss: { handle: "postcss", existingMonthlyUsd: "900", claimed: true },
  chai: { handle: "chaijs", existingMonthlyUsd: "0", claimed: false },
  "is-number": { handle: "jonschlinkert", existingMonthlyUsd: "0", claimed: false },
  "left-pad": { handle: "stevemao", existingMonthlyUsd: "0", claimed: false },
};

/** A deterministic, address-shaped wallet for a handle (demo only). */
function seedWallet(handle: string): string {
  let hex = "";
  for (let i = 0; i < handle.length && hex.length < 40; i += 1) {
    hex += handle.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return `0x${hex.padEnd(40, "0").slice(0, 40)}`;
}

/**
 * The unclaimed-earnings escrow wallet shares are routed to until claimed. A
 * valid-hex address so it round-trips through the on-chain distributor calldata.
 */
export const SEED_ESCROW_WALLET = "0x000000000000000000000000000000000e5c0eee";

/** package → {handle, existingMonthlyUsd} for the resolver. */
export function seedMaintainers(): Map<string, MaintainerInfo> {
  const map = new Map<string, MaintainerInfo>();
  for (const [name, entry] of Object.entries(SEED)) {
    map.set(name, { handle: entry.handle, ...(entry.existingMonthlyUsd !== undefined ? { existingMonthlyUsd: entry.existingMonthlyUsd } : {}) });
  }
  return map;
}

/** A payee registry pre-populated with the wallets maintainers have claimed. */
export async function seedRegistry(): Promise<PayeeRegistry> {
  const registry = new InMemoryPayeeRegistry();
  const registered = new Set<string>();
  for (const entry of Object.values(SEED)) {
    if (!entry.claimed || registered.has(entry.handle)) continue;
    registered.add(entry.handle);
    await registry.register({ kind: "handle", externalId: entry.handle, wallet: seedWallet(entry.handle), displayName: entry.handle });
  }
  return registry;
}

/** A fully-wired resolver over the seed data. */
export async function seedResolver(): Promise<MaintainerResolver> {
  const registry = await seedRegistry();
  return new RegistryMaintainerResolver(registry, {
    escrowWallet: SEED_ESCROW_WALLET,
    maintainers: seedMaintainers(),
  });
}
