import { Card, PageHeader } from "@/components/ui";
import { getCreatorContext } from "@/lib/data";
import { shortWallet } from "@/lib/format";

export default function WalletSettingsPage() {
  const { me } = getCreatorContext();

  return (
    <>
      <PageHeader
        title="Wallet"
        description="Your payout wallet is the rule that turns attribution into settlement. Map your identity once; every citation routes here."
      />

      <Card title="Payout wallet">
        <div className="detail-grid">
          <dt>Creator</dt>
          <dd>
            {me.name} <span className="dim">({me.handle})</span>
          </dd>
          <dt>Network</dt>
          <dd className="mono">arc</dd>
          <dt>Address</dt>
          <dd className="mono" title={me.wallet}>
            {shortWallet(me.wallet)}
          </dd>
          <dt>Payee key</dt>
          <dd className="mono">rss · {me.handle}</dd>
        </div>
        <p className="field-hint" style={{ marginTop: 14 }}>
          Registered in the payee registry as <code>{`{ kind: "rss", externalId: "${me.handle}" } → ${shortWallet(me.wallet)}`}</code>.
          Until a creator claims their handle, earnings accrue to an escrow wallet and are released on registration.
        </p>
      </Card>

      <Card title="Cash out">
        <p className="muted" style={{ marginTop: 0 }}>
          Settled USDC can be swept to fiat through the Circle Payments Network off-ramp (e.g. USDC → local
          currency). This is wired in <code>packages/payouts-cpn</code> and activates once Circle CPN credentials
          are configured.
        </p>
        <div className="builder-actions">
          <button className="btn" disabled>
            Connect off-ramp (needs Circle CPN creds)
          </button>
        </div>
      </Card>
    </>
  );
}
