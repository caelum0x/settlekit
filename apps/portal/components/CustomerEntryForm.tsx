"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Landing-page form: the buyer enters their customer id and is routed to their
 * portal at /c/[customerId]. Production would replace this with an
 * authenticated magic-link flow (see README).
 */
export function CustomerEntryForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = value.trim();
    if (!id) {
      setError("Enter your customer id to continue.");
      return;
    }
    setError(null);
    router.push(`/c/${encodeURIComponent(id)}`);
  }

  return (
    <form className="entry-form" onSubmit={handleSubmit}>
      <label className="entry-label" htmlFor="customer-id">
        Customer id
      </label>
      <div className="entry-row">
        <input
          id="customer-id"
          className="entry-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="customer_…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          Open portal
        </button>
      </div>
      {error ? <p className="entry-error">{error}</p> : null}
    </form>
  );
}
