import { ProductBuilder } from "@/components/ProductBuilder";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function NewProductPage() {
  return (
    <>
      <div className="breadcrumb">
        <a href="/products">Products</a> / New
      </div>
      <PageHeader
        title="Product Builder"
        description="Choose what to sell, how to charge, and what happens after payment — SettleKit wires the access delivery automatically."
      />
      <ProductBuilder />
    </>
  );
}
