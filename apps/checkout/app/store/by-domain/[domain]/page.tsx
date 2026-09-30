import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StorefrontView } from "@/components/StorefrontView";
import { getStorefront } from "@/lib/storefront";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { domain: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const store = await getStorefront({ domain: decodeURIComponent(params.domain) }).catch(() => null);
  if (!store) return { title: "Store not found" };
  const description = store.seoDescription ?? store.tagline ?? `Products from ${store.merchantName}, paid in USDC.`;
  return { title: store.title, description };
}

/** Storefront served on a merchant's custom domain (see middleware.ts). */
export default async function DomainStorePage({ params }: PageProps) {
  const store = await getStorefront({ domain: decodeURIComponent(params.domain) });
  if (!store) notFound();
  return <StorefrontView store={store} />;
}
