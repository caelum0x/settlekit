import type { Metadata } from "next";
import { ConnectForm, LinkForm } from "@/components/ConnectForms";
import { PageHeader } from "@/components/ui";
import { connect, link } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connect your business | Tameion Operator",
  description: "Take USDC on Arc into a vault an AI operator runs under your caps, allowlist and approval.",
};

export default function ConnectPage() {
  return (
    <div className="stack">
      <PageHeader
        title="Connect your business"
        lead="For small teams piloting on Arc testnet. You get your own SettleKit organization and API key, a product with a USDC price, and a checkout link that pays straight into your OperatorVault. The vault enforces your caps and payee allowlist on-chain; larger or unknown payments wait for you."
      />
      <div className="card small">
        <h2>What is honest to expect</h2>
        <ul>
          <li>Arc testnet only. No real money moves.</li>
          <li>The vault is yours: you deploy it with the command we generate, and only your owner wallet can approve, pause or change it.</li>
          <li>The Tameion agent operates one vault per runtime. After you deploy, we point an operator runtime at your vault (OPERATOR_ORG_ID and OPERATOR_VAULT_ADDRESS) so decisions appear in your log and on the public proof page.</li>
        </ul>
      </div>
      <section className="card" aria-labelledby="connect-h">
        <h2 id="connect-h">Create your organization</h2>
        <ConnectForm action={connect} />
      </section>
      <section className="card" aria-labelledby="link-h">
        <h2 id="link-h">Add your vault</h2>
        <p className="muted">Already connected and deployed your vault? Mint a checkout link that pays into it.</p>
        <LinkForm action={link} />
      </section>
    </div>
  );
}
