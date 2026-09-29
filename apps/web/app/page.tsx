import { Hero } from "@/components/Hero";
import { AgentPayments, ChainGrid, FinalCTA, FounderStory, HowItWorks, SimplePricing } from "@/components/Sections";

export default function HomePage() {
  return (
    <>
      <Hero />
      <FounderStory />
      <ChainGrid />
      <HowItWorks />
      <AgentPayments />
      <SimplePricing />
      <FinalCTA />
    </>
  );
}
