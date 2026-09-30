/**
 * Embedded checkout (embed.js overlay). The success message goes only to a
 * site the seller listed in their embed origins, never to an arbitrary
 * embedder: a checkout framed by an unlisted site still works, it just does
 * not report back.
 */
import { getBackend, type CheckoutBackend } from "./backend";

const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(:\d{2,5})?$|^http:\/\/localhost(:\d{2,5})?$/i;

/** Whether a string is a plain web origin (no path, query or credentials). */
export function isOrigin(value: string): boolean {
  return ORIGIN_RE.test(value);
}

/** The seller's allowed embed origins for a checkout session. */
export async function embedOriginsForSession(
  sessionId: string,
  backend: CheckoutBackend = getBackend(),
): Promise<string[]> {
  const session = await backend.checkouts.findById(sessionId);
  if (!session || !backend.embedOrigins) return [];
  const origins = await backend.embedOrigins(session.organizationId);
  return origins.filter(isOrigin).map((o) => o.toLowerCase());
}

/** The origin to notify: the embedder's, only when the seller allows it. */
export function allowedTarget(embedOrigin: string | null | undefined, allowed: readonly string[]): string | null {
  if (!embedOrigin) return null;
  const origin = embedOrigin.toLowerCase();
  return isOrigin(origin) && allowed.includes(origin) ? origin : null;
}
