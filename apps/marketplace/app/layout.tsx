import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-archivo",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono-plex",
  display: "swap",
});

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
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
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
