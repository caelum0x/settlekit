import { listWebhookEvents } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const undelivered = new URL(req.url).searchParams.get("undelivered");
    const events = await listWebhookEvents();
    const filtered =
      undelivered === "true" ? events.filter((e) => !e.delivered) : events;
    // Most recent first.
    const sorted = [...filtered].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
    return ok(sorted);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "webhook list failed", 500);
  }
}
