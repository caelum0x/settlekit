import { api } from "@/lib/api";
import { PageHeader, Card, ErrorBanner } from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import { LinkWallet } from "@/components/LinkWallet";
import { getCurrentAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

async function saveSettings(values: Record<string, string>): Promise<string | null> {
  "use server";
  const { error } = await api.settings.update({
    orgName: values.orgName,
    supportEmail: values.supportEmail,
    payoutCurrency: values.payoutCurrency,
    defaultRail:
      values.defaultRail === "arc" || values.defaultRail === "x402"
        ? values.defaultRail
        : "circle",
  });
  return error;
}

export default async function SettingsPage() {
  const settings = await api.settings.get();
  const account = await getCurrentAccount();
  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization profile, payout currency, and default settlement rail."
      />
      <ErrorBanner error={null} />
      <Card title="Organization">
        <dl className="detail-grid" style={{ marginBottom: 18 }}>
          <dt>Webhook secret</dt>
          <dd className="mono">
            {settings.webhookSecret
              ? `${settings.webhookSecret.slice(0, 8)}••••••••`
              : "Not set"}
          </dd>
          <dt>Current rail</dt>
          <dd>{settings.defaultRail}</dd>
        </dl>
        <SimpleCreateForm
          submitLabel="Save settings"
          successMessage="Settings saved."
          action={saveSettings}
          fields={[
            { name: "orgName", label: "Organization name", required: true, placeholder: settings.orgName },
            { name: "supportEmail", label: "Support email", type: "email", placeholder: settings.supportEmail || "support@example.com" },
            {
              name: "payoutCurrency",
              label: "Payout currency",
              options: [
                { value: "USDC", label: "USDC" },
                { value: "USD", label: "USD" },
                { value: "EUR", label: "EUR" },
              ],
            },
            {
              name: "defaultRail",
              label: "Default settlement rail",
              options: [
                { value: "circle", label: "Circle" },
                { value: "arc", label: "Arc" },
                { value: "x402", label: "x402" },
              ],
            },
          ]}
        />
      </Card>
      <Card title="Wallet">
        <p className="page-desc" style={{ marginBottom: 12 }}>
          Link a web3 wallet to sign in with Ethereum (SIWE) instead of a
          password.
        </p>
        <LinkWallet {...(account?.walletAddress ? { linkedAddress: account.walletAddress } : {})} />
      </Card>
    </>
  );
}
