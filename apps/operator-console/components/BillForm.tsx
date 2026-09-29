"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { BillFormState } from "@/app/(owner)/bills/actions";

interface Props {
  readonly action: (prev: BillFormState, formData: FormData) => Promise<BillFormState>;
}

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Submitting" : "Add bill"}</button>;
}

function FieldError({ id, message }: { readonly id: string; readonly message?: string }) {
  return message ? <span id={id} className="field-error">{message}</span> : null;
}

export function BillForm({ action }: Props) {
  const [state, formAction] = useFormState(action, { status: "idle" });
  const [mode, setMode] = useState<"manual" | "invoice">("manual");
  const err = state.errors ?? {};
  return (
    <form className="form" action={formAction}>
      <fieldset>
        <legend>How do you want to add it?</legend>
        <div className="row">
          <label style={{ flexDirection: "row", alignItems: "center" }}>
            <input type="radio" name="mode" value="manual" checked={mode === "manual"} onChange={() => setMode("manual")} /> Enter details
          </label>
          <label style={{ flexDirection: "row", alignItems: "center" }}>
            <input type="radio" name="mode" value="invoice" checked={mode === "invoice"} onChange={() => setMode("invoice")} /> Paste invoice text
          </label>
        </div>
      </fieldset>
      {mode === "manual" ? (
        <>
          <label>
            Payee wallet
            <input name="payee" placeholder="0x..." aria-invalid={Boolean(err.payee)} aria-describedby="payee-err" />
            <FieldError id="payee-err" message={err.payee} />
          </label>
          <div className="grid grid-2">
            <label>
              Amount (USDC)
              <input name="amountUsdc" inputMode="decimal" placeholder="120.00" aria-invalid={Boolean(err.amountUsdc)} aria-describedby="amount-err" />
              <FieldError id="amount-err" message={err.amountUsdc} />
            </label>
            <label>
              Due date
              <input type="date" name="dueDate" aria-invalid={Boolean(err.dueDate)} aria-describedby="due-err" />
              <FieldError id="due-err" message={err.dueDate} />
            </label>
          </div>
          <label>
            Description
            <input name="description" maxLength={500} placeholder="Hosting, October" aria-invalid={Boolean(err.description)} aria-describedby="desc-err" />
            <FieldError id="desc-err" message={err.description} />
          </label>
          <label>
            Vendor <span className="hint">optional</span>
            <input name="vendor" maxLength={200} />
          </label>
        </>
      ) : (
        <label>
          Invoice text
          <span className="hint">Claude extracts vendor, amount, due date and wallet. Unknown payees are escalated to you, never paid automatically.</span>
          <textarea name="invoiceText" aria-invalid={Boolean(err.invoiceText)} aria-describedby="inv-err" />
          <FieldError id="inv-err" message={err.invoiceText} />
        </label>
      )}
      <div aria-live="polite">
        {state.status === "error" && state.message ? <p className="field-error">{state.message}</p> : null}
        {state.status === "ok" && state.message ? (
          <p className="notice notice-ok">
            {state.message}{" "}
            {state.decisionId ? <a href={`/decisions/${encodeURIComponent(state.decisionId)}`}>View decision</a> : null}
          </p>
        ) : null}
      </div>
      <Submit />
    </form>
  );
}
