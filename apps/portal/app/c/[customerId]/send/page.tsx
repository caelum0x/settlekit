import type { Metadata } from "next";
import { P2PSend } from "@/components/P2PSend";

export const metadata: Metadata = {
  title: "Send · SettleKit Portal",
  description: "Send USDC on Arc to another wallet.",
};

export default function SendPage() {
  return (
    <section className="portal-section">
      <h2 className="section-title">Send USDC</h2>
      <p className="muted">
        Send USDC on Arc directly to another wallet — instant, gas-free P2P
        settlement.
      </p>
      <P2PSend />
    </section>
  );
}
