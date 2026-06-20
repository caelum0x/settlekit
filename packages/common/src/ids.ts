/**
 * Identifier + secret generation, implemented on the Web Crypto API
 * (`globalThis.crypto`) so the module is isomorphic: it bundles cleanly into
 * browser/client code (Next.js client components, edge runtimes) as well as
 * Node 20+. Avoiding `node:crypto` here keeps the whole `@settlekit/common`
 * barrel — and every domain package that re-exports through it — importable on
 * the client. Output formats are byte-for-byte compatible with the previous
 * `node:crypto` implementation.
 */
/**
 * Minimal Web Crypto surface we rely on, declared locally so this module needs
 * no DOM lib types (common targets `lib: ["ES2022"]`). Backed by the real
 * `globalThis.crypto` in both Node 20+ and browsers.
 */
interface MinimalCrypto {
  getRandomValues(array: Uint8Array): Uint8Array;
  randomUUID(): string;
}

/**
 * Resolve the Web Crypto implementation. `globalThis.crypto` is a global in
 * Node 20+ (the repo's `engines.node`) and all browsers. Resolved lazily with a
 * clear error so a sub-Node-20 runtime (e.g. a Vercel project still on Node 18)
 * fails with an actionable message instead of a cryptic `undefined` access — and
 * without statically importing `node:crypto`, which would break client bundling.
 */
function webCrypto(): MinimalCrypto {
  const c = (globalThis as { crypto?: MinimalCrypto }).crypto;
  if (c === undefined || typeof c.getRandomValues !== "function") {
    throw new Error(
      "Web Crypto API unavailable: SettleKit requires Node 20+ (global crypto). Pin the runtime to Node 20.",
    );
  }
  return c;
}

/** Random bytes as lowercase hex (Buffer-free, browser-safe). */
function randomHex(bytes: number): string {
  const buf = webCrypto().getRandomValues(new Uint8Array(bytes));
  let hex = "";
  for (const byte of buf) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Random bytes as URL-safe base64 without padding (Buffer-free, browser-safe). */
function randomBase64Url(bytes: number): string {
  const buf = webCrypto().getRandomValues(new Uint8Array(bytes));
  let out = "";
  for (let i = 0; i < buf.length; i += 3) {
    const b0 = buf[i] as number;
    const b1 = i + 1 < buf.length ? (buf[i + 1] as number) : undefined;
    const b2 = i + 2 < buf.length ? (buf[i + 2] as number) : undefined;
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += BASE64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Stripe-style prefixed identifiers. Each resource gets a stable, human-readable
 * prefix so IDs are self-describing in logs, webhooks, and dashboards.
 */
export const ID_PREFIXES = {
  organization: "org",
  user: "user",
  merchant: "mch",
  customer: "cus",
  product: "prod",
  price: "price",
  bundle: "bndl",
  checkoutSession: "cs",
  payment: "pay",
  subscription: "sub",
  usageMeter: "meter",
  creditBalance: "cb",
  entitlement: "ent",
  deliveryPlan: "dplan",
  deliveryRun: "drun",
  deliveryAction: "dact",
  licenseKey: "lic",
  apiKey: "ak",
  githubInstallation: "ghi",
  githubRepoAccess: "ghra",
  discordRoleAccess: "dra",
  fileAsset: "file",
  webhookEndpoint: "we",
  webhookEvent: "evt",
  marketplaceListing: "ml",
  agentService: "ags",
  escrowTask: "esc",
  payoutWallet: "pw",
  riskProfile: "risk",
} as const;

export type ResourceName = keyof typeof ID_PREFIXES;

/** Generate a unique, prefixed identifier for the given resource. */
export function generateId(resource: ResourceName): string {
  const prefix = ID_PREFIXES[resource];
  // 24 hex chars of entropy keeps collisions negligible while staying compact.
  const suffix = randomHex(12);
  return `${prefix}_${suffix}`;
}

/** Returns true if `id` is a well-formed identifier for `resource`. */
export function isId(resource: ResourceName, id: string): boolean {
  return id.startsWith(`${ID_PREFIXES[resource]}_`) && id.length > ID_PREFIXES[resource].length + 1;
}

/** A random UUID v4, used where an opaque correlation token is needed. */
export function uuid(): string {
  return webCrypto().randomUUID();
}

/**
 * Generate a high-entropy secret token (e.g. for API keys / license keys).
 * Returned as URL-safe base64 without padding.
 */
export function generateSecret(bytes = 32): string {
  return randomBase64Url(bytes);
}
