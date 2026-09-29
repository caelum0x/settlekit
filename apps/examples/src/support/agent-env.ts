/**
 * Shared env handling for the agent-buy examples (run by the owner against a
 * live SettleKit API; they spend real stablecoins on mainnet).
 *
 *   SETTLEKIT_API_URL   API origin (default http://localhost:8787)
 *   PRODUCT_ID          product to buy; unset = call the sample paid resource
 *   SETTLEKIT_CHAIN_ENV mainnet | testnet (default mainnet)
 *   AGENT_MAX_USD       per-payment cap the agent will sign (default 5)
 *   AGENT_EMAIL / AGENT_GITHUB_USERNAME / AGENT_DISCORD_USER_ID  buyer details
 */
export type ChainEnv = "mainnet" | "testnet";

export interface AgentTarget {
  url: string;
  init: RequestInit;
  env: ChainEnv;
  maxAtomicPerPayment: string;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`set ${name} to run this example`);
  return value;
}

function buyerBody(): string | undefined {
  const body = Object.fromEntries(
    [
      ["email", process.env.AGENT_EMAIL],
      ["githubUsername", process.env.AGENT_GITHUB_USERNAME],
      ["discordUserId", process.env.AGENT_DISCORD_USER_ID],
    ].filter(([, value]) => value !== undefined && value.trim().length > 0),
  );
  return Object.keys(body).length > 0 ? JSON.stringify(body) : undefined;
}

/** Resolve what to buy on `rail` ("x402" or "mpp") from env. */
export function agentTarget(rail: "x402" | "mpp"): AgentTarget {
  const api = (process.env.SETTLEKIT_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
  const productId = process.env.PRODUCT_ID?.trim();
  const env = process.env.SETTLEKIT_CHAIN_ENV === "testnet" ? "testnet" : "mainnet";
  const maxUsd = Number(process.env.AGENT_MAX_USD ?? "5");
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("AGENT_MAX_USD must be a positive number");
  const body = buyerBody();
  return {
    url: productId ? `${api}/v1/${rail}/products/${encodeURIComponent(productId)}/buy` : `${api}/v1/${rail}/research`,
    init: productId
      ? { method: "POST", headers: { "content-type": "application/json" }, ...(body ? { body } : {}) }
      : { method: "GET" },
    env,
    maxAtomicPerPayment: String(Math.round(maxUsd * 1_000_000)),
  };
}

/** Print the response and the settlement, failing loudly on non-2xx. */
export async function report(response: Response, settlement: unknown): Promise<unknown> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON body, print as text
  }
  process.stdout.write(`${JSON.stringify({ status: response.status, settlement, body }, null, 2)}\n`);
  if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`);
  return body;
}
