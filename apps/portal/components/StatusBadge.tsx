import { humanize } from "@/lib/format";

type Tone = "ok" | "warn" | "bad" | "muted" | "info";

const TONE_BY_STATUS: Record<string, Tone> = {
  active: "ok",
  confirmed: "ok",
  succeeded: "ok",
  paid: "ok",
  granted: "ok",
  published: "ok",
  enabled: "ok",
  pending: "warn",
  invited: "warn",
  in_grace: "warn",
  past_due: "warn",
  trialing: "info",
  in_transit: "info",
  open: "info",
  expired: "bad",
  failed: "bad",
  revoked: "bad",
  canceled: "muted",
  disabled: "muted",
};

export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = TONE_BY_STATUS[status] ?? "muted";
  return <span className={`badge badge-${tone}`}>{humanize(status)}</span>;
}
