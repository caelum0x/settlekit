"use server";

import { headers } from "next/headers";
import { loadConsoleConfig } from "@/lib/config";
import {
  connectBusiness,
  linkVault,
  OnboardingError,
  parseConnectForm,
  parseLinkForm,
  type CheckoutLink,
  type ConnectResult,
  type FieldErrors,
} from "@/lib/onboarding";
import { clientKey, createLimiter } from "@/lib/throttle";

export interface ConnectState {
  readonly status: "idle" | "error" | "ok";
  readonly message?: string;
  readonly errors?: FieldErrors;
  readonly result?: ConnectResult;
}

export interface LinkState {
  readonly status: "idle" | "error" | "ok";
  readonly message?: string;
  readonly errors?: FieldErrors;
  readonly link?: CheckoutLink;
}

const signups = createLimiter(5, 60 * 60 * 1000);
const links = createLimiter(30, 60 * 60 * 1000);

function failure(error: unknown): string {
  if (error instanceof OnboardingError) {
    if (error.step === "register" && error.status === 409) return "An account with this email already exists. Sign in to SettleKit with it instead.";
    return `Could not complete the ${error.step} step: ${error.message}`;
  }
  return "Unexpected error. Nothing was charged; try again.";
}

export async function connect(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const parsed = parseConnectForm(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "error", message: "Check the highlighted fields.", errors: parsed.errors };
  if (!signups.hit(clientKey(headers()))) return { status: "error", message: "Too many sign-ups from this network. Try again later." };
  const config = loadConsoleConfig();
  try {
    const result = await connectBusiness({ baseUrl: config.apiUrl }, parsed.value, { checkoutUrl: config.checkoutUrl, operatorAddress: config.operatorAddress });
    return { status: "ok", result };
  } catch (error) {
    return { status: "error", message: failure(error) };
  }
}

export async function link(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const parsed = parseLinkForm(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "error", message: "Check the highlighted fields.", errors: parsed.errors };
  if (!links.hit(clientKey(headers()))) return { status: "error", message: "Too many requests. Try again later." };
  const config = loadConsoleConfig();
  try {
    return { status: "ok", link: await linkVault({ baseUrl: config.apiUrl }, parsed.value, config.checkoutUrl) };
  } catch (error) {
    return { status: "error", message: failure(error) };
  }
}
