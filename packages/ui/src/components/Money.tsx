import { createElement } from "react";
import type { Currency } from "@settlekit/common";
import { formatUsdc } from "../format.js";
import type { FormatUsdcOptions } from "../format.js";

export interface MoneyProps {
  /** Decimal-string amount in the major unit, e.g. "25.50". Never a float. */
  amount: string;
  currency?: Currency;
  /** Show the currency code after the amount. */
  showCurrency?: boolean;
  /** Tint negative amounts using the "bad" tone. Default true. */
  colorNegative?: boolean;
  className?: string;
  format?: FormatUsdcOptions;
}

/**
 * Render a USDC amount. Accepts the canonical decimal-string representation
 * and formats it without ever converting through a JS float.
 */
export function Money(props: MoneyProps) {
  const {
    amount,
    currency = "USDC",
    showCurrency = false,
    colorNegative = true,
    className,
    format,
  } = props;

  const formatted = formatUsdc(amount, format);
  const negative = formatted.startsWith("-");

  const classes = ["sk-money", colorNegative && negative ? "sk-money-negative" : "", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  return createElement(
    "span",
    { className: classes, title: `${formatted} ${currency}` },
    formatted,
    showCurrency
      ? createElement("span", { className: "sk-money-currency", key: "cur" }, currency)
      : null,
  );
}
