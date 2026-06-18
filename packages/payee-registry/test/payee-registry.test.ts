import { describe, expect, it } from "vitest";
import { InMemoryPayeeRegistry, walletFor } from "../src/registry.js";

describe("InMemoryPayeeRegistry", () => {
  it("registers and resolves an external identity to a wallet", async () => {
    const registry = new InMemoryPayeeRegistry();
    const payee = await registry.register({
      kind: "rss",
      externalId: "https://blog.example/author/ada",
      wallet: "0xAda",
      displayName: "Ada",
    });
    expect(payee.id).toMatch(/^pye_/);
    const resolved = await registry.resolve("rss", "https://blog.example/author/ada");
    expect(resolved?.wallet).toBe("0xAda");
  });

  it("re-registers in place (stable id, updated wallet)", async () => {
    const registry = new InMemoryPayeeRegistry();
    const first = await registry.register({ kind: "handle", externalId: "@ada", wallet: "0xOld" });
    const second = await registry.register({ kind: "handle", externalId: "@ada", wallet: "0xNew" });
    expect(second.id).toBe(first.id);
    expect((await registry.resolve("handle", "@ada"))?.wallet).toBe("0xNew");
    expect(await registry.list()).toHaveLength(1);
  });

  it("walletFor falls back when unregistered", async () => {
    const registry = new InMemoryPayeeRegistry();
    expect(await walletFor(registry, "rss", "unknown", "0xEscrow")).toBe("0xEscrow");
    await registry.register({ kind: "rss", externalId: "known", wallet: "0xKnown" });
    expect(await walletFor(registry, "rss", "known", "0xEscrow")).toBe("0xKnown");
  });
});
