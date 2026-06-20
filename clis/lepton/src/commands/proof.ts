/**
 * `lepton proof` — issue and verify citation proofs.
 *
 *   issue    build + sign a CitationProof from flags (secret from env/flag)
 *   verify   verify a CitationProof read from a file or stdin
 *
 * The HMAC secret comes from --secret or CITATION_PROOF_SECRET; it is never
 * echoed back. `issue` prints the full signed proof (JSON by default so it can
 * be piped straight into `verify`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  issueCitationProof,
  verifyCitationProof,
  type CitationProof,
  type IssueProofInput,
} from "@settlekit/attribution";
import { isOk } from "@settlekit/common";
import { buildContext } from "../context.js";
import { resolveSecret } from "../env.js";
import { printJson } from "../output.js";

/** Coerce parsed JSON into a CitationProof, validating the required fields. */
export function parseCitationProof(contents: string): CitationProof {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(
      `Proof is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Proof must be a JSON object.");
  }
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.agent !== "string" ||
    !Array.isArray(p.sourceIds) ||
    typeof p.accessId !== "string" ||
    typeof p.issuedAt !== "string" ||
    typeof p.nonce !== "string" ||
    typeof p.signature !== "string"
  ) {
    throw new Error(
      "Proof is missing required fields (agent, sourceIds, accessId, issuedAt, nonce, signature).",
    );
  }
  return parsed as CitationProof;
}

/** Read all of stdin synchronously as UTF-8 (used when no --proof-file). */
function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function registerProof(program: Command): void {
  const proof = program.command("proof").description("Issue and verify citation proofs");

  proof
    .command("issue")
    .description("Issue and sign a citation proof")
    .requiredOption("--agent <id>", "Agent / payer presenting the proof")
    .requiredOption(
      "--source-id <id...>",
      "Cited source id (repeatable, at least one)",
    )
    .requiredOption("--access-id <id>", "Paid-access event id the citations settled under")
    .option("--amount-usdc <amount>", "Total settled, decimal USDC string")
    .option("--ttl-seconds <seconds>", "Time-to-live in seconds (omit for no expiry)")
    .option("--secret <secret>", "HMAC secret (or env CITATION_PROOF_SECRET)")
    .action(async function (this: Command) {
      const flags = this.opts<{
        agent: string;
        sourceId: string[];
        accessId: string;
        amountUsdc?: string;
        ttlSeconds?: string;
        secret?: string;
      }>();

      const sourceIds = flags.sourceId.filter((id) => id.trim() !== "");
      if (sourceIds.length === 0) {
        throw new Error("--source-id requires at least one non-empty value.");
      }

      let ttlSeconds: number | undefined;
      if (flags.ttlSeconds !== undefined) {
        ttlSeconds = Number(flags.ttlSeconds);
        if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
          throw new Error("--ttl-seconds must be a positive integer.");
        }
      }

      const secret = resolveSecret(flags.secret, "CITATION_PROOF_SECRET");

      const input: IssueProofInput = {
        agent: flags.agent,
        sourceIds,
        accessId: flags.accessId,
        ...(flags.amountUsdc !== undefined ? { amountUsdc: flags.amountUsdc } : {}),
        ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
      };

      const issued = issueCitationProof(input, secret);
      // Always emit JSON so the proof can be piped straight into `proof verify`.
      printJson(issued);
    });

  proof
    .command("verify")
    .description("Verify a citation proof (from --proof-file or stdin)")
    .option("--proof-file <path>", "Path to a JSON CitationProof (defaults to stdin)")
    .option("--secret <secret>", "HMAC secret (or env CITATION_PROOF_SECRET)")
    .action(async function (this: Command) {
      const flags = this.opts<{ proofFile?: string; secret?: string }>();
      const ctx = buildContext(this);

      const contents =
        flags.proofFile !== undefined
          ? readFileSync(resolve(process.cwd(), flags.proofFile), "utf8")
          : readStdin();
      if (contents.trim() === "") {
        throw new Error("No proof provided. Pass --proof-file or pipe JSON on stdin.");
      }

      const parsed = parseCitationProof(contents);
      const secret = resolveSecret(flags.secret, "CITATION_PROOF_SECRET");

      const result = verifyCitationProof(parsed, secret);
      if (isOk(result)) {
        ctx.printRecord(result.value as unknown as Record<string, unknown>);
        return;
      }
      // Surface as a thrown error so index.ts sets exitCode = 1.
      throw new Error(result.error.message);
    });
}
