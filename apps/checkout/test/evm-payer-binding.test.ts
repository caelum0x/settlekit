/**
 * EVM payer binding requires proof of wallet control (security review
 * MEDIUM-1): the buyer signs an EIP-191 message naming the session, network,
 * payer and a short expiry. Unsigned or mis-signed requests never bind or
 * rebind a payer, so nobody holding the session URL can lock the buyer out;
 * a NEW valid signature may rebind (the real buyer can always recover).
 */
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getEvmChain, type Hex } from "@settlekit/chains";

import { CheckoutError } from "../lib/errors";
import { declareEvmPayer, defaultPayerSignatureVerifier } from "../lib/evm-checkout";
import { PAYER_BINDING_MAX_TTL_MS, buildPayerBindingMessage } from "../lib/evm-wallet";
import { FIELDS, evmRuntime, fakeEvmRpc, harness, openSession, type FakeChainState } from "./harness";

const BASE = getEvmChain("base", "mainnet")!;
const ENV = { SETTLEKIT_CHAIN_ENV: "mainnet", ENABLED_EVM_CHAINS: "base" };

function setup() {
  const base: FakeChainState = { chainId: BASE.chainId, token: BASE.token.address, head: 102n, txs: {} };
  return harness({ evm: evmRuntime(ENV, { base: fakeEvmRpc(base) }) });
}

const buyer = privateKeyToAccount(generatePrivateKey());
const attacker = privateKeyToAccount(generatePrivateKey());

async function signedBinding(
  account: typeof buyer,
  sessionId: string,
  overrides: { network?: string; expiresAt?: string; payer?: string; signedSessionId?: string } = {},
): Promise<{ payer: string; signature: Hex; expiresAt: string }> {
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString();
  const payer = overrides.payer ?? account.address;
  const message = buildPayerBindingMessage({
    sessionId: overrides.signedSessionId ?? sessionId,
    network: overrides.network ?? "base",
    payer,
    expiresAt,
  });
  return { payer, signature: await account.signMessage({ message }), expiresAt };
}

async function expectCode(promise: Promise<unknown>, code: CheckoutError["code"]): Promise<CheckoutError> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(CheckoutError);
  expect((error as CheckoutError).code).toBe(code);
  return error as CheckoutError;
}

describe("EVM payer binding proof", () => {
  it("refuses an unsigned binding and leaves the session unbound", async () => {
    const h = setup();
    const session = await openSession(h, "base", { collectedFields: {} });
    await expectCode(declareEvmPayer({ sessionId: session.id, payer: buyer.address, fields: FIELDS }, h.deps), "invalid_request");
    expect((await h.checkouts.findById(session.id))?.payerAddress).toBeUndefined();
  });

  it("binds the payer on a valid personal_sign signature", async () => {
    const h = setup();
    const session = await openSession(h, "base", { collectedFields: {} });
    const proof = await signedBinding(buyer, session.id);
    const { payerAddress } = await declareEvmPayer({ sessionId: session.id, fields: FIELDS, ...proof }, h.deps);
    expect(payerAddress).toBe(buyer.address);
    expect(await h.checkouts.findById(session.id)).toMatchObject({ payerAddress: buyer.address, collectedFields: FIELDS });
  });

  it("rejects signatures by another key, for another session/network, or with a bad expiry", async () => {
    const h = setup();
    const session = await openSession(h, "base", { collectedFields: {} });
    const bad = [
      // Signed by the attacker while claiming the buyer's address.
      await signedBinding(attacker, session.id, { payer: buyer.address }),
      await signedBinding(buyer, session.id, { signedSessionId: "cs_other" }),
      await signedBinding(buyer, session.id, { network: "ethereum" }),
      await signedBinding(buyer, session.id, { expiresAt: new Date(Date.now() - 1_000).toISOString() }),
      await signedBinding(buyer, session.id, {
        expiresAt: new Date(Date.now() + PAYER_BINDING_MAX_TTL_MS + 60_000).toISOString(),
      }),
      { ...(await signedBinding(buyer, session.id)), expiresAt: "not-a-date" },
      { ...(await signedBinding(buyer, session.id)), signature: "0xdeadbeef" as Hex },
    ];
    for (const proof of bad) {
      await expectCode(declareEvmPayer({ sessionId: session.id, fields: FIELDS, ...proof }, h.deps), "invalid_request");
    }
    expect((await h.checkouts.findById(session.id))?.payerAddress).toBeUndefined();
  });

  it("only rebinds on a new valid signature, never on an unsigned request", async () => {
    const h = setup();
    const session = await openSession(h, "base", { collectedFields: {} });
    await declareEvmPayer({ sessionId: session.id, fields: FIELDS, ...(await signedBinding(buyer, session.id)) }, h.deps);

    await expectCode(
      declareEvmPayer({ sessionId: session.id, payer: attacker.address, fields: FIELDS }, h.deps),
      "invalid_request",
    );
    expect((await h.checkouts.findById(session.id))?.payerAddress).toBe(buyer.address);

    // The holder of another wallet can rebind only by proving control of it.
    await declareEvmPayer({ sessionId: session.id, fields: FIELDS, ...(await signedBinding(attacker, session.id)) }, h.deps);
    expect((await h.checkouts.findById(session.id))?.payerAddress).toBe(attacker.address);
    // ...and the buyer can always take it back the same way.
    await declareEvmPayer({ sessionId: session.id, fields: FIELDS, ...(await signedBinding(buyer, session.id)) }, h.deps);
    expect((await h.checkouts.findById(session.id))?.payerAddress).toBe(buyer.address);
  });

  it("accepts smart-contract wallets through the EIP-1271 verifier", async () => {
    const h = setup();
    const session = await openSession(h, "base", { collectedFields: {} });
    const smartWallet = "0x5555555555555555555555555555555555555555";
    // An owner key signs for the smart wallet; ECDSA recovery alone cannot
    // match the contract address, the on-chain isValidSignature check can.
    const proof = await signedBinding(buyer, session.id, { payer: smartWallet });
    await expectCode(declareEvmPayer({ sessionId: session.id, fields: FIELDS, ...proof }, h.deps), "invalid_request");

    const calls: string[] = [];
    const contractAware = async (args: { address: Hex; message: string; signature: Hex }) => {
      calls.push(args.address);
      return args.address.toLowerCase() === smartWallet;
    };
    const { payerAddress } = await declareEvmPayer({ sessionId: session.id, fields: FIELDS, ...proof }, h.deps, {
      verifySignature: contractAware,
    });
    expect(payerAddress.toLowerCase()).toBe(smartWallet);
    expect(calls).toHaveLength(1);
  });

  it("default verifier: ECDSA locally, EIP-1271 only via an RPC client", async () => {
    const message = buildPayerBindingMessage({
      sessionId: "cs_1",
      network: "base",
      payer: buyer.address,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const signature = await buyer.signMessage({ message });
    const noRpc = defaultPayerSignatureVerifier(undefined);
    expect(await noRpc({ address: buyer.address, message, signature })).toBe(true);
    expect(await noRpc({ address: attacker.address, message, signature })).toBe(false);

    const rpcSeen: Hex[] = [];
    const withRpc = defaultPayerSignatureVerifier({
      verifyMessage: async ({ address }) => {
        rpcSeen.push(address);
        return true;
      },
    });
    // EOA match never touches the RPC; a mismatch defers to the chain.
    expect(await withRpc({ address: buyer.address, message, signature })).toBe(true);
    expect(rpcSeen).toEqual([]);
    expect(await withRpc({ address: attacker.address, message, signature })).toBe(true);
    expect(rpcSeen).toEqual([attacker.address]);
  });
});
