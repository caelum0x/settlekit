import { createElement } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "default" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render a spinner and disable interaction. */
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "sk-btn-primary",
  default: "",
  ghost: "sk-btn-ghost",
  outline: "sk-btn-outline",
  danger: "sk-btn-danger",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "sk-btn-sm",
  md: "",
  lg: "sk-btn-lg",
};

export function Button(props: ButtonProps) {
  const {
    variant = "default",
    size = "md",
    loading = false,
    disabled = false,
    className,
    children,
    type,
    ...rest
  } = props;

  const classes = ["sk-btn", VARIANT_CLASS[variant], SIZE_CLASS[size], className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  const content: ReactNode = loading
    ? createElement(
        "span",
        { className: "sk-spinner", "aria-hidden": true, key: "spinner" },
      )
    : children;

  return createElement(
    "button",
    {
      ...rest,
      type: type ?? "button",
      className: classes,
      disabled: disabled || loading,
      "aria-busy": loading || undefined,
    },
    content,
  );
}
