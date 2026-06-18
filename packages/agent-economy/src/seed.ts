/**
 * A Lepton-themed citation graph: a small lineage of sub-cent priced works that
 * cite their ancestors, so paying to read a later work pays royalties back
 * through everything it was grounded in.
 */

import { isOk } from "@settlekit/common";
import { type Source, createSource } from "@settlekit/citation-toll";

const ORG = "org_lepton";

function make(input: Parameters<typeof createSource>[0]): Source {
  const result = createSource(input);
  if (!isOk(result)) {
    throw new Error(`seed source invalid: ${result.error.message}`);
  }
  return result.value;
}

/** Build the seed marketplace of citeable sources, with lineage. */
export function seedLeptonSources(): Source[] {
  const origins = make({
    organizationId: ORG,
    title: "Origins of the Lepton",
    authorWallet: "0x00000000000000000000000000000000000he510d",
    priceUsdc: "0.0006",
    summary: "A short history of the smallest coin of the Greek world.",
    body: "The lepton was a hundredth of a drachma — struck so ordinary people could pay for everyday things.",
  });

  const primer = make({
    organizationId: ORG,
    title: "Nanopayments Primer",
    authorWallet: "0x0000000000000000000000000000000000ar1st0",
    priceUsdc: "0.0008",
    summary: "Why a sub-cent payment finally clears, and what it unlocks.",
    body: "Value as small as $0.000001, gas paid in USDC, settled in under half a second on Arc.",
    cites: [{ sourceId: origins.id, shareBps: 3000 }],
  });

  const arc = make({
    organizationId: ORG,
    title: "Arc Settlement Explained",
    authorWallet: "0x0000000000000000000000000000000000c1rc1e",
    priceUsdc: "0.0009",
    summary: "Native USDC gas and sub-second finality on Arc.",
    body: "Arc is the stablecoin-native L1 where capital, humans, and machines coordinate.",
    cites: [{ sourceId: primer.id, shareBps: 2500 }],
  });

  const x402 = make({
    organizationId: ORG,
    title: "x402 Field Guide",
    authorWallet: "0x0000000000000000000000000000000000kdr0h4",
    priceUsdc: "0.0007",
    summary: "The HTTP 402 pay-per-request flow, end to end.",
    body: "Price any endpoint, article, or stream per request, settled on access.",
    cites: [
      { sourceId: primer.id, shareBps: 2000 },
      { sourceId: arc.id, shareBps: 2000 },
    ],
  });

  const agents = make({
    organizationId: ORG,
    title: "Agent Economics",
    authorWallet: "0x000000000000000000000000000000000c4nt33n",
    priceUsdc: "0.0008",
    summary: "How agents earn and spend per call, per byte, per second.",
    body: "Treat the sub-cent payment as a primitive and treat your agent as something that earns and spends.",
    cites: [
      { sourceId: x402.id, shareBps: 3000 },
      { sourceId: arc.id, shareBps: 1000 },
    ],
  });

  return [origins, primer, arc, x402, agents];
}
