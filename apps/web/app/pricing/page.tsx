import type { Metadata } from "next";
import { FinalCTA, SimplePricing } from "@/components/Sections";
import { feeLabel } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing — SettleKit",
  description: `Free to start. ${feeLabel()} per successful payment. No monthly fee, no reserve, funds land in your own wallet.`,
};

export default function PricingPage() {
  return (
    <>
      <SimplePricing />
      <FinalCTA />
    </>
  );
}
