/**
 * Next.js glue for owner sessions (server components, actions, handlers).
 * Every owner page calls requireOwner() via app/(owner)/layout.tsx and every
 * owner server action calls it again, because actions are independently
 * reachable POST endpoints.
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OWNER_COOKIE, SESSION_TTL_MS, createSessionToken, verifySessionToken } from "./auth";
import { loadConsoleConfig } from "./config";

export function isOwnerSession(): boolean {
  const config = loadConsoleConfig();
  return verifySessionToken(cookies().get(OWNER_COOKIE)?.value, config.sessionSecret, new Date());
}

export function requireOwner(next = "/"): void {
  if (!isOwnerSession()) redirect(`/login?next=${encodeURIComponent(next)}`);
}

export function startOwnerSession(): void {
  const config = loadConsoleConfig();
  if (!config.sessionSecret) throw new Error("CONSOLE_SESSION_SECRET is not configured");
  cookies().set(OWNER_COOKIE, createSessionToken(config.sessionSecret, new Date()), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}
