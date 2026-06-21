"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "email" | "number" | "url" | "textarea";
  placeholder?: string;
  hint?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

interface SimpleCreateFormProps {
  fields: FieldDef[];
  submitLabel: string;
  /** Posts via a server action; returns an error string or null on success. */
  action: (values: Record<string, string>) => Promise<string | null>;
  successMessage?: string;
}

/**
 * Generic create form: renders typed inputs, POSTs through a server action,
 * shows inline success/error, and refreshes server data on success.
 */
export function SimpleCreateForm({
  fields,
  submitLabel,
  action,
  successMessage = "Created successfully.",
}: SimpleCreateFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  function update(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const error = await action(values);
      if (error) {
        setMessage({ ok: false, text: error });
      } else {
        setMessage({ ok: true, text: successMessage });
        setValues({});
        router.refresh();
      }
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      {fields.map((f) => (
        <div className="field" key={f.name}>
          <label htmlFor={f.name}>{f.label}</label>
          {f.options ? (
            <select
              id={f.name}
              className="select"
              value={values[f.name] ?? ""}
              required={f.required}
              onChange={(e) => update(f.name, e.target.value)}
            >
              <option value="">Select…</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              id={f.name}
              className="textarea"
              placeholder={f.placeholder}
              value={values[f.name] ?? ""}
              required={f.required}
              onChange={(e) => update(f.name, e.target.value)}
            />
          ) : (
            <input
              id={f.name}
              className="input"
              type={f.type ?? "text"}
              placeholder={f.placeholder}
              value={values[f.name] ?? ""}
              required={f.required}
              onChange={(e) => update(f.name, e.target.value)}
            />
          )}
          {f.hint ? <span className="field-hint">{f.hint}</span> : null}
        </div>
      ))}
      {message ? (
        <div className={`form-message ${message.ok ? "ok" : "err"}`}>
          {message.text}
        </div>
      ) : null}
      <div className="builder-actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
