/**
 * Cash out to a bank: hand-off links to off-ramp partners.
 *
 * SettleKit never takes custody: the merchant opens the partner's sell flow
 * with the amount, network and their own wallet prefilled, sends USDC from
 * their wallet to the partner there, and receives fiat in their bank. A
 * partner appears only when the owner configured its public key.
 *
 *   Transak  TRANSAK_API_KEY (+ TRANSAK_ENV=staging for the sandbox)
 *   MoonPay  MOONPAY_PUBLISHABLE_KEY + MOONPAY_SECRET_KEY (URL signing)
 *   Ramp     RAMP_HOST_API_KEY
 *
 * Parameter names follow each partner's published widget docs; check them
 * against the partner dashboard when the account is opened.
 */
import { createHmac } from "node:crypto";
import { toBaseUnits, validationError, type PaymentNetwork } from "@settlekit/common";

export interface OfframpLink {
  provider: "transak" | "moonpay" | "ramp";
  name: string;
  url: string;
}

export interface OfframpRequest {
  network: PaymentNetwork;
  /** USDC amount to sell, decimal string. */
  amount: string;
  /** The merchant's own wallet on `network` (refunds of failed sells go here). */
  wallet: string;
  /** Where the partner returns the merchant afterwards. */
  returnUrl?: string;
}

/** Networks each partner supports for USDC sells, with its network/asset code. */
const TRANSAK_NETWORK: Partial<Record<PaymentNetwork, string>> = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum",
  solana: "solana",
};

const MOONPAY_CURRENCY: Partial<Record<PaymentNetwork, string>> = {
  ethereum: "usdc",
  base: "usdc_base",
  arbitrum: "usdc_arbitrum",
  solana: "usdc_sol",
};

const RAMP_ASSET: Partial<Record<PaymentNetwork, string>> = {
  ethereum: "ETH_USDC",
  base: "BASE_USDC",
  arbitrum: "ARBITRUM_USDC",
  solana: "SOLANA_USDC",
};

function query(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function transak(req: OfframpRequest, env: NodeJS.ProcessEnv): OfframpLink | null {
  const apiKey = env.TRANSAK_API_KEY?.trim();
  const network = TRANSAK_NETWORK[req.network];
  if (!apiKey || !network) return null;
  const base = env.TRANSAK_ENV === "staging" ? "https://global-stg.transak.com" : "https://global.transak.com";
  const params: Record<string, string> = {
    apiKey,
    productsAvailed: "SELL",
    cryptoCurrencyCode: "USDC",
    network,
    cryptoAmount: req.amount,
    walletAddress: req.wallet,
    ...(req.returnUrl ? { redirectURL: req.returnUrl } : {}),
  };
  return { provider: "transak", name: "Transak", url: `${base}/?${query(params)}` };
}

function moonpay(req: OfframpRequest, env: NodeJS.ProcessEnv): OfframpLink | null {
  const apiKey = env.MOONPAY_PUBLISHABLE_KEY?.trim();
  const secret = env.MOONPAY_SECRET_KEY?.trim();
  const currency = MOONPAY_CURRENCY[req.network];
  if (!apiKey || !secret || !currency) return null;
  const search = `?${query({
    apiKey,
    baseCurrencyCode: currency,
    baseCurrencyAmount: req.amount,
    quoteCurrencyCode: "usd",
    refundWalletAddress: req.wallet,
    ...(req.returnUrl ? { redirectURL: req.returnUrl } : {}),
  })}`;
  // MoonPay requires URLs carrying wallet addresses to be signed with the secret key.
  const signature = createHmac("sha256", secret).update(search).digest("base64");
  return { provider: "moonpay", name: "MoonPay", url: `https://sell.moonpay.com/${search}&signature=${encodeURIComponent(signature)}` };
}

function ramp(req: OfframpRequest, env: NodeJS.ProcessEnv): OfframpLink | null {
  const hostApiKey = env.RAMP_HOST_API_KEY?.trim();
  const asset = RAMP_ASSET[req.network];
  if (!hostApiKey || !asset) return null;
  const params: Record<string, string> = {
    hostApiKey,
    hostAppName: "SettleKit",
    enabledFlows: "OFFRAMP",
    defaultFlow: "OFFRAMP",
    swapAsset: asset,
    offrampAsset: asset,
    swapAmount: toBaseUnits(req.amount).toString(),
    userAddress: req.wallet,
    ...(req.returnUrl ? { finalUrl: req.returnUrl } : {}),
  };
  return { provider: "ramp", name: "Ramp", url: `https://app.ramp.network/?${query(params)}` };
}

/** Every configured partner that can cash out USDC on `network`. */
export function offrampLinks(req: OfframpRequest, env: NodeJS.ProcessEnv = process.env): OfframpLink[] {
  if (!/^\d+(\.\d{1,6})?$/.test(req.amount) || toBaseUnits(req.amount) <= 0n) {
    throw validationError("amount must be a positive USDC amount", { fields: ["amount"] });
  }
  return [transak(req, env), moonpay(req, env), ramp(req, env)].filter((l): l is OfframpLink => l !== null);
}

/** Partners configured at all (for the dashboard to explain what is missing). */
export function configuredOfframps(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env.TRANSAK_API_KEY?.trim() ? "transak" : null,
    env.MOONPAY_PUBLISHABLE_KEY?.trim() && env.MOONPAY_SECRET_KEY?.trim() ? "moonpay" : null,
    env.RAMP_HOST_API_KEY?.trim() ? "ramp" : null,
  ].filter((p): p is string => p !== null);
}
