/**
 * Onboarding against the REAL SettleKit API app (Hono, in-memory stores),
 * wired through a fetch adapter: register -> product -> price -> publish ->
 * Arc checkout session paying the team's vault.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../../api/src/app.js";
import { createContext, type AppEnv } from "../../api/src/context.js";
import type { FetchLike } from "../lib/api-client";
import {
  connectBusiness,
  linkVault,
  OnboardingError,
  operatorPolicy,
  parseConnectForm,
  parseLinkForm,
  setupHash,
  toBaseUnits,
  vaultCommands,
  type ConnectInput,
} from "../lib/onboarding";

const OWNER = "0x1111111111111111111111111111111111111111";
const VAULT = "0x00000000000000000000000000000000000000f1";
const VENDOR = "0x00000000000000000000000000000000007e2d02";
const OPERATOR = "0x2222222222222222222222222222222222222222";

const form = (over: Record<string, string> = {}) => ({
  teamName: "Acme Studio",
  email: "Founder@Acme.example",
  password: "long-enough-password",
  productName: "Pro plan",
  productKind: "saas_plan",
  priceUsdc: "49.99",
  ownerAddress: OWNER,
  vaultAddress: VAULT,
  allowlist: `${VENDOR}\n${VENDOR.toUpperCase().replace("0X", "0x")}`,
  perTxCap: "250",
  dailyCap: "500",
  escalateAbove: "100",
  ...over,
});

function parsed(over: Record<string, string> = {}): ConnectInput {
  const r = parseConnectForm(form(over));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}

let app: Hono<AppEnv>;
const fetchImpl: FetchLike = async (url, init) => app.request(url.replace("http://api.test", ""), init);
const api = { baseUrl: "http://api.test", fetchImpl };

beforeAll(async () => {
  process.env.API_BOOTSTRAP_KEY = "onboarding-bootstrap";
  app = createApp(await createContext());
});

describe("onboarding form", () => {
  it("normalises input: lowercased email and deduplicated lowercase allowlist", () => {
    const value = parsed();
    expect(value.email).toBe("founder@acme.example");
    expect(value.allowlist).toEqual([VENDOR]);
    expect(value.vaultAddress).toBe(VAULT);
    expect(parsed({ vaultAddress: "" }).vaultAddress).toBeNull();
  });

  it("mirrors the vault's cap invariants and rejects bad fields", () => {
    const r = parseConnectForm(form({ perTxCap: "600", dailyCap: "500", email: "nope", ownerAddress: "0x12", allowlist: "bob", priceUsdc: "0", password: "short" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["allowlist", "email", "ownerAddress", "password", "perTxCap", "priceUsdc"]);
    const esc = parseConnectForm(form({ escalateAbove: "300" }));
    expect(esc.ok || esc.errors.escalateAbove).toMatch(/cannot exceed/);
    expect(parseConnectForm(form({ escalateAbove: "0" })).ok).toBe(true);
  });

  it("renders the deploy and allowlist commands with base-unit caps", () => {
    const input = parsed();
    expect(toBaseUnits("49.99")).toBe(49_990_000n);
    const [deploy, allow] = vaultCommands(input, OPERATOR);
    expect(deploy).toContain(`OPERATOR_VAULT_OWNER=${OWNER}`);
    expect(deploy).toContain(`OPERATOR_VAULT_OPERATOR=${OPERATOR}`);
    expect(deploy).toContain("OPERATOR_PER_TX_CAP=250000000");
    expect(deploy).toContain("OPERATOR_DAILY_CAP=500000000");
    expect(deploy).toContain("OPERATOR_ESCALATE_ABOVE=100000000");
    expect(deploy).toContain("--rpc-url https://rpc.testnet.arc.network");
    expect(allow).toContain(`cast send ${VAULT} "setAllowlist(bytes32,address,bool)" ${setupHash(`allowlist:${VENDOR}`)} ${VENDOR} true`);
    expect(setupHash("x")).toMatch(/^0x[a-f0-9]{64}$/);
    expect(vaultCommands({ ...input, vaultAddress: null }, null)[0]).toContain("<OPERATOR_DCW_ADDRESS>");
    expect(operatorPolicy(input)).toMatchObject({ perTxCap: "250", dailyCap: "500", escalateAbove: "100", allowlist: [VENDOR] });
  });
});

describe("connectBusiness over the real API", () => {
  it("creates an org + key, a published USDC product, and an Arc checkout paying the vault", async () => {
    const result = await connectBusiness(api, parsed(), { checkoutUrl: "https://pay.example/", operatorAddress: OPERATOR });
    expect(result.apiKey).toMatch(/^sk_/);
    expect(result.orgId).toMatch(/\S/);
    expect(result.checkout?.url).toBe(`https://pay.example/c/${result.checkout?.sessionId}`);

    const auth = { authorization: `Bearer ${result.apiKey}` };
    const session = (await (await app.request(`/v1/checkout-sessions/${result.checkout?.sessionId}`, { headers: auth })).json()) as { data: Record<string, any> };
    expect(session.data).toMatchObject({ network: "arc", payToAddress: VAULT, organizationId: result.orgId, status: "open" });
    expect(session.data.amount).toMatchObject({ amount: "49.99", currency: "USDC" });
    const product = (await (await app.request(`/v1/products/${result.productId}`, { headers: auth })).json()) as { data: Record<string, any> };
    expect(product.data).toMatchObject({ status: "active", organizationId: result.orgId, name: "Pro plan" });
  });

  it("skips the checkout link until a vault exists, then links it with the team key", async () => {
    const result = await connectBusiness(api, parsed({ email: "second@acme.example", vaultAddress: "" }), { checkoutUrl: "https://pay.example", operatorAddress: null });
    expect(result.checkout).toBeNull();
    const linkInput = parseLinkForm({ apiKey: result.apiKey, productId: result.productId, priceId: result.priceId, vaultAddress: VAULT });
    if (!linkInput.ok) throw new Error("link form invalid");
    const link = await linkVault(api, linkInput.value, "https://pay.example");
    expect(link.url).toBe(`https://pay.example/c/${link.sessionId}`);
    expect(parseLinkForm({ apiKey: "x", productId: "bad id", priceId: "", vaultAddress: "0x1" }).ok).toBe(false);
  });

  it("reports which step failed (duplicate email at register)", async () => {
    await connectBusiness(api, parsed({ email: "dup@acme.example" }), { checkoutUrl: "https://pay.example", operatorAddress: null });
    const error = await connectBusiness(api, parsed({ email: "dup@acme.example" }), { checkoutUrl: "https://pay.example", operatorAddress: null }).catch((e) => e);
    expect(error).toBeInstanceOf(OnboardingError);
    expect(error.step).toBe("register");
  });

  it("fails closed when the API is unreachable", async () => {
    const down = { baseUrl: "http://api.test", fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as FetchLike };
    await expect(connectBusiness(down, parsed({ email: "x@acme.example" }), { checkoutUrl: "https://p", operatorAddress: null })).rejects.toMatchObject({ step: "register", status: 0 });
  });
});
