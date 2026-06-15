import type { Money } from "@settlekit/common";

import { formatMoney } from "@/lib/format";
import type { OrderLine } from "@/lib/types";

interface OrderSummaryProps {
  lines: OrderLine[];
  total: Money;
}

/** Renders priced line items + the total. Pure presentational server component. */
export function OrderSummary({ lines, total }: OrderSummaryProps) {
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
      <div className="total">
        <span>Total</span>
        <span className="amount">{formatMoney(total)}</span>
      </div>
    </div>
  );
}
