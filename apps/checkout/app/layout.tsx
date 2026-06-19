import type { Metadata } from "next";
import type { ReactNode } from "react";
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
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
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
