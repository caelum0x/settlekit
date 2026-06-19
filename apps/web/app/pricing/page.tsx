import type { Metadata } from "next";
import { PricingTable } from "@/components/PricingTable";
import { CTA } from "@/components/CTA";

export const metadata: Metadata = {
  title: "Pricing — SettleKit",
  description:
    "Simple plans for every kind of seller. Free, Creator, Pro, Business, and Enterprise — with transaction fees that drop as you grow.",
};

export default function PricingPage() {
  return (
    <>
      <section className="section page-hero">
        <div className="container">
          <div className="ref">
            <span className="ref-no">§ 00</span>
            <span>Rate schedule</span>
            <span className="ref-fill" aria-hidden="true" />
          </div>
          <div className="section-head">
            <h1 className="section-title">Plans that grow as you sell</h1>
            <p className="section-desc">
              Start free, upgrade when you need SaaS billing, paid APIs, or team
              seats. Every plan settles in USDC, and your transaction fee drops
              as you move up.
            </p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <PricingTable />
        </div>
      </section>

      <CTA
        title="Pick a plan and start selling today"
        description="No card required to start on Free. Connect GitHub, create a product, and share your first checkout link in minutes."
      />
    </>
  );
}
