/**
 * GET /api/discord/callback?code=&state=
 *
 * Saves the buyer's Discord id on the checkout session that started the flow
 * and adds them to the product's server (no paid role until payment settles).
 */
import { NextResponse } from "next/server";

import { discordOAuthSetup, identify, readState } from "@/lib/discord-connect";
import { getDiscordDelivery, joinGuild, resolveDiscordTarget } from "@/lib/discord-delivery";
import { publicOrigin } from "@/lib/origin";
import { getResolvedSession, saveCollectedFields } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const sessionId = readState(url.searchParams.get("state") ?? "");
  if (!sessionId) return NextResponse.json({ error: "This Discord link expired. Go back to the checkout and connect again." }, { status: 400 });
  const back = (status: string) => NextResponse.redirect(`${origin}/c/${encodeURIComponent(sessionId)}?discord=${status}`);
  const code = url.searchParams.get("code");
  const setup = discordOAuthSetup();
  if (!code || !setup) return back("canceled");

  const resolved = await getResolvedSession(sessionId);
  if (!resolved || resolved.session.status !== "open") return back("closed");
  try {
    const identity = await identify(setup, origin, code);
    await saveCollectedFields(sessionId, { discordUserId: identity.userId, discordUsername: identity.username });
    const action = resolved.deliveryAction;
    if (action.type === "discord_role_add") {
      const target = resolveDiscordTarget(action, resolved.product);
      if (target) await joinGuild(getDiscordDelivery(), target.guildId, identity.userId, identity.accessToken);
    }
    return back("connected");
  } catch (error) {
    console.error("[checkout] discord connect failed:", error);
    return back("failed");
  }
}
