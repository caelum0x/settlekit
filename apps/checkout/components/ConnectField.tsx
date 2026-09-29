"use client";

import type { CollectedFieldSpec } from "@/lib/types";

interface ConnectFieldProps {
  id: string;
  spec: CollectedFieldSpec & { connect: NonNullable<CollectedFieldSpec["connect"]> };
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}

/**
 * A delivery identity filled by connecting an account (Discord OAuth): shows
 * who is connected, a connect / reconnect button, and a manual fallback.
 */
export function ConnectField({ id, spec, value, onChange, disabled, invalid }: ConnectFieldProps) {
  const connected = spec.connect.connectedAs !== null && value.length > 0;
  return (
    <div className="field">
      <label htmlFor={id}>{spec.label}</label>
      <div className="connect-row">
        {connected ? (
          <span className="badge badge-network">Connected as {spec.connect.connectedAs}</span>
        ) : null}
        <a className={`btn ${connected ? "btn-small" : "btn-primary"}`} href={spec.connect.url} aria-disabled={disabled}>
          {connected ? "Use another account" : spec.connect.label}
        </a>
      </div>
      <div className="help">{spec.help}</div>
      {connected ? null : (
        <details className="connect-manual">
          <summary className="muted">Enter your user ID instead</summary>
          <input
            id={id}
            className={`input${invalid ? " input-error" : ""}`}
            type="text"
            value={value}
            placeholder={spec.placeholder}
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </details>
      )}
    </div>
  );
}
