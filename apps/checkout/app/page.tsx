import Link from "next/link";

import { getResolvedSession, listSeededSessionIds } from "@/lib/store";
import { buildSessionView } from "@/lib/views";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Landing page. Lists the live demo checkout sessions seeded in the data layer
 * so a buyer can open any hosted checkout. Each link points at the real
 * /c/[sessionId] page driven by the SettleKit API.
 */
export default async function CheckoutHomePage() {
  const ids = listSeededSessionIds();
  const sessions = await Promise.all(
    ids.map(async (id) => {
      const resolved = await getResolvedSession(id);
      return resolved ? buildSessionView(resolved) : undefined;
    }),
  );

  return (
    <div>
      <div className="card">
        <h2>Open a checkout</h2>
        <p className="merchant">
          Pay in USDC and receive instant access — private GitHub repos, license
          keys, API keys, signed downloads, and Discord roles.
        </p>
        {sessions
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((session) => {
            const line = session.lines[0];
            return (
              <Link
                key={session.id}
                href={`/c/${session.id}`}
                className="session-link"
              >
                <div className="line-name">{line?.name ?? "Checkout"}</div>
                <div className="line-desc">
                  {session.merchantName} · {formatMoney(session.amount)}
                </div>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
