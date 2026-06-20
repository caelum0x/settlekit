import type { Metadata } from "next";
import { LinkWallet } from "@/components/LinkWallet";

export const metadata: Metadata = {
  title: "Wallet · SettleKit Portal",
  description: "Link a web3 wallet to your SettleKit account.",
};

export default function WalletPage() {
  return (
    <section className="portal-section">
      <h2 className="section-title">Wallet</h2>
      <p className="muted">
        Link a web3 wallet to sign in with Ethereum (SIWE) instead of a password
        or magic link.
      </p>
      <LinkWallet />
    </section>
  );
}
