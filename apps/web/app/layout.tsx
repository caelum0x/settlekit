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
  title: "SettleKit | Accept USDC payments with no card fees",
  description:
    "Accept USDC payments for your business with no card fees and no chargebacks. Share a checkout link; buyers pay on Solana, Base, Ethereum or Arbitrum and the money lands in your own wallet. 1% per payment.",
  metadataBase: new URL("https://settlekit.dev"),
  openGraph: {
    title: "SettleKit | Accept USDC payments with no card fees",
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
