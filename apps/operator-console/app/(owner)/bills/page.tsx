import { BillForm } from "@/components/BillForm";
import { Notice, OutcomeBadge, PageHeader } from "@/components/ui";
import { describeError } from "@/lib/api-client";
import { baseUnitsToUsdc, formatDateTime, formatUsdc } from "@/lib/format";
import { operatorApi } from "@/lib/server-api";
import type { BillView } from "@/lib/types";
import { addBill } from "./actions";

export default async function BillsPage() {
  let bills: readonly BillView[] = [];
  let loadError: string | null = null;
  try {
    bills = [...(await operatorApi().bills())].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    loadError = describeError(error);
  }
  return (
    <div className="stack">
      <PageHeader title="Bills" lead="Accounts payable. The agent pays allowlisted vendors from the operating float within caps, and escalates anything else to you." />
      <div className="grid grid-2">
        <section className="card" aria-labelledby="add-h">
          <h2 id="add-h">Add a bill</h2>
          <BillForm action={addBill} />
        </section>
        <section className="card table-wrap" aria-labelledby="list-h">
          <h2 id="list-h">All bills</h2>
          {loadError ? <Notice tone="bad">{loadError}</Notice> : null}
          {!loadError && bills.length === 0 ? <p className="muted">No bills yet.</p> : null}
          {bills.length > 0 ? (
            <table>
              <thead>
                <tr><th scope="col">Due</th><th scope="col">Description</th><th scope="col" className="num">USDC</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td>{formatDateTime(b.dueAt).slice(0, 10)}</td>
                    <td>
                      {b.description}
                      <div className="mono small muted" title={b.payee}>{b.payee}</div>
                    </td>
                    <td className="num">{formatUsdc(baseUnitsToUsdc(b.amount))}</td>
                    <td><OutcomeBadge outcome={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      </div>
    </div>
  );
}
