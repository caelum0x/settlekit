"use client";

import { useState } from "react";
import Link from "next/link";
import type { MerchantProduct, NetworkRow } from "@/lib/merchant-types";
import { ProductForm } from "./ProductForm";
import { ShareLink } from "./ShareLink";

/** Create a product, then show its checkout link + embed button in place. */
export function NewProduct({ networks }: { networks: NetworkRow[] }) {
  const [created, setCreated] = useState<MerchantProduct | null>(null);
  if (created?.slug) {
    return (
      <section className="card">
        <h2 className="card-title">{created.name} is live</h2>
        <ShareLink slug={created.slug} productName={created.name} priceUsd={created.priceUsd} />
        <div className="builder-actions">
          <button type="button" className="btn" onClick={() => setCreated(null)}>
            Create another
          </button>
          <Link href={`/products/${created.id}`} className="btn btn-primary">
            View product
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className="card">
      <ProductForm networks={networks} onSaved={setCreated} />
    </section>
  );
}
