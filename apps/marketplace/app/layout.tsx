import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SettleKit Marketplace",
  description:
    "Discover published products and agent services. Pay with USDC over x402.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container inner">
            <Link href="/" className="brand">
              Settle<span>Kit</span> Marketplace
            </Link>
            <nav className="nav">
              <Link href="/">Listings</Link>
              <Link href="/agents">Agent Services</Link>
            </nav>
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="container inner">
            <span>Settled in USDC. Payments over the x402 protocol.</span>
            <span>© {new Date().getUTCFullYear()} SettleKit</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
