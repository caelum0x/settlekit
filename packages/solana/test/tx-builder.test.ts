import { describe, expect, it } from "vitest";
import {
  AccountRole,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getUtf8Decoder,
  type Instruction,
} from "@solana/kit";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferCheckedInstruction,
} from "@solana-program/token";
import { MEMO_PROGRAM_ADDRESS, buildUsdcPaymentTx } from "../src/tx-builder.js";
import { BUYER, BUYER_ATA, MERCHANT, MERCHANT_ATA, RECENT_BLOCKHASH, REFERENCE, USDC } from "./fixtures.js";

const LATEST = { blockhash: RECENT_BLOCKHASH, lastValidBlockHeight: 280_000_150n };

function decode(base64: string) {
  const bytes = getBase64Encoder().encode(base64);
  const tx = getTransactionDecoder().decode(bytes);
  const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const message = decompileTransactionMessage(compiled);
  const instructions: readonly Instruction[] = message.instructions;
  return { tx, compiled, message, instructions };
}

type DecodedInstruction = Instruction & {
  accounts: NonNullable<Instruction["accounts"]>;
  data: NonNullable<Instruction["data"]>;
};

function withAccountsAndData(ix: Instruction | undefined): DecodedInstruction {
  if (!ix || !ix.accounts || !ix.data) throw new Error("instruction missing accounts/data");
  return ix as DecodedInstruction;
}

describe("buildUsdcPaymentTx", () => {
  it("builds an unsigned v0 tx: idempotent ATA create + TransferChecked with the reference", async () => {
    const built = await buildUsdcPaymentTx({
      buyer: BUYER,
      recipientOwner: MERCHANT,
      mint: USDC,
      amount: 12_500_000n,
      reference: REFERENCE,
      latestBlockhash: LATEST,
    });

    expect(built.sourceTokenAccount).toBe(BUYER_ATA);
    expect(built.destinationTokenAccount).toBe(MERCHANT_ATA);
    expect(built.lastValidBlockHeight).toBe(280_000_150n);

    const { tx, compiled, message, instructions } = decode(built.transaction);
    expect(compiled.version).toBe(0);
    // Fee payer = buyer, the only required signer, and the signature is still empty.
    expect(compiled.staticAccounts[0]).toBe(BUYER);
    expect(compiled.header.numSignerAccounts).toBe(1);
    expect(Object.keys(tx.signatures)).toEqual([BUYER]);
    expect(tx.signatures[BUYER as keyof typeof tx.signatures]).toBeNull();
    expect(message.feePayer.address).toBe(BUYER);
    expect(compiled.lifetimeToken).toBe(RECENT_BLOCKHASH);

    expect(instructions).toHaveLength(2);
    const [createIx, transferIx] = instructions.map(withAccountsAndData);

    expect(createIx!.programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
    const create = parseCreateAssociatedTokenIdempotentInstruction(createIx!);
    expect(create.accounts.payer.address).toBe(BUYER);
    expect(create.accounts.ata.address).toBe(MERCHANT_ATA);
    expect(create.accounts.owner.address).toBe(MERCHANT);
    expect(create.accounts.mint.address).toBe(USDC);

    expect(transferIx!.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
    const transfer = parseTransferCheckedInstruction(transferIx!);
    expect(transfer.data.amount).toBe(12_500_000n);
    expect(transfer.data.decimals).toBe(6);
    expect(transfer.accounts.source.address).toBe(BUYER_ATA);
    expect(transfer.accounts.destination.address).toBe(MERCHANT_ATA);
    expect(transfer.accounts.mint.address).toBe(USDC);
    expect(transfer.accounts.authority.address).toBe(BUYER);

    // Reference is appended read-only, non-signer, after the four transfer accounts.
    const extra = transferIx!.accounts.slice(4);
    expect(extra).toEqual([{ address: REFERENCE, role: AccountRole.READONLY }]);
  });

  it("places a memo immediately before the transfer when requested", async () => {
    const built = await buildUsdcPaymentTx({
      buyer: BUYER,
      recipientOwner: MERCHANT,
      mint: USDC,
      amount: 1n,
      memo: "cs_123",
      latestBlockhash: LATEST,
    });
    const { instructions } = decode(built.transaction);
    expect(instructions.map((ix) => ix.programAddress)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      MEMO_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
    ]);
    const memo = withAccountsAndData(instructions[1]);
    expect(getUtf8Decoder().decode(memo.data)).toBe("cs_123");
    // No reference requested: the transfer carries exactly its four accounts.
    expect(withAccountsAndData(instructions[2]).accounts).toHaveLength(4);
  });

  it("rejects non-positive amounts and malformed addresses", async () => {
    await expect(
      buildUsdcPaymentTx({ buyer: BUYER, recipientOwner: MERCHANT, mint: USDC, amount: 0n, latestBlockhash: LATEST }),
    ).rejects.toThrow(/positive/);
    await expect(
      buildUsdcPaymentTx({ buyer: BUYER, recipientOwner: "0xabc", mint: USDC, amount: 1n, latestBlockhash: LATEST }),
    ).rejects.toThrow();
  });
});
