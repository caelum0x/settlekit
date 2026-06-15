"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { PaymentNetwork } from "@settlekit/common";

import { confirmCheckoutPayment, ApiClientError } from "@/lib/api";
import { validateFields } from "@/lib/fields";
import { formatNetwork, truncateMiddle } from "@/lib/format";
import type { CollectedFieldSpec } from "@/lib/types";
import { CopyButton } from "./CopyButton";

interface PaymentFormProps {
  sessionId: string;
  amountLabel: string;
  payToAddress: string;
  network: PaymentNetwork;
  requiredFields: CollectedFieldSpec[];
  initialValues: Record<string, string>;
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Buyer-facing payment form. Collects required delivery fields, shows the USDC
 * amount + pay-to address with a copy button, accepts the on-chain tx hash, and
 * POSTs to the SettleKit API to confirm. On success, navigates to the access
 * page. All validation runs client-side first, then the server re-validates.
 */
export function PaymentForm({
  sessionId,
  amountLabel,
  payToAddress,
  network,
  requiredFields,
  initialValues,
}: PaymentFormProps) {
  const router = useRouter();

  const initialFieldState = useMemo(() => {
    const state: Record<string, string> = {};
    for (const spec of requiredFields) {
      state[spec.key] = initialValues[spec.key] ?? "";
    }
    return state;
  }, [requiredFields, initialValues]);

  const [fields, setFields] = useState<Record<string, string>>(initialFieldState);
  const [txHash, setTxHash] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

  const onFieldChange = useCallback((key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: false }));
  }, []);

  const txHashValid = TX_HASH_RE.test(txHash.trim());

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      const messages = validateFields(requiredFields, fields);
      if (messages.length > 0) {
        const flags: Record<string, boolean> = {};
        for (const spec of requiredFields) {
          const value = (fields[spec.key] ?? "").trim();
          if (spec.required && value.length === 0) flags[spec.key] = true;
        }
        setFieldErrors(flags);
        setError(messages.join(" "));
        return;
      }

      if (!TX_HASH_RE.test(txHash.trim())) {
        setError(
          "Enter the transaction hash of your USDC payment (0x followed by 64 hex characters).",
        );
        return;
      }

      setSubmitting(true);
      try {
        await confirmCheckoutPayment(sessionId, {
          txHash: txHash.trim(),
          fields,
        });
        router.push(`/c/${sessionId}/success`);
        router.refresh();
      } catch (err) {
        if (err instanceof ApiClientError) {
          if (err.expired) {
            router.push(`/c/${sessionId}/expired`);
            return;
          }
          setError(err.message);
        } else {
          setError("Could not confirm payment. Please try again.");
        }
        setSubmitting(false);
      }
    },
    [requiredFields, fields, txHash, sessionId, router],
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="alert alert-info">
        Send exactly <strong>{amountLabel}</strong> on{" "}
        <strong>{formatNetwork(network)}</strong> to the address below, then
        paste your transaction hash to unlock access.
      </div>

      <div className="payto" style={{ marginBottom: 20 }}>
        <div className="payto-row">
          <span className="label">Pay to address</span>
          <CopyButton value={payToAddress} label="Copy" />
        </div>
        <div className="mono" title={payToAddress}>
          {payToAddress}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {truncateMiddle(payToAddress)} · {formatNetwork(network)} · USDC
        </div>
      </div>

      {requiredFields.map((spec) => (
        <div className="field" key={spec.key}>
          <label htmlFor={`field-${spec.key}`}>{spec.label}</label>
          <input
            id={`field-${spec.key}`}
            className={`input${fieldErrors[spec.key] ? " input-error" : ""}`}
            type={spec.inputType}
            inputMode={spec.inputType === "email" ? "email" : "text"}
            value={fields[spec.key] ?? ""}
            placeholder={spec.placeholder}
            autoComplete="off"
            onChange={(e) => onFieldChange(spec.key, e.target.value)}
            required={spec.required}
          />
          <div className="help">{spec.help}</div>
        </div>
      ))}

      <div className="field">
        <label htmlFor="txHash">Transaction hash</label>
        <input
          id="txHash"
          className={`input mono${
            txHash.length > 0 && !txHashValid ? " input-error" : ""
          }`}
          type="text"
          value={txHash}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTxHash(e.target.value)}
        />
        <div className="help">
          Paste the on-chain hash of your USDC transfer. We verify it before
          delivering access.
        </div>
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        disabled={submitting}
      >
        {submitting ? "Confirming payment…" : `Confirm payment of ${amountLabel}`}
      </button>
    </form>
  );
}
