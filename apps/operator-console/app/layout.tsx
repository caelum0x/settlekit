import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tameion Operator Console",
  description: "An autonomous business operator on Arc: USDC treasury, AP and refunds under on-chain guard rails.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/decisions", label: "Decisions" },
  { href: "/escalations", label: "Escalations" },
  { href: "/bills", label: "Bills" },
  { href: "/policy", label: "Policy" },
  { href: "/proof", label: "Proof" },
  { href: "/connect", label: "Connect your business" },
] as const;

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <div className="topbar">
          <div className="topbar-inner">
            <a className="brand" href="/">Tameion Operator</a>
            <nav className="nav" aria-label="Primary">
              {NAV.map((item) => (
                <a key={item.href} href={item.href}>{item.label}</a>
              ))}
            </nav>
            <span className="network">Arc testnet</span>
          </div>
        </div>
        <main id="main">{children}</main>
        <footer className="site">
          SettleKit autonomous operator. All balances and transactions are on Arc testnet USDC unless marked as simulation.
        </footer>
      </body>
    </html>
  );
}
