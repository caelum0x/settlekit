// Shared, transport-neutral config. Safe to import from BOTH client and server
// components (no server-only dependencies live here), unlike `lib/api.ts` which
// reads the session cookie and is therefore server-only.

/** Base URL of the SettleKit API. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
