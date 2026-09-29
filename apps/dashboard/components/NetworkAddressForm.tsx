"use client";

import { useMemo, useState } from "react";
import { saveProfileAction } from "@/lib/merchant-actions";
import {
  GROUP_LABELS,
  addressHint,
  type AddressGroup,
  type MerchantAddresses,
  type MerchantProfile,
  type Network,
  type NetworkRow,
  type ProfileResponse,
} from "@/lib/merchant-types";
import { NetworkBadge } from "./NetworkBadge";

interface NetworkAddressFormProps {
  networks: NetworkRow[];
  profile: MerchantProfile | null;
  submitLabel?: string;
  /** Show the business name + support email fields (onboarding). */
  askBusiness?: boolean;
  onSaved?: (result: ProfileResponse) => void;
}

const GROUP_ORDER: AddressGroup[] = ["evm", "solana", "hypercore", "zcash"];

/**
 * Choose the networks you accept and paste one receiving address per address
 * group. One EVM address covers every EVM chain. Format hints show instantly;
 * the API validates each address for its chain (checksum, base58, Zcash
 * network) before anything is saved.
 */
export function NetworkAddressForm({
  networks,
  profile,
  submitLabel = "Save",
  askBusiness = false,
  onSaved,
}: NetworkAddressFormProps) {
  const initialAccepted =
    profile && profile.acceptedNetworks.length > 0
      ? profile.acceptedNetworks
      : networks.filter((n) => n.enabled).map((n) => n.network);
  const [accepted, setAccepted] = useState<Set<Network>>(new Set(initialAccepted));
  const [addresses, setAddresses] = useState<MerchantAddresses>(profile?.addresses ?? {});
  const [orgName, setOrgName] = useState(profile?.orgName && profile.orgName !== "SettleKit Merchant" ? profile.orgName : "");
  const [supportEmail, setSupportEmail] = useState(profile?.supportEmail ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const neededGroups = useMemo(() => {
    const groups = new Set<AddressGroup>();
    for (const n of networks) if (accepted.has(n.network)) groups.add(n.addressGroup);
    return GROUP_ORDER.filter((g) => groups.has(g));
  }, [accepted, networks]);

  function toggle(network: Network): void {
    setSaved(false);
    setAccepted((prev) => {
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
    setFieldErrors({});
    setSaved(false);
    const result = await saveProfileAction({
      ...(askBusiness ? { orgName, supportEmail } : {}),
      acceptedNetworks: networks.map((n) => n.network).filter((n) => accepted.has(n)),
      addresses,
    });
    setPending(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not save.");
      setFieldErrors(result.fields ?? {});
      return;
    }
    setSaved(true);
    onSaved?.(result.data);
  }

  return (
    <form className="form" onSubmit={submit}>
      {askBusiness ? (
        <div className="form-row">
          <div className="field">
            <label htmlFor="orgName">Business name</label>
            <input
              id="orgName"
              className="input"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Shown to buyers on checkout"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="supportEmail">Support email</label>
            <input
              id="supportEmail"
              type="email"
              className="input"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@yourcompany.com"
            />
          </div>
        </div>
      ) : null}

      <div className="field">
        <label>Networks you accept</label>
        <div className="network-grid">
          {networks.map((n) => (
            <label key={n.network} className={`network-choice${accepted.has(n.network) ? " selected" : ""}`}>
              <input type="checkbox" checked={accepted.has(n.network)} onChange={() => toggle(n.network)} />
              <span className="network-choice-body">
                <span className="network-choice-title">
                  {n.name} <NetworkBadge env={n.env} />
                </span>
                <span className="network-choice-desc">
                  Receive {n.asset}
                  {n.note ? ` · ${n.note}` : ""}
                </span>
                {!n.enabled ? (
                  <span className="network-choice-warn">Not verified on this deployment yet; buyers cannot pick it.</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </div>

      {neededGroups.map((group) => {
        const hint = addressHint(group, addresses[group] ?? "");
        const serverError = fieldErrors[group];
        return (
          <div className="field" key={group}>
            <label htmlFor={`addr-${group}`}>{GROUP_LABELS[group].title}</label>
            <input
              id={`addr-${group}`}
              className={`input mono${serverError || hint ? " input-error" : ""}`}
              value={addresses[group] ?? ""}
              onChange={(e) => {
                setSaved(false);
                setAddresses((prev) => ({ ...prev, [group]: e.target.value }));
              }}
              placeholder={GROUP_LABELS[group].placeholder}
              spellCheck={false}
              autoComplete="off"
              required={group !== "hypercore"}
            />
            <span className={serverError || hint ? "field-error" : "field-hint"}>
              {serverError ?? hint ?? GROUP_LABELS[group].help}
            </span>
          </div>
        );
      })}

      {error ? <div className="form-message err">{error}</div> : null}
      {saved && !onSaved ? <div className="form-message ok">Saved. New checkouts use these addresses.</div> : null}

      <div className="builder-actions">
        <button type="submit" className="btn btn-primary" disabled={pending || accepted.size === 0}>
          {pending ? "Checking addresses..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
