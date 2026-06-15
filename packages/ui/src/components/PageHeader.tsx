import { createElement } from "react";
import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons, etc.). */
  actions?: ReactNode;
  /** Breadcrumb / context line above the title. */
  breadcrumb?: ReactNode;
  className?: string;
}

export function PageHeader(props: PageHeaderProps) {
  const { title, description, actions, breadcrumb, className } = props;
  const classes = ["sk-page-header", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  const left = createElement(
    "div",
    { key: "left" },
    breadcrumb !== undefined
      ? createElement("div", { className: "sk-breadcrumb", key: "crumb" }, breadcrumb)
      : null,
    createElement("h1", { className: "sk-page-title", key: "title" }, title),
    description !== undefined
      ? createElement("p", { className: "sk-page-desc", key: "desc" }, description)
      : null,
  );

  const right =
    actions !== undefined
      ? createElement("div", { className: "sk-page-actions", key: "actions" }, actions)
      : null;

  return createElement("div", { className: classes }, left, right);
}
