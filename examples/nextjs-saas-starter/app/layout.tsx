import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Export Pro — SettleKit Next.js starter",
  description:
    "A Next.js 14 SaaS starter that gates a premium feature behind a SettleKit entitlement using @settlekit/react.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <nav className="nav">
            <div className="nav__brand">
              <span>AI Export Pro</span>
              <span className="nav__badge">SettleKit demo</span>
            </div>
            <div className="nav__links">
              <Link href="/">Home</Link>
              <Link href="/export">Export</Link>
            </div>
          </nav>
          {children}
        </Providers>
      </body>
    </html>
  );
}
