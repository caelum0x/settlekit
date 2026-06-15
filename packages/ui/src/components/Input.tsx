import { createElement } from "react";
import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Apply the invalid border treatment. */
  invalid?: boolean;
}

export function Input(props: InputProps) {
  const { invalid = false, className, ...rest } = props;
  const classes = ["sk-input", invalid ? "sk-input-invalid" : "", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");
  return createElement("input", {
    ...rest,
    className: classes,
    "aria-invalid": invalid || undefined,
  });
}
