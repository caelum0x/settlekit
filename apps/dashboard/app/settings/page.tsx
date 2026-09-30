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
import { CHECKOUT_URL } from "@/lib/config";

async function saveStore(values: Record<string, string>): Promise<string | null> {
  "use server";
  const opt = (k: string) => (values[k] ?? "").trim();
  const { error } = await api.settings.update({
    store: {
      enabled: values.enabled !== "no",
      slug: opt("slug").toLowerCase(),
      ...(opt("title") ? { title: opt("title") } : {}),
      ...(opt("tagline") ? { tagline: opt("tagline") } : {}),
      ...(opt("logoUrl") ? { logoUrl: opt("logoUrl") } : {}),
      ...(opt("accentColor") ? { accentColor: opt("accentColor") } : {}),
      ...(opt("seoDescription") ? { seoDescription: opt("seoDescription") } : {}),
      ...(opt("customDomain") ? { customDomain: opt("customDomain").toLowerCase() } : {}),
    },
  });
  return error;
}

async function saveEmbedOrigins(values: Record<string, string>): Promise<string | null> {
  "use server";
  const embedOrigins = (values.origins ?? "")
    .split(/[\s,]+/)
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const { error } = await api.settings.update({ embedOrigins });
  return error;
}

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

      <Card title="Storefront">
        <p className="page-desc" style={{ marginBottom: 12 }}>
          {settings.store?.enabled ? (
            <>
              Your store is live at{" "}
              <a className="link" href={`${CHECKOUT_URL}/store/${settings.store.slug}`} target="_blank" rel="noreferrer">
                {`${CHECKOUT_URL}/store/${settings.store.slug}`}
              </a>
              {settings.store.customDomain ? ` and ${settings.store.customDomain}` : ""}.
            </>
          ) : (
            "A branded page listing all your products, for buyers who do not have a site of yours to start from."
          )}
        </p>
        <SimpleCreateForm
          submitLabel="Save storefront"
          successMessage="Storefront saved."
          action={saveStore}
          fields={[
            { name: "enabled", label: "Show the store", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
            { name: "slug", label: "Store address", required: true, placeholder: "pixel-tools", hint: "3-40 lowercase letters, digits or dashes" },
            { name: "title", label: "Title", placeholder: "Pixel Tools" },
            { name: "tagline", label: "Tagline", placeholder: "Icons and UI kits" },
            { name: "logoUrl", label: "Logo URL (https)", type: "url", placeholder: "https://..." },
            { name: "accentColor", label: "Accent colour", placeholder: "#1e40a2" },
            { name: "seoDescription", label: "Search description", type: "textarea" },
            {
              name: "customDomain",
              label: "Custom domain (optional)",
              placeholder: "shop.yourdomain.com",
              hint: "Point a CNAME at the checkout host; the host must route the domain.",
            },
          ]}
        />
      </Card>

      <Card title="Embedding">
        <p className="page-desc" style={{ marginBottom: 12 }}>
          {settings.embedOrigins && settings.embedOrigins.length > 0
            ? `Sites that can embed your checkout and receive the success event: ${settings.embedOrigins.join(", ")}.`
            : "No sites yet. Your checkout still opens in an overlay anywhere; listed sites also receive the success event."}
        </p>
        <SimpleCreateForm
          submitLabel="Save sites"
          successMessage="Embedding sites saved."
          action={saveEmbedOrigins}
          fields={[
            {
              name: "origins",
              label: "Your sites",
              type: "textarea",
              placeholder: "https://shop.example.com",
              hint: "One per line, https only, no paths. Saving replaces the list.",
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
