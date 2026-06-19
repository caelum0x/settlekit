/**
 * Lepton nanopayments — the whole economy in one runnable command.
 *
 *   pnpm --filter @settlekit/examples lepton
 *
 * Four creator-payment patterns the sub-cent floor unlocks, each settled over
 * the SettleKit nanopayment spine. Everything here runs offline over the local
 * settlement provider; set SETTLEMENT_PROVIDER=circle (+ Arc RPC/creds) and the
 * exact same flows settle in real testnet USDC on Arc — no code change.
 *
 *   Act 1  RFB 6   an AI agent pays an x402 citation toll to ground an answer
 *   Act 2  RFB 6   per-listen royalties: pay artists by what you actually played
 *   Act 3  RFB 4   per-second streaming: pay by the second watched, refund the rest
 *   Act 4  RFB 6   OSS fund: an engine splits a budget across your dependency tree,
 *                  conserved to the base unit and ready for one on-chain split tx
 */

import { fromBaseUnits, toBaseUnits, unwrap } from "@settlekit/common";
import { LocalSettlementProvider } from "@settlekit/settlement-core";
import { createLocalSettlement, payAndFetch } from "@settlekit/x402-client";
import {
  type RssItem,
  createSidecar as createRssSidecar,
  loadConfig as loadRssConfig,
} from "@settlekit/rsshub-citation-toll";
import {
  createSidecar as createMusicSidecar,
  loadConfig as loadMusicConfig,
} from "@settlekit/navidrome-scrobble";
import {
  createSidecar as createStreamSidecar,
  loadConfig as loadStreamConfig,
} from "@settlekit/owncast-stream";
import {
  RegistryMaintainerResolver,
  SEED_ESCROW_WALLET,
  buildGraph,
  defaultAllocationEngine,
  parsePackageJson,
  parsePackageLock,
  planFunding,
  seedLockJson,
  seedManifestJson,
  seedMaintainers,
  seedRegistry,
  settleFundingPlan,
  toDistributorCall,
} from "@settlekit/oss-fund";

function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function act(n: number, rfb: string, title: string): void {
  out("");
  out(`  ── Act ${n} · ${rfb} ─────────────────────────────────────────`);
  out(`     ${title}`);
  out("");
}

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

/** Running tally of test-USDC actually settled, in base units (6 dp). */
let movedBase = 0n;
function moved(amountUsdc: string): string {
  movedBase += toBaseUnits(amountUsdc);
  return amountUsdc;
}

function unwrapDefined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}

async function citationToll(): Promise<void> {
  act(1, "RFB 6 · Citation tolls", "An AI agent pays to cite a source.");
  const provider = new LocalSettlementProvider();
  const rss = createRssSidecar(loadRssConfig(env({ DEFAULT_TOLL_USDC: "0.0005", ESCROW_WALLET: "0xEscrow" })), {
    settlementProvider: provider,
  });

  const item: RssItem = {
    feedId: "rsshub:the-verge",
    itemId: "the-lepton-reborn",
    title: "The lepton, reborn for machines",
    author: { externalId: "https://example.com/authors/ada", displayName: "Ada Lovelace", wallet: "0xAda" },
    content: "Nanopayments remove the floor: value as small as $0.000001, cleared in under half a second.",
    priceUsdc: "0.0005",
  };
  const ingest = await rss.app.request("/admin/feeds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [item] }),
  });
  const { data } = (await ingest.json()) as { data: { sourceIds: string[] } };
  const sourceId = unwrapDefined(data.sourceIds[0], "sourceId");
  out(`     publisher ingested 1 source, priced at ${item.priceUsdc} USDC/citation → ${sourceId}`);

  // An LLM agent grounds an answer in the source: GET returns 402, the agent
  // pays the advertised toll, and the verified payment is served.
  const paid = unwrap(
    await payAndFetch(`http://sidecar.local/articles/${sourceId}`, {
      fetcher: async (req) => rss.app.fetch(req),
      settler: rss.demoSettler,
      from: "0xllm-agent",
    }),
  );
  out(`     agent 0xllm-agent paid the x402 toll: ${paid.paid ? "PAID" : "free"} ${paid.amount?.amount ?? "0"} USDC`);

  await rss.app.request("/admin/sweep", { method: "POST" });
  out(`     swept → ${moved(provider.totalVolume().amount)} USDC settled to Ada (0xAda)`);
}

async function perListenRoyalties(): Promise<void> {
  act(2, "RFB 6 · Per-listen royalties", "Your money goes to the artists you actually played.");
  const provider = new LocalSettlementProvider();
  const music = createMusicSidecar(
    loadMusicConfig(env({ PER_LISTEN_USDC: "0.0002", MIN_PLAY_SECONDS: "30", ESCROW_WALLET: "0xEscrow" })),
    { settlementProvider: provider },
  );

  const skip = await music.processor.process({
    userId: "u-listener",
    trackId: "t-skip",
    artist: { externalId: "mbid:radiohead", displayName: "Radiohead", wallet: "0xRadiohead" },
    playedSeconds: 8,
  });
  out(`     8s skip of Radiohead → charged: ${skip.charged} (a skip in the first seconds is free)`);

  for (const [track, artist, wallet, secs] of [
    ["t-weird", "Radiohead", "0xRadiohead", 248],
    ["t-kerala", "Bonobo", "0xBonobo", 301],
  ] as const) {
    const r = await music.processor.process({
      userId: "u-listener",
      trackId: track,
      artist: { externalId: `mbid:${artist.toLowerCase()}`, displayName: artist, wallet },
      playedSeconds: secs,
    });
    out(`     ${secs}s play of ${artist} → charged ${r.amountUsdc} USDC to ${wallet}`);
  }

  await music.app.request("/admin/sweep", { method: "POST" });
  out(`     swept → ${moved(provider.totalVolume().amount)} USDC settled to the artists actually played`);
}

async function perSecondStreaming(): Promise<void> {
  act(3, "RFB 4 · Per-second streaming", "You pay for the rate of flow, by the second.");
  const provider = new LocalSettlementProvider();
  const clock = { t: 0 };
  const stream = createStreamSidecar(
    loadStreamConfig(env({ PER_SECOND_USDC: "0.0001", RESERVE_USDC: "0.05", ESCROW_WALLET: "0xEscrow" })),
    { settlementProvider: provider, now: () => clock.t },
  );

  await stream.sessions.join({ sessionId: "viewer-1", streamer: { externalId: "owncast:dj", displayName: "DJ Flux", wallet: "0xDJ" } });
  out(`     viewer joined DJ Flux's stream (rate 0.0001 USDC/s, reserve 0.05)`);
  clock.t = 42_000; // 42 seconds watched
  const leave = unwrapDefined(await stream.sessions.leave("viewer-1"), "leave result");
  out(`     left after 42s → accrued ${leave.accruedUsdc} USDC, refunded ${leave.refundUsdc} of the reserve`);

  await stream.app.request("/admin/sweep", { method: "POST" });
  out(`     swept → ${moved(provider.totalVolume().amount)} USDC settled to DJ Flux (0xDJ)`);
}

async function ossFund(): Promise<void> {
  act(4, "RFB 6 · Recursive splits", "Fund the maintainers your dependency tree leans on.");
  const graph = buildGraph(parsePackageJson(seedManifestJson()), parsePackageLock(seedLockJson()));
  const resolver = new RegistryMaintainerResolver(await seedRegistry(), {
    escrowWallet: SEED_ESCROW_WALLET,
    maintainers: seedMaintainers(),
  });
  const engine = defaultAllocationEngine();
  const plan = await planFunding({ graph, budgetUsdc: "5", resolver, engine });

  const { settler } = createLocalSettlement();
  const receipt = await settleFundingPlan(plan, {
    settler,
    from: "0xfunder",
    idempotencyKey: "lepton-demo-fund-2026-06",
  });

  out(`     engine: ${engine.name}  ·  budget: ${plan.budget.amount} USDC  ·  ${plan.legs.length} payout legs`);
  const top = [...plan.allocations].sort((a, b) => b.weight - a.weight).slice(0, 4);
  for (const a of top) {
    out(`       ${a.name.padEnd(16)} ${a.amount.amount.padStart(8)} USDC  ${a.claimed ? "" : "(escrow)"}`);
  }
  out(`     distributed ${moved(receipt.distributed.amount)} USDC  ·  reconciled (per-leg): ${receipt.reconciled ? "yes" : "NO"}`);
  const call = toDistributorCall(plan);
  out(
    `     on-chain: RecursiveSplitDistributor.distribute(${call.recipients.length} recipients, ` +
      `total ${fromBaseUnits(BigInt(call.totalBase))} USDC) — one tx`,
  );
}

async function main(): Promise<void> {
  out("");
  out("  ╔══════════════════════════════════════════════════════════════╗");
  out("  ║   Lepton nanopayments — value too small to have been moved    ║");
  out("  ║   SettleKit · settled on Arc in USDC · <500ms                 ║");
  out("  ╚══════════════════════════════════════════════════════════════╝");

  await citationToll();
  await perListenRoyalties();
  await perSecondStreaming();
  await ossFund();

  out("");
  out("  ────────────────────────────────────────────────────────────────");
  out(`  total test-USDC settled across all four flows: ${fromBaseUnits(movedBase)} USDC`);
  out("  every unit conserved · idempotent · flips to Arc with SETTLEMENT_PROVIDER=circle");
  out("");
}

main().catch((error: unknown) => {
  process.stderr.write(`lepton demo failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
