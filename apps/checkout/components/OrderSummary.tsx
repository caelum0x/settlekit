import type { Money } from "@settlekit/common";

import { formatMoney } from "@/lib/format";
import type { OrderLine } from "@/lib/types";

interface OrderSummaryProps {
  lines: OrderLine[];
  total: Money;
  /** Applied promo code (total is already discounted). */
  discount?: { code: string; amountOff: Money } | null;
  /** Tax included in the total. */
  tax?: { label: string; rateBps: number; amount: Money; reverseCharge: boolean } | null;
  /** Localized labels (English by default). */
  labels?: { total: string; promo: string; reverseCharge: (label: string) => string };
}

const EN_LABELS = { total: "Total", promo: "Promo", reverseCharge: (label: string) => `${label} (reverse charge)` };

/** Renders priced line items + the total. Pure presentational server component. */
export function OrderSummary({ lines, total, discount, tax, labels = EN_LABELS }: OrderSummaryProps) {
  return (
    <div>
      {lines.map((line) => (
        <div className="line" key={line.priceId}>
          <div>
            <div className="line-name">
              {line.name}
              {line.quantity > 1 ? (
                <span className="qty"> × {line.quantity}</span>
              ) : null}
            </div>
            <div className="line-desc">{line.description}</div>
          </div>
          <div className="line-amount">{formatMoney(line.lineTotal)}</div>
        </div>
      ))}
      {discount ? (
        <div className="line-discount">
          <span>
            {labels.promo} <span className="mono">{discount.code}</span>
          </span>
          <span>-{formatMoney(discount.amountOff)}</span>
        </div>
      ) : null}
      {tax ? (
        <div className="line-discount">
          <span>
            {tax.reverseCharge ? labels.reverseCharge(tax.label) : `${tax.label} ${(tax.rateBps / 100).toString()}%`}
          </span>
          <span>{formatMoney(tax.amount)}</span>
        </div>
      ) : null}
      <div className="total">
        <span>{labels.total}</span>
        <span className="amount">{formatMoney(total)}</span>
      </div>
    </div>
  );
}
