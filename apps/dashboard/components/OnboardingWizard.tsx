"use client";

import { useState } from "react";
import Link from "next/link";
import type { MerchantProduct, MerchantProfile, NetworkRow } from "@/lib/merchant-types";
import { NetworkAddressForm } from "./NetworkAddressForm";
import { ProductForm } from "./ProductForm";
import { ShareLink } from "./ShareLink";

interface OnboardingWizardProps {
  networks: NetworkRow[];
  profile: MerchantProfile | null;
  existingProduct: MerchantProduct | null;
}

type Step = 1 | 2 | 3;

const STEPS: { step: Step; title: string }[] = [
  { step: 1, title: "Where you get paid" },
  { step: 2, title: "Your first product" },
  { step: 3, title: "Share your link" },
];

/**
 * Guided setup: networks + receiving addresses, then the first product, then
 * the shareable checkout link and embed button. Each step saves as it goes,
 * so a seller can leave and come back.
 */
export function OnboardingWizard({ networks, profile, existingProduct }: OnboardingWizardProps) {
  const start: Step = profile?.onboarded ? (existingProduct ? 3 : 2) : 1;
  const [step, setStep] = useState<Step>(start);
  const [accepted, setAccepted] = useState<NetworkRow[]>(
    networks.filter((n) => profile?.acceptedNetworks.includes(n.network)),
  );
  const [product, setProduct] = useState<MerchantProduct | null>(existingProduct);

  return (
    <div className="wizard">
      <ol className="wizard-steps">
        {STEPS.map((s) => (
          <li key={s.step} className={s.step === step ? "current" : s.step < step ? "done" : ""}>
            <span className="wizard-num">{s.step}</span>
            {s.title}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="card">
          <h2 className="card-title">Where you get paid</h2>
          <p className="page-desc" style={{ marginBottom: 16 }}>
            Buyers pay straight into your own wallets. SettleKit never holds your money.
          </p>
          <NetworkAddressForm
            networks={networks}
            profile={profile}
            askBusiness
            submitLabel="Save and continue"
            onSaved={(result) => {
              setAccepted(result.networks.filter((n) => n.accepted));
              setStep(2);
            }}
          />
        </section>
      ) : null}

      {step === 2 ? (
        <section className="card">
          <h2 className="card-title">Your first product</h2>
          <p className="page-desc" style={{ marginBottom: 16 }}>
            Set a price in USD and choose how buyers get access. Delivery runs automatically after the payment is
            verified on-chain.
          </p>
          <ProductForm
            networks={accepted}
            submitLabel="Create product and get my link"
            onSaved={(created) => {
              setProduct(created);
              setStep(3);
            }}
          />
          <div className="builder-actions" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              Back to networks
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 && product?.slug ? (
        <section className="card">
          <h2 className="card-title">You are ready to get paid</h2>
          <p className="page-desc" style={{ marginBottom: 16 }}>
            Share this link anywhere. Buyers can pay with stablecoins on any network you accept, or any token routed
            into your stablecoin, and access to <strong>{product.name}</strong> is delivered automatically.
          </p>
          <ShareLink slug={product.slug} productName={product.name} priceUsd={product.priceUsd} />
          <div className="builder-actions">
            <Link href="/products" className="btn">
              Add more products
            </Link>
            <Link href="/" className="btn btn-primary">
              Go to dashboard
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
