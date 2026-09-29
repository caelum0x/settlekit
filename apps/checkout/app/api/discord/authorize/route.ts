/**
 * GET /api/discord/authorize?session=<checkoutSessionId>
 *
 * Starts "Connect Discord" for a checkout whose product grants a Discord role.
 */
import { NextResponse } from "next/server";

import { authorizeUrl, discordOAuthSetup } from "@/lib/discord-connect";
import { publicOrigin } from "@/lib/origin";
import { getResolvedSession } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const sessionId = new URL(request.url).searchParams.get("session") ?? "";
  const origin = publicOrigin(request);
  const setup = discordOAuthSetup();
  const resolved = sessionId ? await getResolvedSession(sessionId) : undefined;
  if (!resolved) return NextResponse.json({ error: "Checkout session not found." }, { status: 404 });
  if (!setup || resolved.deliveryAction.type !== "discord_role_add") {
    return NextResponse.redirect(`${origin}/c/${encodeURIComponent(sessionId)}?discord=unavailable`);
  }
  return NextResponse.redirect(authorizeUrl(setup, origin, sessionId));
}
