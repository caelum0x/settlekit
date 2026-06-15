import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "SettleKit — Sell your software in USDC",
  description:
    "SettleKit lets developers sell private GitHub repos, SaaS subscriptions, API access, AI tools, templates, datasets, license keys, and digital downloads in USDC — with automatic access delivery.",
  metadataBase: new URL("https://settlekit.dev"),
  openGraph: {
    title: "SettleKit — Sell your software in USDC",
    description:
      "Sell private repos, SaaS, APIs, templates, and AI tools in USDC — and automatically deliver access after payment.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
