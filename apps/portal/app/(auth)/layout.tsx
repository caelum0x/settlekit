import type { ReactNode } from "react";

/**
 * Shared shell for the customer auth pages (sign in / sign up). Renders inside
 * the root layout's <main>, so it only provides the centered auth card frame.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="auth-shell">{children}</div>;
}
