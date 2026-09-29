import { merchantApi } from "@/lib/merchant-api";
import { PageHeader, ErrorBanner } from "@/components/ui";
import { OnboardingWizard } from "@/components/OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const [profile, products] = await Promise.all([merchantApi.profile(), merchantApi.products()]);
  const networks = profile.data?.networks ?? [];
  const existing = (products.data ?? []).find((p) => p.status === "active" && p.slug) ?? null;
  return (
    <>
      <PageHeader
        title="Get paid in stablecoins"
        description="Three steps: choose your networks, create a product, share your link."
      />
      <ErrorBanner error={profile.error} />
      {networks.length > 0 ? (
        <OnboardingWizard networks={networks} profile={profile.data?.profile ?? null} existingProduct={existing} />
      ) : null}
    </>
  );
}
