import { describe, expect, it } from "vitest";
import { checkPassword, createSessionToken, safeNextPath, verifySessionToken } from "../lib/auth";
import { loadConsoleConfig, ownerLoginEnabled } from "../lib/config";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-10-07T10:00:00.000Z");

describe("owner auth guard", () => {
  it("checks the owner password in constant time and refuses empty/unset", () => {
    expect(checkPassword("correct horse", "correct horse")).toBe(true);
    expect(checkPassword("correct hors", "correct horse")).toBe(false);
    expect(checkPassword("", "")).toBe(false);
    expect(checkPassword("anything", null)).toBe(false);
  });

  it("accepts a fresh signed token and rejects expired, tampered or foreign ones", () => {
    const token = createSessionToken(SECRET, NOW, 60_000);
    expect(verifySessionToken(token, SECRET, NOW)).toBe(true);
    expect(verifySessionToken(token, SECRET, new Date(NOW.getTime() + 60_001))).toBe(false);
    expect(verifySessionToken(token, "t".repeat(40), NOW)).toBe(false);
    const [v, exp, nonce, mac] = token.split(".");
    const extended = `${v}.${Number(exp) + 10_000_000}.${nonce}.${mac}`;
    expect(verifySessionToken(extended, SECRET, NOW)).toBe(false);
    expect(verifySessionToken(`${v}.${exp}.${nonce}.${"0".repeat(64)}`, SECRET, NOW)).toBe(false);
    expect(verifySessionToken("garbage", SECRET, NOW)).toBe(false);
    expect(verifySessionToken(undefined, SECRET, NOW)).toBe(false);
    expect(verifySessionToken(token, null, NOW)).toBe(false);
  });

  it("only redirects to same-origin paths after login", () => {
    expect(safeNextPath("/decisions/abc")).toBe("/decisions/abc");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });

  it("keeps the key server-side and disables login without a strong secret", () => {
    const config = loadConsoleConfig({
      OPERATOR_API_URL: "https://api.example/",
      OPERATOR_CONSOLE_API_KEY: " sk_owner ",
      CONSOLE_OWNER_PASSWORD: "pw",
      CONSOLE_SESSION_SECRET: "short",
    });
    expect(config).toMatchObject({ apiUrl: "https://api.example", apiKey: "sk_owner", sessionSecret: null, explorerUrl: "https://testnet.arcscan.app" });
    expect(ownerLoginEnabled(config)).toBe(false);
    expect(ownerLoginEnabled(loadConsoleConfig({ CONSOLE_OWNER_PASSWORD: "pw", CONSOLE_SESSION_SECRET: SECRET }))).toBe(true);
    expect(loadConsoleConfig({ OPERATOR_WALLET_ADDRESS: "nope" }).operatorAddress).toBeNull();
  });
});
