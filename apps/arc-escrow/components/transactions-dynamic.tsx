"use client";

import dynamic from "next/dynamic";

// `next/dynamic` with `ssr: false` is only allowed inside a Client Component
// (Next.js 15+). This client wrapper re-exports the client-only Transactions
// table so Server Components (e.g. the dashboard page) can import it normally.
export const Transactions = dynamic(
  () => import("@/components/transactions").then((mod) => mod.Transactions),
  { ssr: false },
);
