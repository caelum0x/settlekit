import { createElement } from "react";
import type { SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: ReadonlyArray<SelectOption>;
  /** Optional leading placeholder option (disabled, empty value). */
  placeholder?: string;
  invalid?: boolean;
}

export function Select(props: SelectProps) {
  const { options, placeholder, invalid = false, className, ...rest } = props;
  const classes = ["sk-select", invalid ? "sk-input-invalid" : "", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  const optionNodes = options.map((opt) =>
    createElement(
      "option",
      { key: opt.value, value: opt.value, disabled: opt.disabled },
      opt.label,
    ),
  );

  const placeholderNode =
    placeholder !== undefined
      ? createElement(
          "option",
          { key: "__placeholder", value: "", disabled: true },
          placeholder,
        )
      : null;

  return createElement(
    "select",
    { ...rest, className: classes, "aria-invalid": invalid || undefined },
    placeholderNode,
    optionNodes,
  );
}
