"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ConnectState, LinkState } from "@/app/connect/actions";
import { PRODUCT_KINDS } from "@/lib/onboarding-kinds";

type Action<S> = (prev: S, formData: FormData) => Promise<S>;

const KIND_LABELS: Readonly<Record<string, string>> = {
  saas_plan: "Software subscription",
  api_access: "API access",
  consulting_slot: "Consulting or services",
  support_plan: "Support plan",
  digital_download: "Digital product",
};

function Submit({ label, busy }: { readonly label: string; readonly busy: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? busy : label}</button>;
}

interface FieldProps {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly type?: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
  readonly autoComplete?: string;
  readonly inputMode?: "decimal" | "text" | "email";
}

function Field({ name, label, hint, error, type = "text", placeholder, defaultValue, required = true, autoComplete, inputMode }: FieldProps) {
  const errId = `${name}-err`;
  return (
    <label>
      {label}
      {hint ? <span className="hint">{hint}</span> : null}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errId : undefined}
      />
      {error ? <span id={errId} className="field-error">{error}</span> : null}
    </label>
  );
}

function Copyable({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <p className="stat-label">{label}</p>
      <pre tabIndex={0}>{value}</pre>
    </div>
  );
}

function ConnectResultView({ state }: { readonly state: ConnectState }) {
  const r = state.result;
  if (!r) return null;
  return (
    <section className="card stack" aria-labelledby="done-h" aria-live="polite">
      <h2 id="done-h">Your business is connected</h2>
      <p className="notice notice-warn" role="status">
        Save the API key below now. It is shown once and this console does not store it.
      </p>
      <dl className="kv">
        <dt>Organization</dt><dd className="mono">{r.orgId}</dd>
        <dt>Product</dt><dd className="mono">{r.productId}</dd>
        <dt>Price</dt><dd className="mono">{r.priceId}</dd>
      </dl>
      <Copyable label="API key (secret)" value={r.apiKey} />
      {r.checkout ? (
        <div>
          <p className="stat-label">Arc USDC checkout link into your vault</p>
          <p><a href={r.checkout.url} target="_blank" rel="noreferrer noopener">{r.checkout.url}</a></p>
          <p className="muted small">One checkout per link{r.checkout.expiresAt ? `, valid until ${r.checkout.expiresAt.slice(0, 10)}` : ""}. Mint more with the form below or POST /v1/checkout-sessions.</p>
        </div>
      ) : (
        <p className="muted">No vault address yet, so no checkout link. Deploy your vault with the commands below, then use "Add your vault".</p>
      )}
      <div>
        <h3>Guard rails on Arc</h3>
        <p className="muted small">Your caps and payee allowlist are enforced by your own OperatorVault. Run these from the SettleKit repo; the owner key stays with you.</p>
        {r.commands.map((c, i) => <Copyable key={i} label={i === 0 ? "1. Deploy the vault" : `${i + 1}. Allowlist a payee`} value={c} />)}
        <Copyable label="Matching off-chain policy (PUT /v1/operator/policy)" value={JSON.stringify(r.policy, null, 2)} />
      </div>
    </section>
  );
}

export function ConnectForm({ action }: { readonly action: Action<ConnectState> }) {
  const [state, formAction] = useFormState(action, { status: "idle" });
  const e = state.errors ?? {};
  if (state.status === "ok") return <ConnectResultView state={state} />;
  return (
    <form className="form" action={formAction} noValidate>
      <fieldset>
        <legend>1. Your organization</legend>
        <Field name="teamName" label="Team or company" error={e.teamName} autoComplete="organization" />
        <Field name="email" label="Email" type="email" error={e.email} autoComplete="email" inputMode="email" />
        <Field name="password" label="Password" type="password" hint="At least 10 characters. Signs you in to SettleKit." error={e.password} autoComplete="new-password" />
      </fieldset>
      <fieldset>
        <legend>2. What you sell</legend>
        <Field name="productName" label="Product name" error={e.productName} />
        <label>
          Product type
          <select name="productKind" defaultValue="saas_plan" aria-invalid={Boolean(e.productKind)}>
            {PRODUCT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>)}
          </select>
        </label>
        <Field name="priceUsdc" label="Price (USDC)" placeholder="49.00" error={e.priceUsdc} inputMode="decimal" />
      </fieldset>
      <fieldset>
        <legend>3. Guard rails</legend>
        <Field name="ownerAddress" label="Owner wallet" hint="The human who approves escalations and can pause the vault." placeholder="0x..." error={e.ownerAddress} />
        <label>
          Payee allowlist
          <span className="hint">Vendor and contractor wallets the agent may pay, one per line. Anyone else is escalated to you.</span>
          <textarea name="allowlist" rows={3} aria-invalid={Boolean(e.allowlist)} aria-describedby={e.allowlist ? "allowlist-err" : undefined} />
          {e.allowlist ? <span id="allowlist-err" className="field-error">{e.allowlist}</span> : null}
        </label>
        <div className="grid grid-2">
          <Field name="perTxCap" label="Per-payment cap (USDC)" defaultValue="250" error={e.perTxCap} inputMode="decimal" />
          <Field name="dailyCap" label="Daily cap (USDC)" defaultValue="500" error={e.dailyCap} inputMode="decimal" />
        </div>
        <Field name="escalateAbove" label="Escalate above (USDC)" hint="Larger payments wait for your approval in the vault." defaultValue="100" error={e.escalateAbove} inputMode="decimal" />
        <Field name="vaultAddress" label="OperatorVault address" hint="Optional. Leave empty if you have not deployed it yet." placeholder="0x..." required={false} error={e.vaultAddress} />
      </fieldset>
      <div aria-live="polite">{state.status === "error" && state.message ? <p className="field-error">{state.message}</p> : null}</div>
      <Submit label="Connect my business" busy="Connecting" />
    </form>
  );
}

export function LinkForm({ action }: { readonly action: Action<LinkState> }) {
  const [state, formAction] = useFormState(action, { status: "idle" });
  const e = state.errors ?? {};
  return (
    <form className="form" action={formAction} noValidate>
      <Field name="apiKey" label="Your SettleKit API key" type="password" error={e.apiKey} autoComplete="off" />
      <div className="grid grid-2">
        <Field name="productId" label="Product id" error={e.productId} />
        <Field name="priceId" label="Price id" error={e.priceId} />
      </div>
      <Field name="vaultAddress" label="OperatorVault address" placeholder="0x..." error={e.vaultAddress} />
      <div aria-live="polite">
        {state.status === "error" && state.message ? <p className="field-error">{state.message}</p> : null}
        {state.status === "ok" && state.link ? (
          <p className="notice notice-ok">
            Checkout link: <a href={state.link.url} target="_blank" rel="noreferrer noopener">{state.link.url}</a>
          </p>
        ) : null}
      </div>
      <Submit label="Create checkout link" busy="Creating" />
    </form>
  );
}
