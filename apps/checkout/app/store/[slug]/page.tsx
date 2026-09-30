import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StorefrontView } from "@/components/StorefrontView";
import { getStorefront } from "@/lib/storefront";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const store = await getStorefront({ slug: params.slug }).catch(() => null);
  if (!store) return { title: "Store not found" };
  const description = store.seoDescription ?? store.tagline ?? `Products from ${store.merchantName}, paid in USDC.`;
  return {
    title: store.title,
    description,
    openGraph: { title: store.title, description, ...(store.logoUrl ? { images: [store.logoUrl] } : {}) },
  };
}

/** Hosted storefront: the merchant's branded product list. */
export default async function StorePage({ params }: PageProps) {
  const store = await getStorefront({ slug: params.slug });
  if (!store) notFound();
  return <StorefrontView store={store} />;
}
