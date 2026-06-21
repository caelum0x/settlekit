import type { Metadata } from "next";
import { EditProfile } from "@/components/EditProfile";
import { LinkWallet } from "@/components/LinkWallet";

export const metadata: Metadata = {
  title: "Wallet · SettleKit Portal",
  description: "Link a web3 wallet to your SettleKit account.",
};

export default function WalletPage() {
  return (
    <>
      <section className="portal-section">
        <h2 className="section-title">Profile</h2>
        <p className="muted">
          Update the display name shown on your SettleKit account.
        </p>
        <EditProfile />
      </section>
      <section className="portal-section">
        <h2 className="section-title">Wallet</h2>
        <p className="muted">
          Link a web3 wallet to sign in with Ethereum (SIWE) instead of a password
          or magic link.
        </p>
        <LinkWallet />
      </section>
    </>
  );
}
