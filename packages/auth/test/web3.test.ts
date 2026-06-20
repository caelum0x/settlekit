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
    expirationTime: new Date(now.getTime() + 10 * 60 * 1000),
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

  it("links a wallet to an existing email account", async () => {
    const svc = service();
    const reg = await svc.registerWithPassword(
      { type: "customer", email: "buyer@example.com", password: "password123" },
      NOW,
    );
    if (!isOk(reg)) throw new Error("register");
    const session = await svc.loginWithPassword(
      { email: "buyer@example.com", password: "password123" },
      NOW,
    );
    if (!isOk(session)) throw new Error("login");

    const nonceRes = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(nonceRes)) throw new Error("nonce");
    const { message, signature } = await signedLogin(svc, nonceRes.value.nonce);

    const linked = await svc.linkWallet(session.value.session.token, { message, signature }, NOW);
    expect(isOk(linked)).toBe(true);
    if (!isOk(linked)) return;
    expect(linked.value.account.id).toBe(reg.value.id);
    expect(linked.value.account.walletAddress).toBe(account.address);
  });

  it("rejects linking a wallet already owned by another account", async () => {
    const svc = service();
    // Account A claims the wallet via wallet login.
    const n1 = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(n1)) throw new Error("nonce");
    const s1 = await signedLogin(svc, n1.value.nonce);
    await svc.loginWithWallet({ message: s1.message, signature: s1.signature }, NOW);

    // Account B (email) tries to link the same wallet.
    await svc.registerWithPassword(
      { type: "customer", email: "other@example.com", password: "password123" },
      NOW,
    );
    const session = await svc.loginWithPassword(
      { email: "other@example.com", password: "password123" },
      NOW,
    );
    if (!isOk(session)) throw new Error("login");
    const n2 = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(n2)) throw new Error("nonce");
    const s2 = await signedLogin(svc, n2.value.nonce);
    const linked = await svc.linkWallet(session.value.session.token, s2, NOW);
    expect(isErr(linked)).toBe(true);
    if (isErr(linked)) expect(linked.error.code).toBe("conflict");
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
      expirationTime: new Date(NOW.getTime() + 10 * 60 * 1000),
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

  it("rejects a message whose domain does not match the configured siweDomain", async () => {
    const svc = new AuthService(new InMemoryAuthStore(), { siweDomain: "app.settlekit.com" });
    const nonceRes = await svc.requestWalletNonce(account.address, NOW);
    if (!isOk(nonceRes)) throw new Error("nonce");
    const message = buildSiweMessage({
      address: account.address,
      domain: "evil.com", // attacker site — must be rejected
      uri: "https://evil.com",
      chainId: 1,
      nonce: nonceRes.value.nonce,
      issuedAt: NOW,
      expirationTime: new Date(NOW.getTime() + 10 * 60 * 1000),
    });
    const signature = await account.signMessage({ message });
    const res = await svc.loginWithWallet({ message, signature }, NOW);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe("unauthorized");
  });

  it("rejects a message with no expiration time", async () => {
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
      // no expirationTime — server must reject (no infinite-lifetime credentials)
    });
    const signature = await account.signMessage({ message });
    const res = await svc.loginWithWallet({ message, signature }, NOW);
    expect(isErr(res)).toBe(true);
  });

  it("rejects email registration on the reserved wallet domain", async () => {
    const svc = service();
    const res = await svc.registerWithPassword(
      { type: "customer", email: "0xabc@wallet.settlekit.local", password: "password123" },
      NOW,
    );
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe("validation_error");
  });
});
