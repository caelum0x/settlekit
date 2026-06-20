import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@settlekit/common";
import { privateKeyToAccount } from "viem/accounts";
import { AuthService, InMemoryAuthStore, buildSiweMessage } from "../src/index.js";

// Deterministic well-known test key (anvil account #0). Never a real key.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(TEST_KEY);
const NOW = new Date("2026-06-20T12:00:00.000Z");

function service(): AuthService {
  return new AuthService(new InMemoryAuthStore());
}

async function signedLogin(
  svc: AuthService,
  nonce: string,
  now: Date = NOW,
): Promise<{ message: string; signature: `0x${string}` }> {
  const message = buildSiweMessage({
    address: account.address,
    domain: "app.settlekit.com",
    uri: "https://app.settlekit.com",
    chainId: 1,
    nonce,
    issuedAt: now,
  });
  const signature = await account.signMessage({ message });
  return { message, signature };
}

describe("AuthService wallet login (SIWE)", () => {
  it("issues a nonce for a valid address and rejects a malformed one", async () => {
    const svc = service();
    const ok = await svc.requestWalletNonce(account.address, NOW);
    expect(isOk(ok)).toBe(true);
    if (!isOk(ok)) return;
    expect(ok.value.nonce.length).toBeGreaterThan(0);
    expect(ok.value.address).toBe(account.address); // checksummed

    const bad = await svc.requestWalletNonce("not-an-address", NOW);
    expect(isErr(bad)).toBe(true);
    if (isErr(bad)) expect(bad.error.code).toBe("validation_error");
  });

  it("logs in with a valid signature and creates a wallet account", async () => {
    const svc = service();
    const nonceRes = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(nonceRes)) throw new Error("nonce");
    const { message, signature } = await signedLogin(svc, nonceRes.value.nonce);

    const res = await svc.loginWithWallet({ message, signature, type: "merchant" }, NOW);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.account.walletAddress).toBe(account.address);
    expect(res.value.account.type).toBe("merchant");
    expect(res.value.session.token.length).toBeGreaterThan(0);
  });

  it("returns the same account on a second wallet login", async () => {
    const svc = service();
    const first = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(first)) throw new Error("nonce");
    const s1 = await signedLogin(svc, first.value.nonce);
    const r1 = await svc.loginWithWallet({ message: s1.message, signature: s1.signature }, NOW);

    const second = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(second)) throw new Error("nonce");
    const s2 = await signedLogin(svc, second.value.nonce);
    const r2 = await svc.loginWithWallet({ message: s2.message, signature: s2.signature }, NOW);

    if (!isOk(r1) || !isOk(r2)) throw new Error("login");
    expect(r2.value.account.id).toBe(r1.value.account.id);
  });

  it("rejects a replayed nonce (single-use)", async () => {
    const svc = service();
    const nonceRes = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(nonceRes)) throw new Error("nonce");
    const { message, signature } = await signedLogin(svc, nonceRes.value.nonce);

    const first = await svc.loginWithWallet({ message, signature }, NOW);
    expect(isOk(first)).toBe(true);
    const replay = await svc.loginWithWallet({ message, signature }, NOW);
    expect(isErr(replay)).toBe(true);
    if (isErr(replay)) expect(replay.error.code).toBe("unauthorized");
  });

  it("rejects an expired nonce", async () => {
    const svc = service();
    const nonceRes = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(nonceRes)) throw new Error("nonce");
    const { message, signature } = await signedLogin(svc, nonceRes.value.nonce);
    const later = new Date(NOW.getTime() + 11 * 60 * 1000); // past the 10-min TTL
    const res = await svc.loginWithWallet({ message, signature }, later);
    expect(isErr(res)).toBe(true);
  });

  it("rejects a signature from a different signer", async () => {
    const svc = service();
    const nonceRes = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(nonceRes)) throw new Error("nonce");
    const message = buildSiweMessage({
      address: account.address,
      domain: "app.settlekit.com",
      uri: "https://app.settlekit.com",
      chainId: 1,
      nonce: nonceRes.value.nonce,
      issuedAt: NOW,
    });
    // Sign with a DIFFERENT key than the message claims.
    const other = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const signature = await other.signMessage({ message });
    const res = await svc.loginWithWallet({ message, signature }, NOW);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe("unauthorized");
  });
});
