"use client";

import { useState } from "react";
import { createProductAction, updateProductAction, type ProductFormInput } from "@/lib/merchant-actions";
import {
  DELIVERY_OPTIONS,
  type DeliveryInput,
  type DeliveryKind,
  type MerchantProduct,
  type Network,
  type NetworkRow,
} from "@/lib/merchant-types";
import { NetworkBadge } from "./NetworkBadge";
import { discordBotInviteUrl } from "@/lib/config";

interface ProductFormProps {
  /** The merchant's accepted networks (per-product toggles choose a subset). */
  networks: NetworkRow[];
  product?: MerchantProduct;
  submitLabel?: string;
  onSaved?: (product: MerchantProduct) => void;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function initialKind(product?: MerchantProduct): DeliveryKind {
  return product && product.deliveryKind !== "other" ? product.deliveryKind : "github_repo";
}

/**
 * Create or edit a product: name, USD price, how access is delivered, and
 * which of your networks this product accepts. Creating publishes the
 * product and gives it a reusable payment link.
 */
export function ProductForm({ networks, product, submitLabel, onSaved }: ProductFormProps) {
  const d = product?.delivery ?? {};
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [priceUsd, setPriceUsd] = useState(product?.priceUsd ?? "");
  const [interval, setInterval] = useState<ProductFormInput["interval"]>(product?.interval ?? "one_time");
  const [kind, setKind] = useState<DeliveryKind>(initialKind(product));
  const [repo, setRepo] = useState(str(d.repoId));
  const [machineLimit, setMachineLimit] = useState(typeof d.machineLimit === "number" ? String(d.machineLimit) : "3");
  const [fileUrl, setFileUrl] = useState(str(d.fileUrl));
  const [guildId, setGuildId] = useState(str(d.guildId));
  const [roleId, setRoleId] = useState(str(d.roleId));
  const [accessUrl, setAccessUrl] = useState(str(d.accessUrl));
  const [allNetworks, setAllNetworks] = useState(product?.acceptedNetworks == null);
  const [picked, setPicked] = useState<Set<Network>>(
    new Set(product?.acceptedNetworks ?? networks.map((n) => n.network)),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  function delivery(): DeliveryInput {
    switch (kind) {
      case "github_repo":
        return { kind, repo: repo.trim() };
      case "license_key":
        return { kind, machineLimit: Math.max(1, Number(machineLimit) || 1) };
      case "file":
        return { kind, fileUrl: fileUrl.trim() };
      case "discord_role":
        return { kind, guildId: guildId.trim(), roleId: roleId.trim() };
      case "access":
        return { kind, ...(accessUrl.trim() ? { accessUrl: accessUrl.trim() } : {}) };
    }
  }

  function togglePicked(network: Network): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(network)) next.delete(network);
      else next.add(network);
      return next;
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    setSaved(false);
    const input: ProductFormInput = {
      name: name.trim(),
      description: description.trim(),
      priceUsd: priceUsd.trim().replace(/^\$/, ""),
      interval,
      delivery: delivery(),
      acceptedNetworks: allNetworks ? null : networks.map((n) => n.network).filter((n) => picked.has(n)),
    };
    const result = product ? await updateProductAction(product.id, input) : await createProductAction(input);
    setPending(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not save the product.");
      setFields(result.fields ?? {});
      return;
    }
    setSaved(true);
    onSaved?.(result.data);
  }

  const fieldError = (key: string) =>
    Object.entries(fields).find(([k]) => k === key || k.startsWith(`${key}.`) || k.endsWith(`.${key}`))?.[1];

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="p-name">Product name</label>
          <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pro templates" required />
        </div>
        <div className="field">
          <label htmlFor="p-price">Price (USD)</label>
          <input
            id="p-price"
            className={`input${fieldError("priceUsd") ? " input-error" : ""}`}
            value={priceUsd}
            onChange={(e) => setPriceUsd(e.target.value)}
            placeholder="29"
            inputMode="decimal"
            required
          />
          <span className={fieldError("priceUsd") ? "field-error" : "field-hint"}>
            {fieldError("priceUsd") ?? "Buyers pay the same amount in the stablecoin of the network they choose."}
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="p-desc">Description (optional)</label>
        <textarea id="p-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>

      {!product ? (
        <div className="field">
          <label htmlFor="p-interval">Billing</label>
          <select id="p-interval" className="select" value={interval} onChange={(e) => setInterval(e.target.value as ProductFormInput["interval"])}>
            <option value="one_time">One-time payment</option>
            <option value="monthly">Monthly access (renewal invoice each month)</option>
            <option value="yearly">Yearly access (renewal invoice each year)</option>
          </select>
        </div>
      ) : null}

      <div className="field">
        <label>How the buyer gets access</label>
        <div className="choice-grid">
          {DELIVERY_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.kind}
              className={`choice${kind === opt.kind ? " selected" : ""}`}
              onClick={() => setKind(opt.kind)}
            >
              <div className="choice-title">{opt.title}</div>
              <div className="choice-desc">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {kind === "github_repo" ? (
        <div className="field">
          <label htmlFor="p-repo">Private repository</label>
          <input id="p-repo" className="input mono" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="your-org/your-repo" required />
          <span className={fieldError("repo") ? "field-error" : "field-hint"}>
            {fieldError("repo") ?? "Buyers enter their GitHub username at checkout and get a collaborator invite. Requires the SettleKit GitHub App on this repo."}
          </span>
        </div>
      ) : null}
      {kind === "license_key" ? (
        <div className="field">
          <label htmlFor="p-machines">Activations per key</label>
          <input id="p-machines" className="input" value={machineLimit} onChange={(e) => setMachineLimit(e.target.value)} inputMode="numeric" />
          <span className="field-hint">Verify keys from your app with the license-keys API.</span>
        </div>
      ) : null}
      {kind === "file" ? (
        <div className="field">
          <label htmlFor="p-file">Download link</label>
          <input id="p-file" className="input mono" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://..." required />
          <span className={fieldError("fileUrl") ? "field-error" : "field-hint"}>
            {fieldError("fileUrl") ?? "Shown to the buyer only after the payment is verified."}
          </span>
        </div>
      ) : null}
      {kind === "discord_role" ? (
        <>
          <div className="form-row">
            <div className="field">
              <label htmlFor="p-guild">Server ID</label>
              <input id="p-guild" className="input mono" value={guildId} onChange={(e) => setGuildId(e.target.value)} inputMode="numeric" placeholder="123456789012345678" required />
              <span className={fieldError("delivery.guildId") ? "field-error" : "field-hint"}>
                {fieldError("delivery.guildId") ?? "Discord: Server Settings > Widget, or right-click the server > Copy Server ID."}
              </span>
            </div>
            <div className="field">
              <label htmlFor="p-role">Role ID</label>
              <input id="p-role" className="input mono" value={roleId} onChange={(e) => setRoleId(e.target.value)} inputMode="numeric" placeholder="123456789012345678" required />
              <span className={fieldError("delivery.roleId") ? "field-error" : "field-hint"}>
                {fieldError("delivery.roleId") ?? "Server Settings > Roles > right-click the paid role > Copy Role ID."}
              </span>
            </div>
          </div>
          <p className="field-hint">
            Buyers connect their Discord account at checkout and the SettleKit bot adds this role after payment.{" "}
            {discordBotInviteUrl(guildId.trim()) ? (
              <>
                <a className="link" href={discordBotInviteUrl(guildId.trim()) ?? "#"} target="_blank" rel="noreferrer">
                  Add the SettleKit bot to your server
                </a>{" "}
                and drag its role above the paid role.
              </>
            ) : (
              <>Discord delivery shows &quot;pending setup&quot; to buyers until the platform bot is configured; roles are granted automatically once it is.</>
            )}
          </p>
        </>
      ) : null}
      {kind === "access" ? (
        <div className="field">
          <label htmlFor="p-access">Where buyers go after paying (optional)</label>
          <input id="p-access" className="input mono" value={accessUrl} onChange={(e) => setAccessUrl(e.target.value)} placeholder="https://app.yourproduct.com/login" />
          <span className="field-hint">Your app checks access with the entitlements API using the buyer&apos;s email.</span>
        </div>
      ) : null}

      <div className="field">
        <label>Networks for this product</label>
        <label className="checkbox-row">
          <input type="checkbox" checked={allNetworks} onChange={(e) => setAllNetworks(e.target.checked)} />
          <span>Accept every network I accept</span>
        </label>
        {!allNetworks ? (
          <div className="toggle-list">
            {networks.map((n) => (
              <label key={n.network} className="checkbox-row">
                <input type="checkbox" checked={picked.has(n.network)} onChange={() => togglePicked(n.network)} />
                <span>
                  {n.name} ({n.asset}) <NetworkBadge env={n.env} />
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <div className="form-message err">{error}</div> : null}
      {saved && product ? <div className="form-message ok">Saved.</div> : null}

      <div className="builder-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving..." : submitLabel ?? (product ? "Save changes" : "Create product")}
        </button>
      </div>
    </form>
  );
}
