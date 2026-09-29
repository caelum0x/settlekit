"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProductAction } from "@/lib/merchant-actions";
import type { DeliveryInput, MerchantProduct, NetworkRow } from "@/lib/merchant-types";

function currentDelivery(p: MerchantProduct): DeliveryInput | null {
  const d = p.delivery;
  switch (p.deliveryKind) {
    case "github_repo":
      return { kind: "github_repo", repo: String(d.repoId ?? "") };
    case "license_key":
      return { kind: "license_key", machineLimit: typeof d.machineLimit === "number" ? d.machineLimit : 3 };
    case "file":
      return { kind: "file", fileUrl: String(d.fileUrl ?? "") };
    case "discord_role":
      return { kind: "discord_role", guildId: String(d.guildId ?? ""), roleId: String(d.roleId ?? "") };
    case "access":
      return { kind: "access", ...(typeof d.accessUrl === "string" ? { accessUrl: d.accessUrl } : {}) };
    default:
      return null;
  }
}

/** Pause (archive) or re-open a product's checkout link. */
export function ProductStatusToggle({ product }: { product: MerchantProduct; networks: NetworkRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = product.status === "active";
  const delivery = currentDelivery(product);

  async function toggle(): Promise<void> {
    if (!delivery) {
      setError("Edit this product's delivery above first.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await updateProductAction(product.id, {
      name: product.name,
      description: product.description,
      priceUsd: product.priceUsd ?? "",
      interval: product.interval ?? "one_time",
      delivery,
      acceptedNetworks: product.acceptedNetworks,
      status: active ? "archived" : "active",
    });
    setPending(false);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {active
          ? "The checkout link is live. Pausing stops new checkouts; existing buyers keep their access."
          : "The checkout link is paused. Buyers who open it see that it is not active."}
      </p>
      {error ? <div className="form-message err">{error}</div> : null}
      <button type="button" className="btn" onClick={toggle} disabled={pending}>
        {pending ? "Saving..." : active ? "Pause checkout link" : "Re-open checkout link"}
      </button>
    </div>
  );
}
