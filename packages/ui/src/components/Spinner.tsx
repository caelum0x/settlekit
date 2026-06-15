import { createElement } from "react";

export interface SpinnerProps {
  size?: "sm" | "lg";
  /** Accessible label. Default "Loading". */
  label?: string;
  className?: string;
}

export function Spinner(props: SpinnerProps) {
  const { size = "sm", label = "Loading", className } = props;
  const classes = ["sk-spinner", size === "lg" ? "sk-spinner-lg" : "", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");
  return createElement("span", {
    className: classes,
    role: "status",
    "aria-label": label,
  });
}
