import { Hero } from "@/components/Hero";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Steps } from "@/components/Steps";
import { MarketplaceTeaser } from "@/components/MarketplaceTeaser";
import { CTA } from "@/components/CTA";
import { developerTools, sellableItems } from "@/lib/content";
import { links } from "@/lib/links";

export default function HomePage() {
  return (
    <>
      <Hero />

      <FeatureGrid
        eyebrow="What you can sell"
        title="One platform for every kind of software sale"
        description="Repos, subscriptions, APIs, downloads, license keys, and community access — all sold in USDC with access delivered automatically."
        items={sellableItems}
      />

      <Steps />

      <FeatureGrid
        eyebrow="Developer tools"
        title="Built for developers, not just checkout"
        description="SettleKit ships the primitives you'd otherwise build yourself: SDKs, webhooks, entitlement checks, and pay-per-call API middleware."
        items={developerTools}
      />

      <MarketplaceTeaser />

      <CTA
        title="Ready to sell your software in USDC?"
        description="Connect GitHub, create your first product, and share a checkout link in minutes. Self-host the open-source core or use the hosted cloud."
        primaryLabel="Open the dashboard"
        primaryHref={links.dashboard}
        secondaryLabel="Read the docs"
        secondaryHref={links.docs}
      />
    </>
  );
}
