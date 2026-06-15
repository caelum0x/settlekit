"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type {
  ChargeModel,
  DeliveryActionType,
  ProductSellType,
} from "@/lib/types";

interface Choice<T extends string> {
  value: T;
  title: string;
  desc: string;
}

// Step 1 — plan §28: "What do you want to sell?"
const SELL_TYPES: Choice<ProductSellType>[] = [
  { value: "saas_plan", title: "SaaS plan", desc: "Recurring software subscription" },
  { value: "github_repo", title: "Private GitHub repo", desc: "Invite buyers to a repository" },
  { value: "github_team", title: "GitHub organization/team", desc: "Add buyers to a team" },
  { value: "api_access", title: "API access", desc: "Sell access to your API" },
  { value: "paid_api_call", title: "Paid API call", desc: "Charge per request (x402)" },
  { value: "agent_service", title: "AI agent service", desc: "Machine-payable service" },
  { value: "digital_download", title: "Digital download", desc: "Files unlocked after payment" },
  { value: "code_template", title: "Code template", desc: "Starter kit / boilerplate" },
  { value: "license_key", title: "License key", desc: "Issue activatable keys" },
  { value: "discord_access", title: "Discord/community access", desc: "Assign a paid role" },
  { value: "support_plan", title: "Support plan", desc: "Paid support tier" },
  { value: "bundle", title: "Bundle", desc: "Combine multiple products" },
];

// Step 2 — plan §28: "How do you want to charge?"
const CHARGE_MODELS: Choice<ChargeModel>[] = [
  { value: "one_time", title: "One-time payment", desc: "Single charge" },
  { value: "monthly", title: "Monthly subscription", desc: "Billed every month" },
  { value: "yearly", title: "Yearly subscription", desc: "Billed every year" },
  { value: "prepaid_credits", title: "Prepaid credits", desc: "Buy credits upfront" },
  { value: "per_api_call", title: "Pay per API call", desc: "Metered usage" },
  { value: "custom_quote", title: "Custom quote", desc: "Sales-assisted pricing" },
];

// Step 3 — plan §28: "What should happen after payment?"
const DELIVERY_ACTIONS: Choice<DeliveryActionType>[] = [
  { value: "github_repo_invite", title: "Invite to GitHub repo", desc: "Auto repo invite" },
  { value: "github_team_add", title: "Add to GitHub team", desc: "Auto team membership" },
  { value: "issue_license_key", title: "Issue license key", desc: "Generate a key" },
  { value: "issue_api_key", title: "Issue API key", desc: "Provision an API key" },
  { value: "grant_saas_entitlement", title: "Grant SaaS access", desc: "Unlock features" },
  { value: "unlock_file", title: "Unlock file download", desc: "Release the asset" },
  { value: "assign_discord_role", title: "Assign Discord role", desc: "Grant a role" },
  { value: "send_webhook", title: "Send webhook", desc: "Notify your app" },
  { value: "send_email", title: "Send email instructions", desc: "Email the buyer" },
];

function Step<T extends string>({
  label,
  question,
  choices,
  selected,
  onSelect,
}: {
  label: string;
  question: string;
  choices: Choice<T>[];
  selected: T | null;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="card">
      <div className="step-label">{label}</div>
      <h2 className="card-title">{question}</h2>
      <div className="choice-grid">
        {choices.map((c) => (
          <button
            type="button"
            key={c.value}
            className={selected === c.value ? "choice selected" : "choice"}
            onClick={() => onSelect(c.value)}
          >
            <div className="choice-title">{c.title}</div>
            <div className="choice-desc">{c.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProductBuilder() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sellType, setSellType] = useState<ProductSellType | null>(null);
  const [chargeModel, setChargeModel] = useState<ChargeModel | null>(null);
  const [delivery, setDelivery] = useState<DeliveryActionType | null>(null);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USDC");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const ready = name.trim() && sellType && chargeModel && delivery;

  async function submit() {
    if (!ready || !sellType || !chargeModel || !delivery) return;
    setPending(true);
    setMessage(null);
    const decimals = currency.toUpperCase() === "USDC" ? 6 : 2;
    const amount = Math.round((parseFloat(price || "0") || 0) * 10 ** decimals);
    const { data, error } = await api.products.create({
      name: name.trim(),
      sellType,
      chargeModel,
      priceAmount: amount,
      priceCurrency: currency,
      deliveryAction: delivery,
    });
    setPending(false);
    if (error) {
      setMessage({ ok: false, text: error });
      return;
    }
    setMessage({ ok: true, text: "Product created." });
    if (data?.id) {
      router.push(`/products/${data.id}`);
    } else {
      router.push("/products");
      router.refresh();
    }
  }

  return (
    <div className="form" style={{ maxWidth: "100%" }}>
      <div className="card">
        <div className="field">
          <label htmlFor="product-name">Product name</label>
          <input
            id="product-name"
            className="input"
            placeholder="e.g. Pro Plan, Private Toolkit Repo, GPT Research Agent"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      <Step
        label="Step 1"
        question="What do you want to sell?"
        choices={SELL_TYPES}
        selected={sellType}
        onSelect={setSellType}
      />

      <Step
        label="Step 2"
        question="How do you want to charge?"
        choices={CHARGE_MODELS}
        selected={chargeModel}
        onSelect={setChargeModel}
      />

      <Step
        label="Step 3"
        question="What should happen after payment?"
        choices={DELIVERY_ACTIONS}
        selected={delivery}
        onSelect={setDelivery}
      />

      <div className="card">
        <h2 className="card-title">Price</h2>
        <div className="form-row">
          <div className="field">
            <label htmlFor="price">Amount</label>
            <input
              id="price"
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <select
              id="currency"
              className="select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="USDC">USDC</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>
        {message ? (
          <div
            className={`form-message ${message.ok ? "ok" : "err"}`}
            style={{ marginTop: 14 }}
          >
            {message.text}
          </div>
        ) : null}
        <div className="builder-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || pending}
            onClick={submit}
          >
            {pending ? "Creating…" : "Create product"}
          </button>
        </div>
      </div>
    </div>
  );
}
