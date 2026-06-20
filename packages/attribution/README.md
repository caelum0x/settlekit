# @settlekit/attribution

Reuse-detection, weighted provenance lineage, and signed proofs-of-citation (Lepton RFB 6.01).

The citation toll (`@settlekit/citation-toll`) charges an agent that *explicitly* fetches a gated source. Attribution closes the other half of the loop — charging for *implicit* reuse, fanning a payment recursively through every ancestor, and proving after the fact that an agent cited and paid. Everything here is pure: no I/O, no clocks except the ones you pass in.

## What's in it

- **Reuse detection** — `detectReuse(text, candidates, options?)` returns a `ReuseReport`: a containment-scored, shingle-based match of generated text against candidate sources, so a toll can be charged for grounding the agent never declared. Tunables: `shingleSize` (default 4), `threshold` (default 0.18), `minMatched` (default 2). Helpers: `tokenize`, `shingleSet`, `textFingerprint`.
- **Provenance lineage** — `LineageGraph` is a generic weighted "derives-from" DAG. `computeAttributionShares(graph, rootId)` fans a root work's value recursively through its ancestors as fractional `AttributionShare`s (cycle-safe, money-conserving), reusable by any consumer: money, credit, or ranking. `validateLineageEdge` rejects out-of-range weights.
- **Proof-of-citation** — `issueCitationProof(input, secret)` mints an HMAC-SHA256 `CitationProof` an agent presents to a seller or audit log attesting it cited and paid for a set of sources; `verifyCitationProof(proof, secret, now?)` checks the signature, expiry, and replay nonce without trusting the agent. Lower-level: `signClaim`, `signCitationProof`.
- **Stores** — `LineageStore` / `ProofStore` interfaces with `InMemoryLineageStore` / `InMemoryProofStore`. Postgres implementations (`PgLineageStore` / `PgProofStore` over `lepton_lineage_edges` + `lepton_citation_proofs`) live in `@settlekit/persistence`.

```ts
import { detectReuse, issueCitationProof, verifyCitationProof } from "@settlekit/attribution";

const report = detectReuse(answer, [{ id: "src_1", text: source, wallet }]);
if (report.grounded) {
  // charge the toll for report.matches, then issue the proof
  const proof = issueCitationProof(
    { agent, sourceIds: report.matches.map((m) => m.sourceId), accessId, ttlSeconds: 3600 },
    proofSecret,
  );
  // ... later, downstream:
  const ok = verifyCitationProof(proof, proofSecret).ok;
}
```

## Wired live

The `rsshub-citation-toll` sidecar exposes this over HTTP:

- `POST /attribution/detect` — `{ text }` → `ReuseReport`
- `POST /attribution/proof` — mint a `CitationProof`
- `POST /attribution/verify` — `{ proof }` → verification result

The `proofSecret` is configured via `CITATION_PROOF_SECRET` (see the sidecar config).
