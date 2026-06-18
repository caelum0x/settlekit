# @settlekit/citation-toll

Per-access content monetization with recursive royalty splits (Lepton RFB 6 & 3).

A `Source` is a citeable, per-access-priced piece of work that can cite ancestor sources with a revenue share. Accessing a work pays a toll; after the platform fee, the remainder flows recursively back through the citation lineage — a remix of a remix pays every ancestor, and a shared ancestor (a diamond in the graph) is paid from each path. Money is conserved exactly: integer-division remainders stay with the author of the node they arise in.

- **`createSource(input)`** — validated source creation (rejects zero price, citation shares > 100%).
- **`computeRoyaltyDistribution(registry, sourceId, schedule?)`** — the recursive split; cycle-safe, conserves money. Defaults to a nanopayment fee schedule (2.5%, no fixed component — a fixed per-call fee would swallow a sub-cent toll).
- **`createCitationTollRouter(registry, { verify, distributor })`** — x402-gated Fetch handlers serving `GET /articles/:id`; on each paid access it computes the split and hands it to your `distributor` (wire to a settler/ledger or `@settlekit/payouts`).
- **`toAgentServiceListing(source, { baseUrl })`** — project a source into an `AgentService` so autonomous agents discover and pay it.

```ts
const dist = computeRoyaltyDistribution(registry, sourceId);
// dist.gross, dist.platformFee, dist.distributable, dist.legs (sums to distributable)
```
