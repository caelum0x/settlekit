import Link from "next/link";
import { merchantApi } from "@/lib/merchant-api";
import { PageHeader, Card, ErrorBanner } from "@/components/ui";
import { NewProduct } from "@/components/NewProduct";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const profile = await merchantApi.profile();
  const accepted = (profile.data?.networks ?? []).filter((n) => n.accepted);
  return (
    <>
      <div className="breadcrumb">
        <Link href="/products">Products</Link> / New
      </div>
      <PageHeader title="New product" description="Name it, price it in USD, choose how access is delivered." />
      <ErrorBanner error={profile.error} />
      {accepted.length === 0 ? (
        <Card>
          <p className="muted" style={{ marginBottom: 12 }}>
            Add at least one network and receiving address first, so buyers have somewhere to pay.
          </p>
          <Link href="/onboarding" className="btn btn-primary">
            Set up payments
          </Link>
        </Card>
      ) : (
        <NewProduct networks={accepted} />
      )}
    </>
  );
}
