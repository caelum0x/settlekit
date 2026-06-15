import { createElement } from "react";
import type { ReactNode } from "react";

export type StatTone = "default" | "good" | "warn" | "bad";

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Small supporting line under the value. */
  hint?: ReactNode;
  tone?: StatTone;
  /** Optional period-over-period delta (e.g. "+12.4%"). */
  trend?: { value: ReactNode; direction: "up" | "down" };
  className?: string;
}

const TONE_CLASS: Record<StatTone, string> = {
  default: "",
  good: "sk-stat-good",
  warn: "sk-stat-warn",
  bad: "sk-stat-bad",
};

export function StatCard(props: StatCardProps) {
  const { label, value, hint, tone = "default", trend, className } = props;

  const classes = ["sk-stat", TONE_CLASS[tone], className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  const trendNode = trend
    ? createElement(
        "span",
        {
          key: "trend",
          className: trend.direction === "up" ? "sk-stat-trend-up" : "sk-stat-trend-down",
        },
        trend.direction === "up" ? "▲ " : "▼ ",
        trend.value,
      )
    : null;

  return createElement(
    "div",
    { className: classes },
    createElement("div", { className: "sk-stat-label", key: "label" }, label),
    createElement("div", { className: "sk-stat-value", key: "value" }, value),
    hint !== undefined || trend
      ? createElement(
          "div",
          { className: "sk-stat-hint", key: "hint" },
          trendNode,
          trendNode && hint !== undefined ? " " : null,
          hint,
        )
      : null,
  );
}
