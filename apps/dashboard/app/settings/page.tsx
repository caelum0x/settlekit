import Link from "next/link";
import { api } from "@/lib/api";
import { merchantApi } from "@/lib/merchant-api";
import { PageHeader, Card, ErrorBanner } from "@/components/ui";
import { LinkWallet } from "@/components/LinkWallet";
import { EditProfile } from "@/components/EditProfile";
import { SessionList } from "@/components/SessionList";
import { NetworkAddressForm } from "@/components/NetworkAddressForm";
import { getCurrentAccount } from "@/lib/session";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import { describeTax, parseTaxForm } from "@/lib/tax-form";

async function saveTax(values: Record<string, string>): Promise<string | null> {
  "use server";
  let tax;
  try {
    tax = parseTaxForm(values);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid tax settings";
  }
  const { error } = await api.settings.update({ tax });
  return error;
}

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [profile, hooks, keys, account, settings] = await Promise.all([
    merchantApi.profile(),
    api.webhooks.list(),
    api.apiKeys.list(),
    getCurrentAccount(),
    api.settings.get(),
  ]);
  return (
    <>
      <PageHeader title="Settings" description="Where you get paid, how your systems hear about payments, and your account." />
      <ErrorBanner error={profile.error} />

      <Card title="Networks and receiving addresses">
        <p className="page-desc" style={{ marginBottom: 16 }}>
          New checkouts use these addresses immediately. Existing open checkouts keep the address they were created
          with.
        </p>
        {profile.data ? (
          <NetworkAddressForm networks={profile.data.networks} profile={profile.data.profile} askBusiness submitLabel="Save" />
        ) : null}
      </Card>

      <Card title="Tax and receipts">
        <p className="page-desc" style={{ marginBottom: 12 }}>
          {describeTax(settings.tax)} Buyers set their billing country and VAT ID at checkout and download a PDF receipt
          with your tax ID.
        </p>
        <SimpleCreateForm
          submitLabel="Save tax settings"
          successMessage="Tax settings saved. New checkouts use them."
          action={saveTax}
          fields={[
            { name: "enabled", label: "Charge tax at checkout", options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] },
            { name: "label", label: "Tax name", placeholder: "VAT" },
            { name: "sellerCountry", label: "Your country", placeholder: "DE" },
            { name: "taxId", label: "Your tax ID", placeholder: "DE123456789" },
            { name: "legalName", label: "Legal name on receipts", placeholder: "Acme Software GmbH" },
            { name: "rates", label: "Rates by buyer country", placeholder: "DE=19, FR=20", hint: "COUNTRY=percent, comma separated" },
            { name: "defaultRate", label: "Rate for other countries (%)", placeholder: "0" },
            {
              name: "reverseCharge",
              label: "EU reverse charge for businesses",
              options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }],
            },
          ]}
        />
      </Card>

      <Card title="Webhooks">
        <p className="page-desc" style={{ marginBottom: 12 }}>
          {hooks.data.length === 0
            ? "No endpoints yet. Add one to receive payment.confirmed and access events on your server."
            : `${hooks.data.length} endpoint${hooks.data.length === 1 ? "" : "s"}: ${hooks.data.map((h) => h.url).join(", ")}`}
        </p>
        <Link href="/webhooks" className="btn">
          Manage webhooks
        </Link>
      </Card>

      <Card title="API keys">
        <p className="page-desc" style={{ marginBottom: 12 }}>
          {keys.data.length === 0
            ? "No API keys yet. Create one to verify access from your app or create checkouts from your backend."
            : `${keys.data.length} key${keys.data.length === 1 ? "" : "s"}: ${keys.data.map((k) => k.name).join(", ")}`}
        </p>
        <Link href="/api-keys" className="btn">
          Manage API keys
        </Link>
      </Card>

      <Card title="Profile">
        {account ? (
          <EditProfile email={account.email} {...(account.displayName ? { displayName: account.displayName } : {})} />
        ) : (
          <p className="page-desc">Sign in to edit your profile.</p>
        )}
      </Card>
      <Card title="Sign-in wallet">
        <p className="page-desc" style={{ marginBottom: 12 }}>
          Link a wallet to sign in with Ethereum (SIWE) instead of a password. This is separate from your receiving
          addresses.
        </p>
        <LinkWallet {...(account?.walletAddress ? { linkedAddress: account.walletAddress } : {})} />
      </Card>
      <Card title="Security">
        <p className="page-desc" style={{ marginBottom: 12 }}>
          Active sessions for your account. Revoke any you don&apos;t recognize.
        </p>
        {account ? <SessionList /> : <p className="page-desc">Sign in to view sessions.</p>}
      </Card>
    </>
  );
}
