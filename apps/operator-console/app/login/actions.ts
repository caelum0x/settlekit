"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, safeNextPath } from "@/lib/auth";
import { loadConsoleConfig, ownerLoginEnabled } from "@/lib/config";
import { startOwnerSession } from "@/lib/session";
import { clientKey, createLimiter } from "@/lib/throttle";

const limiter = createLimiter(10, 15 * 60 * 1000);

export async function login(formData: FormData): Promise<void> {
  const next = safeNextPath(String(formData.get("next") ?? "/"));
  const config = loadConsoleConfig();
  if (!ownerLoginEnabled(config)) redirect(`/login?error=disabled&next=${encodeURIComponent(next)}`);
  if (!limiter.hit(clientKey(headers()))) redirect(`/login?error=throttled&next=${encodeURIComponent(next)}`);
  if (!checkPassword(String(formData.get("password") ?? ""), config.ownerPassword)) {
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  }
  startOwnerSession();
  redirect(next);
}

