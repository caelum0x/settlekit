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
  title: "SettleKit Admin",
  description: "Internal admin + risk console for the SettleKit Commerce OS.",
};

const NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/", label: "Overview" },
  { href: "/risk", label: "Risk queue" },
  { href: "/organizations", label: "Organizations" },
  { href: "/deliveries", label: "Failed deliveries" },
  { href: "/webhooks", label: "Webhooks" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        <div className="layout">
          <aside className="sidebar">
            <div className="brand">
              SettleKit
              <small>Admin &amp; Risk Console</small>
            </div>
            <nav className="nav">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
