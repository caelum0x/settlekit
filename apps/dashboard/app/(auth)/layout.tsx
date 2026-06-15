import type { ReactNode } from "react";

/**
 * Centered auth shell. The route group has no sidebar; it overlays the global
 * app-shell grid (which still wraps it from the root layout) with a centered
 * full-height panel. Non-breaking: existing pages are unaffected.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-shell-inner">
        <div className="auth-brand">
          <span className="sidebar-logo">◆</span>
          <span>SettleKit</span>
        </div>
        {children}
      </div>
    </div>
  );
}
