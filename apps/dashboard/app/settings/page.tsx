import Link from "next/link";
import { api } from "@/lib/api";
import { merchantApi } from "@/lib/merchant-api";
import { PageHeader, Card, ErrorBanner } from "@/components/ui";
import { LinkWallet } from "@/components/LinkWallet";
import { EditProfile } from "@/components/EditProfile";
import { SessionList } from "@/components/SessionList";
import { NetworkAddressForm } from "@/components/NetworkAddressForm";
import { getCurrentAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [profile, hooks, keys, account] = await Promise.all([
    merchantApi.profile(),
    api.webhooks.list(),
    api.apiKeys.list(),
    getCurrentAccount(),
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
