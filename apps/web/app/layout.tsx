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
  title: "SettleKit — Sell software, settle in USDC",
  description:
    "SettleKit lets developers sell private GitHub repos, SaaS subscriptions, API access, AI tools, templates, datasets, license keys, and digital downloads in USDC — with automatic access delivery.",
  metadataBase: new URL("https://settlekit.dev"),
  openGraph: {
    title: "SettleKit — Sell software, settle in USDC",
    description:
      "Sell private repos, SaaS, APIs, templates, and AI tools in USDC — and automatically deliver access after payment.",
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
