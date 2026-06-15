import { api } from "@/lib/api";
import { formatRelative, riskTone } from "@/lib/format";
import { ActionButton } from "../components/ActionButton";
import { Pill, Flags, EmptyRow } from "../components/ui";

export const dynamic = "force-dynamic";

const REVIEW_TONE = {
  open: "muted",
  allowed: "ok",
  reviewing: "warn",
  blocked: "danger",
} as const;

export default async function RiskPage() {
  let profiles;
  try {
    profiles = await api.riskProfiles();
  } catch (e) {
    return (
      <>
        <h1>Risk queue</h1>
        <div className="error">
          Failed to load risk profiles:{" "}
          {e instanceof Error ? e.message : "unknown"}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Risk queue</h1>
      <p className="subtitle">
        Profiles scored by the @settlekit/risk rule engine. Decisions allow,
        flag for review, or block the subject.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Org</th>
              <th>Score</th>
              <th>Engine</th>
              <th>Flags</th>
              <th>State</th>
              <th>Updated</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 ? (
              <EmptyRow colSpan={8} text="No risk profiles." />
            ) : (
              profiles.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.customerId}</td>
                  <td className="mono">{p.organizationId}</td>
                  <td>
                    <strong>{p.score}</strong>
                    <span style={{ color: "var(--muted)" }}>/100</span>
                  </td>
                  <td>
                    <Pill
                      label={p.decision}
                      tone={riskTone(p.decision) as "ok" | "warn" | "danger"}
                    />
                  </td>
                  <td>
                    <Flags flags={p.flags} />
                  </td>
                  <td>
                    <Pill label={p.reviewState} tone={REVIEW_TONE[p.reviewState]} />
                  </td>
                  <td>{formatRelative(p.updatedAt)}</td>
                  <td>
                    <div className="actions">
                      <ActionButton
                        endpoint={`/api/v1/risk/${p.id}/decision`}
                        body={{ action: "allow" }}
                        label="Allow"
                        tone="ok"
                        successText="Allowed"
                      />
                      <ActionButton
                        endpoint={`/api/v1/risk/${p.id}/decision`}
                        body={{ action: "review" }}
                        label="Review"
                        tone="warn"
                        successText="Flagged"
                      />
                      <ActionButton
                        endpoint={`/api/v1/risk/${p.id}/decision`}
                        body={{ action: "block" }}
                        label="Block"
                        tone="danger"
                        successText="Blocked"
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
