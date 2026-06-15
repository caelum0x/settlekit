import { createElement } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

export interface NavLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Highlight as the current page. */
  active?: boolean;
  children?: ReactNode;
}

export function NavLink(props: NavLinkProps) {
  const { active = false, className, children, ...rest } = props;
  const classes = ["sk-nav-link", active ? "sk-nav-link-active" : "", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");
  return createElement(
    "a",
    { ...rest, className: classes, "aria-current": active ? "page" : undefined },
    children,
  );
}

export interface NavProps {
  children: ReactNode;
  /** Accessible label for the navigation landmark. */
  label?: string;
  className?: string;
}

export function Nav(props: NavProps) {
  const { children, label = "Primary", className } = props;
  const classes = ["sk-nav", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");
  return createElement("nav", { className: classes, "aria-label": label }, children);
}
