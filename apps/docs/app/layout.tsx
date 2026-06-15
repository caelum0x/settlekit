/**
 * Root layout for the SettleKit documentation site.
 *
 * Renders the persistent sidebar <Nav> alongside the routed page content. Every
 * docs page is a server component that composes prose + <CodeBlock> samples.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "../components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SettleKit Docs",
    template: "%s — SettleKit Docs",
  },
  description:
    "Developer documentation for SettleKit: sell software, APIs, and private repos in USDC. SDKs, webhooks, entitlements, and x402 middleware.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="layout">
          <aside className="layout__sidebar">
            <Nav />
          </aside>
          <main className="layout__main">
            <div className="content">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
