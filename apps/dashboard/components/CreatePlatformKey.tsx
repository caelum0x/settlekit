"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CreatePlatformKeyProps {
  /** Server action: returns the one-time plaintext or an error. */
  action: (label: string, scopes: string[]) => Promise<{ plaintext?: string; error?: string }>;
  scopes: readonly string[];
}

/** Create a restricted API key and show its secret exactly once. */
export function CreatePlatformKey({ action, scopes }: CreatePlatformKeyProps) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(["payments:read"]));
  const [full, setFull] = useState(false);
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await action(label.trim() || "API key", full ? ["platform:admin"] : [...picked]);
    setPending(false);
    if (result.error || !result.plaintext) {
      setError(result.error ?? "Could not create the key.");
      return;
    }
    setSecret(result.plaintext);
    router.refresh();
  }

  if (secret) {
    return (
      <div>
        <p className="page-desc">Copy this key now. It is shown only once.</p>
        <code className="mono" style={{ wordBreak: "break-all" }}>
          {secret}
        </code>
        <p>
          <button type="button" className="btn btn-small" onClick={() => setSecret(null)}>
            Done
          </button>
        </p>
      </div>
    );
  }

  const toggle = (scope: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="key-label">What is it for</label>
        <input id="key-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Reporting job" />
      </div>
      <label className="field-hint">
        <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Full access
      </label>
      {!full ? (
        <div className="tag-list" style={{ marginTop: 8 }}>
          {scopes.map((scope) => (
            <label key={scope} className="tag">
              <input type="checkbox" checked={picked.has(scope)} onChange={() => toggle(scope)} /> {scope}
            </label>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending || (!full && picked.size === 0)}>
        {pending ? "Creating..." : "Create key"}
      </button>
    </form>
  );
}
