"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { PaymentNetwork } from "@settlekit/common";

import { ApiClientError, selectCheckoutNetwork } from "@/lib/api";
import { badgeDescription, badgeText } from "@/lib/format";
import type { NetworkOption } from "@/lib/network-options";
import { groupNetworkOptions } from "@/lib/pay-display";

interface NetworkPickerProps {
  sessionId: string;
  current: PaymentNetwork;
  /** Accepted networks this checkout can take payment on (server-filtered). */
  options: NetworkOption[];
}

/**
 * Choose where to pay. Only networks the merchant accepted AND this checkout
 * can verify are listed, grouped Solana / EVM chains / Zcash, each with its
 * settlement asset and honest badges (testnet, bridged, transparent).
 * Native radio inputs keep it keyboard and screen-reader friendly.
 */
export function NetworkPicker({ sessionId, current, options }: NetworkPickerProps) {
  const router = useRouter();
  const [pending, setPending] = useState<PaymentNetwork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groups = groupNetworkOptions(options);

  const choose = useCallback(
    async (network: PaymentNetwork) => {
      if (network === current || pending !== null) return;
      setError(null);
      setPending(network);
      try {
        await selectCheckoutNetwork(sessionId, network);
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Could not switch the payment network.");
      } finally {
        setPending(null);
      }
    },
    [current, pending, sessionId, router],
  );

  // Hide only when there is nothing to switch to.
  if (options.length === 0 || (options.length === 1 && options[0]?.network === current)) return null;

  return (
    <fieldset className="network-picker" aria-busy={pending !== null}>
      <legend className="label">Pay with</legend>
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {groups.map((group) => (
        <div className="network-group" key={group.id} role="group" aria-labelledby={`network-group-${group.id}`}>
          <div className="network-group-label muted" id={`network-group-${group.id}`}>
            {group.label}
          </div>
          <div className="network-options">
            {group.options.map((option) => {
              const id = `network-${option.network}`;
              const checked = (pending ?? current) === option.network;
              return (
                <label key={option.network} htmlFor={id} className={`network-option${checked ? " network-option-active" : ""}`}>
                  <input
                    id={id}
                    type="radio"
                    name="payment-network"
                    value={option.network}
                    checked={checked}
                    disabled={pending !== null}
                    onChange={() => void choose(option.network)}
                  />
                  <span className="network-name">{option.name}</span>
                  <span className="network-asset mono">{option.asset}</span>
                  {option.badges.map((badge) => (
                    <span key={badge} className={`badge badge-${badge}`} title={badgeDescription(badge)}>
                      {badgeText(badge)}
                    </span>
                  ))}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {pending !== null ? (
        <div className="muted network-switching" role="status">
          Switching network…
        </div>
      ) : null}
    </fieldset>
  );
}
