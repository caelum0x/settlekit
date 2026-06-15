import { createElement } from "react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: ReactNode;
  message?: ReactNode;
  /** Decorative leading glyph/icon node. */
  icon?: ReactNode;
  /** Call-to-action node (e.g. a Button). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState(props: EmptyStateProps) {
  const { title, message, icon, action, className } = props;
  const classes = ["sk-empty", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  return createElement(
    "div",
    { className: classes },
    icon !== undefined
      ? createElement("div", { className: "sk-empty-icon", key: "icon", "aria-hidden": true }, icon)
      : null,
    createElement("div", { className: "sk-empty-title", key: "title" }, title),
    message !== undefined
      ? createElement("div", { className: "sk-empty-message", key: "message" }, message)
      : null,
    action !== undefined
      ? createElement("div", { className: "sk-empty-action", key: "action" }, action)
      : null,
  );
}
