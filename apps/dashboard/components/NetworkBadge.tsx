// Small, server-friendly labels for networks and payment sources.
import type { PaymentSource } from "@/lib/merchant-types";
import { SOURCE_LABEL } from "@/lib/merchant-types";

/** Honest mainnet / testnet label. Mainnet renders nothing (the default). */
export function NetworkBadge({ env }: { env: "mainnet" | "testnet" }) {
  if (env === "mainnet") return null;
  return <span className="badge badge-warn">testnet</span>;
}

/** Network + asset chip, e.g. "Base · USDC". */
export function NetworkChip({ name, asset, env }: { name: string; asset: string; env: "mainnet" | "testnet" }) {
  return (
    <span className="network-chip">
      <span className="network-chip-name">{name}</span>
      <span className="network-chip-asset">{asset}</span>
      <NetworkBadge env={env} />
    </span>
  );
}

export function SourceTag({ source }: { source: PaymentSource }) {
  return <span className={`tag${source.startsWith("agent") ? " tag-agent" : ""}`}>{SOURCE_LABEL[source]}</span>;
}
