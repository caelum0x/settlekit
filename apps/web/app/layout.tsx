import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
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
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SettleKit — Get paid in stablecoins on every chain",
  description:
    "Get paid in stablecoins on Solana, Ethereum, Base, Arbitrum, Robinhood Chain, Hyperliquid, Tempo and Zcash with no merchant of record. Buyers pay with any token; GitHub access, license keys, downloads and Discord roles are delivered automatically.",
  metadataBase: new URL("https://settlekit.dev"),
  openGraph: {
    title: "SettleKit — Get paid in stablecoins on every chain",
    description:
      "No merchant of record required. Share a link, buyers pay with any token, you receive stablecoins and access is delivered automatically.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
