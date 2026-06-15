import { createElement } from "react";
import type { ReactNode } from "react";

export interface FormRowProps {
  label?: ReactNode;
  /** Associate the label with a control via id. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/** A single labeled form field with hint + error slots. */
export function FormRow(props: FormRowProps) {
  const { label, htmlFor, hint, error, required = false, children, className } = props;

  const classes = ["sk-field", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  const labelNode =
    label !== undefined
      ? createElement(
          "label",
          { className: "sk-field-label", htmlFor, key: "label" },
          label,
          required
            ? createElement("span", { className: "sk-field-required", key: "req", "aria-hidden": true }, "*")
            : null,
        )
      : null;

  const hintNode =
    hint !== undefined && error === undefined
      ? createElement("span", { className: "sk-field-hint", key: "hint" }, hint)
      : null;

  const errorNode =
    error !== undefined
      ? createElement("span", { className: "sk-field-error", role: "alert", key: "error" }, error)
      : null;

  return createElement("div", { className: classes }, labelNode, children, hintNode, errorNode);
}

export interface FormFieldsProps {
  children: ReactNode;
  className?: string;
}

/** Horizontal grouping of multiple FormRows. */
export function FormFields(props: FormFieldsProps) {
  const { children, className } = props;
  const classes = ["sk-form-row", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");
  return createElement("div", { className: classes }, children);
}
