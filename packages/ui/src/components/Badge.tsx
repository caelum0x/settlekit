import { createElement } from "react";
import type { ReactNode } from "react";
import { humanize } from "../format.js";

export type BadgeTone = "good" | "warn" | "bad" | "accent" | "neutral";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Render a leading colored dot. */
  dot?: boolean;
  className?: string;
  children?: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  good: "sk-badge-good",
  warn: "sk-badge-warn",
  bad: "sk-badge-bad",
  accent: "sk-badge-accent",
  neutral: "sk-badge-neutral",
};

export function Badge(props: BadgeProps) {
  const { tone = "neutral", dot = false, className, children } = props;
  const classes = ["sk-badge", TONE_CLASS[tone], className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  return createElement(
    "span",
    { className: classes },
    dot ? createElement("span", { className: "sk-badge-dot", key: "dot", "aria-hidden": true }) : null,
    children,
  );
}

/**
 * Map a domain status string to a tone. Apps can pass an explicit mapping;
 * otherwise sensible defaults cover common SettleKit lifecycle states.
 */
const DEFAULT_STATUS_TONES: Record<string, BadgeTone> = {
  active: "good",
  succeeded: "good",
  paid: "good",
  completed: "good",
  delivered: "good",
  settled: "good",
  confirmed: "good",
  pending: "warn",
  processing: "warn",
  trialing: "warn",
  past_due: "warn",
  requires_action: "warn",
  failed: "bad",
  canceled: "bad",
  cancelled: "bad",
  refunded: "bad",
  disputed: "bad",
  expired: "bad",
  revoked: "bad",
};

export interface StatusBadgeProps {
  status: string;
  /** Override or extend the default status→tone mapping. */
  tones?: Record<string, BadgeTone>;
  /** Fallback tone when the status is unknown. Default "neutral". */
  fallbackTone?: BadgeTone;
  dot?: boolean;
  className?: string;
}

export function StatusBadge(props: StatusBadgeProps) {
  const { status, tones, fallbackTone = "neutral", dot = true, className } = props;
  const key = status.toLowerCase();
  const tone = tones?.[key] ?? DEFAULT_STATUS_TONES[key] ?? fallbackTone;
  return createElement(
    Badge,
    { tone, dot, className },
    humanize(status),
  );
}
