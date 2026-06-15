"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface DownloadButtonProps {
  fileId: string;
  customerId: string;
}

/**
 * Requests a fresh HMAC-signed, usage-limited download URL from the API and
 * opens it. Links are minted on demand rather than stored, so they stay valid.
 */
export function DownloadButton({ fileId, customerId }: DownloadButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function handleDownload() {
    setState("loading");
    setMessage("");
    const { data, error } = await api.files.issueDownload({ fileId, customerId });
    if (error || !data?.url) {
      setState("error");
      setMessage(error ?? "Could not generate a download link.");
      return;
    }
    setState("idle");
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="download-action">
      <button
        type="button"
        className="btn btn-primary"
        onClick={handleDownload}
        disabled={state === "loading"}
      >
        {state === "loading" ? "Preparing…" : "Get download link"}
      </button>
      {message ? <span className="download-msg-error">{message}</span> : null}
    </div>
  );
}
