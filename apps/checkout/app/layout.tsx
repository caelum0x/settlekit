import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "SettleKit Checkout",
  description:
    "Pay in USDC and get instant access — private repos, license keys, API keys, downloads, and Discord roles.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="page">
          <header className="topbar">
            <span className="brand">SettleKit</span>
            <span className="brand-sub">Hosted USDC Checkout</span>
          </header>
          <main className="content">{children}</main>
          <footer className="footer">
            <span>
              Payments settle in USDC. Access is delivered automatically.
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}
