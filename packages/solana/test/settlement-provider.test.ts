import { describe, expect, it } from "vitest";
import {
  createKeyPairSignerFromPrivateKeyBytes,
  decompileTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getUtf8Decoder,
} from "@solana/kit";
import { parseTransferCheckedInstruction } from "@solana-program/token";
import { configureSettlement, InMemoryIdempotencyStore } from "@settlekit/settlement-core";
import {
  SolanaSettlementProvider,
  createSolanaSignerFromSecret,
} from "../src/settlement-provider.js";
import { MEMO_PROGRAM_ADDRESS } from "../src/tx-builder.js";
import { MERCHANT, USDC, fakeRpc } from "./fixtures.js";

const noSleep = async (): Promise<void> => undefined;

function decodeSent(base64: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(tx.messageBytes));
  return { tx, message };
}

describe("SolanaSettlementProvider", () => {
  it("signs, sends and confirms a USDC transfer with the reference as memo", async () => {
    const signer = await generateKeyPairSigner();
    const rpc = fakeRpc();
    const provider = new SolanaSettlementProvider({ rpc, signer, mint: USDC, sleep: noSleep });

    const receipt = await provider.settle({
      reference: "payout:po_1",
      to: MERCHANT,
      amountUsdc: "2.5",
      network: "solana",
    });

    expect(receipt).toMatchObject({
      status: "settled",
      provider: "solana",
      network: "solana",
      to: MERCHANT,
      amount: { amount: "2.5", currency: "USDC" },
    });
    expect(rpc.sent).toHaveLength(1);

    const { tx, message } = decodeSent(rpc.sent[0]!);
    // Signed by the hot wallet (fee payer) and the receipt carries that signature.
    const signature = tx.signatures[signer.address as keyof typeof tx.signatures];
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(receipt.txHash).toBeTruthy();
    expect(message.feePayer.address).toBe(signer.address);

    const memoIx = message.instructions.find((ix) => ix.programAddress === MEMO_PROGRAM_ADDRESS);
    expect(getUtf8Decoder().decode(memoIx!.data!)).toBe("payout:po_1");
    const transferIx = message.instructions.at(-1)!;
    const transfer = parseTransferCheckedInstruction(transferIx as Parameters<typeof parseTransferCheckedInstruction>[0]);
    expect(transfer.data.amount).toBe(2_500_000n);
  });

  it("is idempotent on reference: a retry never sends twice", async () => {
    const signer = await generateKeyPairSigner();
    const rpc = fakeRpc();
    const idempotency = new InMemoryIdempotencyStore();
    const provider = new SolanaSettlementProvider({ rpc, signer, mint: USDC, sleep: noSleep, idempotency });
    const request = { reference: "payout:po_2", to: MERCHANT, amountUsdc: "1", network: "solana" as const };

    const first = await provider.settle(request);
    const second = await provider.settle(request);
    expect(second.id).toBe(first.id);
    expect(rpc.sent).toHaveLength(1);
  });

  it("throws and releases the claim when the transfer fails on-chain", async () => {
    const signer = await generateKeyPairSigner();
    const idempotency = new InMemoryIdempotencyStore();
    const failing = fakeRpc();
    const statuses = failing.getSignatureStatuses.bind(failing);
    failing.getSignatureStatuses = async (sigs) =>
      (await statuses(sigs)).map((s) => (s ? { ...s, err: { InstructionError: [2, { Custom: 1 }] } } : s));
    const provider = new SolanaSettlementProvider({ rpc: failing, signer, mint: USDC, sleep: noSleep, idempotency });

    await expect(
      provider.settle({ reference: "payout:po_3", to: MERCHANT, amountUsdc: "1", network: "solana" }),
    ).rejects.toThrow(/failed/);
    expect(await idempotency.get("payout:po_3")).toBeUndefined();
  });

  it("times out (retryable) when the signature never reaches the commitment", async () => {
    const signer = await generateKeyPairSigner();
    const rpc = fakeRpc();
    rpc.getSignatureStatuses = async (sigs) => sigs.map(() => null);
    const provider = new SolanaSettlementProvider({
      rpc,
      signer,
      mint: USDC,
      sleep: noSleep,
      maxWaitMs: 0,
    });
    await expect(
      provider.settle({ reference: "payout:po_4", to: MERCHANT, amountUsdc: "1", network: "solana" }),
    ).rejects.toMatchObject({ code: "payment_failed", retryable: true });
  });

  it("rejects non-solana networks and non-base58 recipients", async () => {
    const signer = await generateKeyPairSigner();
    const provider = new SolanaSettlementProvider({ rpc: fakeRpc(), signer, mint: USDC, sleep: noSleep });
    await expect(
      provider.settle({ reference: "r1", to: MERCHANT, amountUsdc: "1", network: "arc" }),
    ).rejects.toThrow(/cannot settle on arc/);
    await expect(
      provider.settle({ reference: "r2", to: "0xabc", amountUsdc: "1", network: "solana" }),
    ).rejects.toThrow(/invalid Solana recipient/);
  });

  it("plugs into settlement-core's configureSettlement as an injected provider", async () => {
    const signer = await generateKeyPairSigner();
    const provider = new SolanaSettlementProvider({ rpc: fakeRpc(), signer, mint: USDC, sleep: noSleep });
    expect(configureSettlement({ provider: "injected", instance: provider })).toBe(provider);
    expect(provider.name).toBe("solana");
  });
});

describe("createSolanaSignerFromSecret", () => {
  it("accepts the solana-keygen JSON byte-array format", async () => {
    // A keypair file is the 32-byte seed followed by its 32-byte public key.
    const seed = Uint8Array.from({ length: 32 }, (_, i) => (i * 7) % 256);
    const derived = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const full = new Uint8Array([...seed, ...getAddressEncoder().encode(derived.address)]);

    const fromJson = await createSolanaSignerFromSecret(JSON.stringify(Array.from(full)));
    expect(fromJson.address).toBe(derived.address);
    const fromBase58 = await createSolanaSignerFromSecret(getBase58Decoder().decode(full));
    expect(fromBase58.address).toBe(derived.address);
  });

  it("rejects secrets of the wrong length", async () => {
    await expect(createSolanaSignerFromSecret("[1,2,3]")).rejects.toThrow(/64 bytes/);
  });
});
