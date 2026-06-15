import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SettleKit Portal",
  description:
    "Customer portal — manage everything you bought: access, subscriptions, license keys, API keys, payments, and downloads.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="app-bar">
            <Link href="/" className="brand">
              <span className="brand-mark">◆</span>
              <span className="brand-name">SettleKit</span>
              <span className="brand-sub">Portal</span>
            </Link>
          </header>
          <main className="app-main">{children}</main>
          <footer className="app-footer">
            <span>SettleKit customer portal</span>
            <span>Manage your purchases, paid in USDC.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
