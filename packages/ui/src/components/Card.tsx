import { createElement } from "react";
import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Optional heading rendered at the top of the card. */
  title?: ReactNode;
  /** Optional actions aligned to the right of the title row. */
  actions?: ReactNode;
  /** Apply hover lift/shadow treatment. */
  hover?: boolean;
  children?: ReactNode;
}

export function Card(props: CardProps) {
  const { title, actions, hover = false, className, children, ...rest } = props;

  const classes = ["sk-card", hover ? "sk-card-hover" : "", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  const header =
    title !== undefined || actions !== undefined
      ? createElement(
          "div",
          { className: "sk-row-between", key: "header" },
          createElement("div", { className: "sk-card-title", key: "title" }, title),
          actions !== undefined
            ? createElement("div", { key: "actions" }, actions)
            : null,
        )
      : null;

  return createElement(
    "div",
    { ...rest, className: classes },
    header,
    createElement("div", { key: "body" }, children),
  );
}
