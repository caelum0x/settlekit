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
  title: "SettleKit Portal",
  description:
    "Customer portal — manage everything you bought: access, subscriptions, license keys, API keys, payments, and downloads.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        <div className="app-shell">
          <header className="app-bar">
            <Link href="/" className="brand">
              <span className="brand-mark">SK</span>
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
