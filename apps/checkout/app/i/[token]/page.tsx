import { notFound } from "next/navigation";

import { InvoiceLinkError, getInvoice } from "@/lib/invoice-link";
import { serverT } from "@/lib/i18n";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { token: string };
  searchParams: { error?: string; lang?: string };
}

function day(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/**
 * Public invoice / payment request page. Shows what is owed and one action:
 * pay in USDC (opens the invoice's checkout session) or, once paid, the
 * receipt with the settlement transaction.
 */
export default async function InvoicePage({ params, searchParams }: PageProps) {
  let invoice;
  try {
    invoice = await getInvoice(params.token);
  } catch (error) {
    if (error instanceof InvoiceLinkError && error.status === 404) notFound();
    return (
      <div className="card">
        <h2>Invoice unavailable</h2>
        <p className="muted">
          {error instanceof Error ? error.message : "This invoice could not be loaded."} Try again in a minute.
        </p>
      </div>
    );
  }

  const pdfHref = `/i/${encodeURIComponent(params.token)}/pdf`;
  const t = serverT(searchParams.lang);
  return (
    <div>
      <div className="card">
        <p className="merchant">{t("invoice.from", { merchant: invoice.merchantName })}</p>
        <h2>{invoice.number}</h2>
        {invoice.dueAt && invoice.status === "open" ? <p className="muted">{t("invoice.due", { date: day(invoice.dueAt) ?? "" })}</p> : null}
        <ul className="line-items">
          {invoice.lineItems.map((line, i) => (
            <li key={i} className="line-desc">
              {line.quantity > 1 ? `${line.quantity} x ` : ""}
              {line.description}: {line.unitAmount} {invoice.currency}
            </li>
          ))}
        </ul>
        {invoice.discount ? (
          <div className="total">
            <span>{t("invoice.discount")}</span>
            <span>-{invoice.discount} {invoice.currency}</span>
          </div>
        ) : null}
        {invoice.tax ? (
          <div className="total">
            <span>{t("invoice.tax")}</span>
            <span>
              {invoice.tax} {invoice.currency}
            </span>
          </div>
        ) : null}
        <div className="total">
          <span>{t("order.total")}</span>
          <span>
            {invoice.total} {invoice.currency}
          </span>
        </div>
      </div>
      <div className="card">
        {searchParams.error ? (
          <div className="alert alert-error" role="alert">
            We could not open the payment just now. Please try again.
          </div>
        ) : null}
        {invoice.status === "paid" ? (
          <div>
            <h3>{t("invoice.paid")}</h3>
            <p className="muted">
              {t("invoice.paidOn", { date: day(invoice.paidAt) ?? "" })}
              {invoice.paidNetwork ? ` on ${invoice.paidNetwork}` : ""}.
            </p>
            {invoice.paidTxHash ? <p className="mono">{invoice.paidTxHash}</p> : null}
          </div>
        ) : invoice.payable ? (
          <form method="post" action={`/i/${encodeURIComponent(params.token)}/start`}>
            <button type="submit" className="btn btn-primary">
              {t("invoice.pay", { amount: invoice.total, currency: invoice.currency })}
            </button>
          </form>
        ) : (
          <p className="muted">{invoice.unpayableReason}</p>
        )}
        <p style={{ marginTop: 12 }}>
          <a href={pdfHref}>{invoice.status === "paid" ? t("invoice.downloadReceipt") : t("invoice.downloadInvoice")}</a>
        </p>
      </div>
    </div>
  );
}
