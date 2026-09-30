/**
 * embed.js (public/embed.js) run against a small DOM stand-in, plus the
 * server-side origin allow-list. No browser needed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { allowedTarget, embedOriginsForSession, isOrigin } from "../lib/embed";
import { harness, openSession } from "./harness";

type Listener = (event: any) => void;

class FakeNode {
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  style: Record<string, string> = {};
  textContent = "";
  contentWindow: object | null = null;
  constructor(public tag: string) {
    if (tag === "iframe") this.contentWindow = { frame: true };
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  appendChild(child: FakeNode) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeNode) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatchEvent(event: { type: string }) {
    for (const fn of this.listeners[event.type] ?? []) fn(event);
    return true;
  }
  focus() {}
  find(tag: string): FakeNode[] {
    return this.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...c.find(tag)]);
  }
}

function loadEmbed() {
  const body = new FakeNode("body");
  const link = new FakeNode("a");
  link.attrs = { href: "https://pay.test/l/course-1234", "data-settlekit-checkout": "" };
  const docListeners: Record<string, Listener[]> = {};
  const winListeners: Record<string, Listener[]> = {};
  const document = {
    currentScript: { src: "https://pay.test/embed.js" },
    readyState: "complete",
    body,
    activeElement: null,
    createElement: (tag: string) => new FakeNode(tag),
    querySelectorAll: () => [link],
    addEventListener: (t: string, fn: Listener) => (docListeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: Listener) => (docListeners[t] = (docListeners[t] ?? []).filter((f) => f !== fn)),
  };
  const window: any = {
    location: { href: "https://shop.test/product", origin: "https://shop.test" },
    addEventListener: (t: string, fn: Listener) => (winListeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: Listener) => (winListeners[t] = (winListeners[t] ?? []).filter((f) => f !== fn)),
  };
  class CustomEvent {
    constructor(public type: string, public init: { detail: unknown }) {}
    get detail() {
      return this.init.detail;
    }
  }
  const code = readFileSync(join(__dirname, "..", "public", "embed.js"), "utf8");
  runInNewContext(code, { window, document, URL, CustomEvent });
  const post = (origin: string, source: unknown, data: unknown) => {
    for (const fn of winListeners.message ?? []) fn({ origin, source, data });
  };
  return { window, body, link, post, docListeners };
}

describe("embed.js", () => {
  it("opens an allowed checkout URL in an overlay with the embed parameters", () => {
    const { window, body } = loadEmbed();
    window.SettleKit.open("https://pay.test/l/course-1234");
    const [iframe] = body.find("iframe");
    const src = new URL(iframe!.attrs.src!);
    expect(src.origin).toBe("https://pay.test");
    expect(src.searchParams.get("embed")).toBe("1");
    expect(src.searchParams.get("embed_origin")).toBe("https://shop.test");
  });

  it("refuses URLs outside the checkout it was loaded from", () => {
    const { window } = loadEmbed();
    expect(() => window.SettleKit.open("https://evil.test/l/x")).toThrow(/must be a checkout/);
    expect(() => window.SettleKit.open("https://pay.test/admin")).toThrow(/must be a checkout/);
  });

  it("only trusts success messages from the checkout frame", () => {
    const { window, body, post } = loadEmbed();
    const seen: unknown[] = [];
    window.SettleKit.open("https://pay.test/c/cs_1", { onSuccess: (d: unknown) => seen.push(d) });
    const frame = body.find("iframe")[0]!.contentWindow;
    post("https://evil.test", frame, { type: "settlekit:success", sessionId: "x" });
    post("https://pay.test", {}, { type: "settlekit:success", sessionId: "x" });
    expect(seen).toEqual([]);
    post("https://pay.test", frame, { type: "settlekit:success", sessionId: "cs_1", paymentId: "pay_1" });
    expect(seen).toEqual([{ sessionId: "cs_1", paymentId: "pay_1" }]);
    post("https://pay.test", frame, { type: "settlekit:close" });
    expect(body.find("iframe")).toHaveLength(0);
  });

  it("binds data-settlekit-checkout links and emits a DOM event on success", () => {
    const { link, body, post } = loadEmbed();
    const events: unknown[] = [];
    link.addEventListener("settlekit:success", (e) => events.push(e.detail));
    let prevented = false;
    link.dispatchEvent({ type: "click", currentTarget: link, preventDefault: () => (prevented = true) } as never);
    expect(prevented).toBe(true);
    const frame = body.find("iframe")[0]!.contentWindow;
    post("https://pay.test", frame, { type: "settlekit:success", sessionId: "cs_9", paymentId: "pay_9" });
    expect(events).toEqual([{ sessionId: "cs_9", paymentId: "pay_9" }]);
  });
});

describe("embed origin allow-list", () => {
  it("accepts plain https origins only", () => {
    expect(isOrigin("https://shop.example.com")).toBe(true);
    expect(isOrigin("http://localhost:3000")).toBe(true);
    expect(isOrigin("https://shop.example.com/path")).toBe(false);
    expect(isOrigin("http://shop.example.com")).toBe(false);
    expect(allowedTarget("https://SHOP.test", ["https://shop.test"])).toBe("https://shop.test");
    expect(allowedTarget("https://evil.test", ["https://shop.test"])).toBeNull();
    expect(allowedTarget(null, ["https://shop.test"])).toBeNull();
  });

  it("reads the seller's origins for a session", async () => {
    const base = harness();
    const backend = { ...base.deps.backend, embedOrigins: async () => ["https://shop.test", "javascript:alert(1)"] };
    const session = await openSession({ ...base, deps: { ...base.deps, backend } }, "base");
    expect(await embedOriginsForSession(session.id, backend)).toEqual(["https://shop.test"]);
    expect(await embedOriginsForSession("cs_missing", backend)).toEqual([]);
    expect(await embedOriginsForSession(session.id, base.deps.backend)).toEqual([]);
  });
});
