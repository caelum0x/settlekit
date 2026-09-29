/**
 * "Connect your business" onboarding for external small teams, over the
 * existing SettleKit API only:
 *
 *   1. POST /v1/auth/register (merchant)  -> the team's own org + API key
 *   2. POST /v1/products (+ /prices, /publish) with the team's key
 *   3. POST /v1/checkout-sessions, network "arc", payTo = the team's
 *      OperatorVault -> a hosted Arc USDC checkout link into the vault
 *
 * Caps and the payout allowlist are enforced by the team's own OperatorVault
 * on Arc. This module renders the exact deploy / setAllowlist commands and
 * the matching off-chain policy; it never holds the team's funds or keys.
 */
import { createHash } from "node:crypto";
import type { FetchLike } from "./api-client";

import { PRODUCT_KINDS, type ProductKind } from "./onboarding-kinds";

export { PRODUCT_KINDS, type ProductKind };

export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
export const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USDC_RE = /^\d{1,12}(\.\d{1,6})?$/;
const MAX_ALLOWLIST = 20;

export interface ConnectInput {
  readonly teamName: string;
  readonly email: string;
  readonly password: string;
  readonly productName: string;
  readonly productKind: ProductKind;
  readonly priceUsdc: string;
  readonly ownerAddress: string;
  readonly vaultAddress: string | null;
  readonly allowlist: readonly string[];
  readonly perTxCap: string;
  readonly dailyCap: string;
  readonly escalateAbove: string;
}

export type FieldErrors = Readonly<Record<string, string>>;
export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: FieldErrors };

const field = (form: Readonly<Record<string, unknown>>, key: string): string => {
  const value = form[key];
  return typeof value === "string" ? value.trim() : "";
};

/** USDC decimal -> base units (6 dp), exact. */
export function toBaseUnits(decimal: string): bigint {
  const [whole = "0", frac = ""] = decimal.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0").slice(0, 6) || "0");
}

function positiveUsdc(value: string): boolean {
  return USDC_RE.test(value) && toBaseUnits(value) > 0n;
}

/** Validate the untrusted onboarding form (all errors at once). */
export function parseConnectForm(form: Readonly<Record<string, unknown>>): ParseResult<ConnectInput> {
  const errors: Record<string, string> = {};
  const teamName = field(form, "teamName");
  const email = field(form, "email").toLowerCase();
  const password = typeof form.password === "string" ? form.password : "";
  const productName = field(form, "productName");
  const productKind = field(form, "productKind") as ProductKind;
  const priceUsdc = field(form, "priceUsdc");
  const ownerAddress = field(form, "ownerAddress");
  const vaultRaw = field(form, "vaultAddress");
  const allowlist = [...new Set(field(form, "allowlist").split(/[\s,]+/).filter(Boolean).map((a) => a.toLowerCase()))];
  const perTxCap = field(form, "perTxCap");
  const dailyCap = field(form, "dailyCap");
  const escalateAbove = field(form, "escalateAbove");

  if (teamName.length < 2 || teamName.length > 80) errors.teamName = "Enter your team or company name (2-80 characters).";
  if (!EMAIL_RE.test(email) || email.length > 200) errors.email = "Enter a valid email address.";
  if (password.length < 10 || password.length > 200) errors.password = "Use at least 10 characters.";
  if (productName.length < 2 || productName.length > 120) errors.productName = "Name what you sell (2-120 characters).";
  if (!PRODUCT_KINDS.includes(productKind)) errors.productKind = "Choose a product type.";
  if (!positiveUsdc(priceUsdc)) errors.priceUsdc = "Enter a USDC price, e.g. 49 or 49.99.";
  if (!ADDRESS_RE.test(ownerAddress)) errors.ownerAddress = "Enter the 0x address of the human who approves escalations.";
  if (vaultRaw && !ADDRESS_RE.test(vaultRaw)) errors.vaultAddress = "Vault address must be a 0x address, or leave it empty.";
  if (allowlist.length > MAX_ALLOWLIST) errors.allowlist = `At most ${MAX_ALLOWLIST} payees.`;
  else if (allowlist.some((a) => !ADDRESS_RE.test(a))) errors.allowlist = "Every payee must be a 0x address.";
  for (const [key, value] of [["perTxCap", perTxCap], ["dailyCap", dailyCap]] as const) {
    if (!positiveUsdc(value)) errors[key] = "Enter a positive USDC amount.";
  }
  if (!USDC_RE.test(escalateAbove)) errors.escalateAbove = "Enter a USDC amount (0 escalates every payment).";
  if (!errors.perTxCap && !errors.dailyCap && toBaseUnits(perTxCap) > toBaseUnits(dailyCap)) {
    errors.perTxCap = "Per-payment cap cannot exceed the daily cap.";
  }
  if (!errors.escalateAbove && !errors.perTxCap && toBaseUnits(escalateAbove) > toBaseUnits(perTxCap)) {
    errors.escalateAbove = "Escalation threshold cannot exceed the per-payment cap.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      teamName,
      email,
      password,
      productName,
      productKind,
      priceUsdc,
      ownerAddress,
      vaultAddress: vaultRaw || null,
      allowlist,
      perTxCap,
      dailyCap,
      escalateAbove,
    },
  };
}

/** Deterministic bytes32 for owner setup actions (anchored by DecisionAnchored). */
export function setupHash(label: string): string {
  return `0x${createHash("sha256").update(`tameion-onboarding:${label}`).digest("hex")}`;
}

/** Shell commands: deploy the team's OperatorVault, then allowlist payees. */
export function vaultCommands(input: ConnectInput, operatorAddress: string | null): readonly string[] {
  const operator = operatorAddress ?? "<OPERATOR_DCW_ADDRESS>";
  const deploy = [
    `OPERATOR_VAULT_OWNER=${input.ownerAddress}`,
    `OPERATOR_VAULT_OPERATOR=${operator}`,
    `OPERATOR_PER_TX_CAP=${toBaseUnits(input.perTxCap)}`,
    `OPERATOR_DAILY_CAP=${toBaseUnits(input.dailyCap)}`,
    `OPERATOR_ESCALATE_ABOVE=${toBaseUnits(input.escalateAbove)}`,
    "forge script script/DeployOperator.s.sol",
    `--rpc-url ${ARC_TESTNET_RPC}`,
    "--private-key $DEPLOYER_KEY --broadcast",
  ].join(" \\\n  ");
  const vault = input.vaultAddress ?? "$VAULT";
  const allow = input.allowlist.map(
    (payee) =>
      `cast send ${vault} "setAllowlist(bytes32,address,bool)" ${setupHash(`allowlist:${payee}`)} ${payee} true \\\n  --rpc-url ${ARC_TESTNET_RPC} --private-key $OWNER_KEY`,
  );
  return [`cd contracts && ${deploy}`, ...allow];
}

/** Off-chain policy matching the vault (PUT /v1/operator/policy body). */
export function operatorPolicy(input: ConnectInput): Record<string, unknown> {
  return {
    split: { OPERATING: 7000, YIELD: 2000, REFUND: 1000 },
    taxRateBps: 2500,
    perTxCap: input.perTxCap,
    dailyCap: input.dailyCap,
    escalateAbove: input.escalateAbove,
    minFloat: "0",
    yieldTarget: "0",
    allowlist: [...input.allowlist],
    maxX402PerDay: 20,
  };
}

export class OnboardingError extends Error {
  constructor(
    readonly step: "register" | "product" | "price" | "publish" | "checkout" | "lookup",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

interface Api {
  readonly baseUrl: string;
  readonly fetchImpl?: FetchLike;
}

async function post<T>(api: Api, step: OnboardingError["step"], path: string, body: unknown, key?: string): Promise<T> {
  return send<T>(api, step, "POST", path, body, key);
}

async function send<T>(api: Api, step: OnboardingError["step"], method: "GET" | "POST", path: string, body: unknown, key?: string): Promise<T> {
  const fetchImpl: FetchLike = api.fetchImpl ?? ((i, init) => fetch(i, init));
  let res: Response;
  try {
    res = await fetchImpl(`${api.baseUrl.replace(/\/+$/, "")}${path}`, {
      method,
      headers: { "content-type": "application/json", accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new OnboardingError(step, 0, "The SettleKit API is unreachable. Try again shortly.");
  }
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok || json.data === undefined) {
    throw new OnboardingError(step, res.status, json.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data;
}

export interface CheckoutLink {
  readonly sessionId: string;
  readonly url: string;
  readonly expiresAt: string | null;
}

export interface ConnectResult {
  readonly orgId: string;
  readonly accountId: string;
  /** Shown once; the console never stores it. */
  readonly apiKey: string;
  readonly productId: string;
  readonly priceId: string;
  readonly checkout: CheckoutLink | null;
  readonly commands: readonly string[];
  readonly policy: Record<string, unknown>;
}

interface Registered {
  readonly account: { readonly id: string; readonly organizationId?: string };
  readonly apiKey?: string;
}

export async function createCheckoutLink(
  api: Api,
  args: { readonly apiKey: string; readonly merchantId: string; readonly productId: string; readonly priceId: string; readonly vaultAddress: string; readonly checkoutUrl: string },
): Promise<CheckoutLink> {
  const session = await post<{ id: string; expiresAt?: string }>(api, "checkout", "/v1/checkout-sessions", {
    merchantId: args.merchantId,
    items: [{ priceId: args.priceId, productId: args.productId, quantity: 1 }],
    payToAddress: args.vaultAddress,
    network: "arc",
  }, args.apiKey);
  return { sessionId: session.id, url: `${args.checkoutUrl.replace(/\/+$/, "")}/c/${session.id}`, expiresAt: session.expiresAt ?? null };
}

/** Run the whole onboarding against the API. */
export async function connectBusiness(api: Api, input: ConnectInput, options: { readonly checkoutUrl: string; readonly operatorAddress: string | null }): Promise<ConnectResult> {
  const registered = await post<Registered>(api, "register", "/v1/auth/register", {
    email: input.email,
    password: input.password,
    type: "merchant",
    displayName: input.teamName,
  });
  const apiKey = registered.apiKey;
  const orgId = registered.account.organizationId;
  if (!apiKey || !orgId) throw new OnboardingError("register", 500, "Registration did not return an organization API key.");
  const merchantId = registered.account.id;

  const product = await post<{ id: string }>(api, "product", "/v1/products", {
    merchantId,
    name: input.productName,
    description: `${input.teamName} on Arc USDC via SettleKit`,
    type: input.productKind,
    deliveryMode: "none",
    metadata: { source: "tameion-onboarding" },
  }, apiKey);
  const price = await post<{ id: string }>(api, "price", `/v1/products/${encodeURIComponent(product.id)}/prices`, {
    amount: input.priceUsdc,
    interval: "one_time",
  }, apiKey);
  await post(api, "publish", `/v1/products/${encodeURIComponent(product.id)}/publish`, undefined, apiKey);

  const checkout = input.vaultAddress
    ? await createCheckoutLink(api, { apiKey, merchantId, productId: product.id, priceId: price.id, vaultAddress: input.vaultAddress, checkoutUrl: options.checkoutUrl })
    : null;

  return {
    orgId,
    accountId: merchantId,
    apiKey,
    productId: product.id,
    priceId: price.id,
    checkout,
    commands: vaultCommands(input, options.operatorAddress),
    policy: operatorPolicy(input),
  };
}

export interface LinkInput {
  readonly apiKey: string;
  readonly productId: string;
  readonly priceId: string;
  readonly vaultAddress: string;
}

export function parseLinkForm(form: Readonly<Record<string, unknown>>): ParseResult<LinkInput> {
  const errors: Record<string, string> = {};
  const apiKey = field(form, "apiKey");
  const productId = field(form, "productId");
  const priceId = field(form, "priceId");
  const vaultAddress = field(form, "vaultAddress");
  if (apiKey.length < 8 || apiKey.length > 512) errors.apiKey = "Paste the API key you received at signup.";
  if (!/^[\w-]{1,128}$/.test(productId)) errors.productId = "Enter the product id.";
  if (!/^[\w-]{1,128}$/.test(priceId)) errors.priceId = "Enter the price id.";
  if (!ADDRESS_RE.test(vaultAddress)) errors.vaultAddress = "Enter your OperatorVault 0x address.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { apiKey, productId, priceId, vaultAddress } };
}

/** Later step: once the vault is deployed, mint a checkout link into it. */
export async function linkVault(api: Api, input: LinkInput, checkoutUrl: string): Promise<CheckoutLink> {
  const product = await send<{ id: string; merchantId: string }>(api, "lookup", "GET", `/v1/products/${encodeURIComponent(input.productId)}`, undefined, input.apiKey);
  return createCheckoutLink(api, { apiKey: input.apiKey, merchantId: product.merchantId, productId: product.id, priceId: input.priceId, vaultAddress: input.vaultAddress, checkoutUrl });
}
