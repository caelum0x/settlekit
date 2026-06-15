import { describe, it, expect } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  ResendTransport,
  buildResendRequest,
  createEmailClient,
  type EmailTransport,
  type EmailPayload,
  type SendResult,
} from "../src/index.js";

const FROM = "SettleKit <receipts@settlekit.dev>";

describe("buildResendRequest", () => {
  it("builds the correct Resend HTTP request shape", () => {
    const payload: EmailPayload = {
      to: "buyer@example.com",
      subject: "Receipt",
      html: "<p>hi</p>",
      text: "hi",
    };
    const { url, init } = buildResendRequest(payload, FROM, "re_test_key");

    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: FROM,
      to: "buyer@example.com",
      subject: "Receipt",
      html: "<p>hi</p>",
      text: "hi",
    });
  });

  it("maps replyTo/cc/bcc to snake_case and omits absent fields", () => {
    const payload: EmailPayload = {
      to: ["a@x.com", "b@x.com"],
      subject: "S",
      html: "<b>x</b>",
      replyTo: "noreply@settlekit.dev",
      cc: "cc@x.com",
    };
    const { init } = buildResendRequest(payload, FROM, "k");
    const body = JSON.parse(init.body as string);
    expect(body.reply_to).toBe("noreply@settlekit.dev");
    expect(body.cc).toBe("cc@x.com");
    expect(body).not.toHaveProperty("text");
    expect(body).not.toHaveProperty("bcc");
    expect(body.to).toEqual(["a@x.com", "b@x.com"]);
  });
});

describe("ResendTransport.send", () => {
  it("POSTs to the Resend API and returns the message id", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });
    };

    const transport = new ResendTransport({ apiKey: "re_live", fetchImpl });
    const result = await transport.send(
      { to: "x@y.com", subject: "S", html: "<p>h</p>" },
      FROM,
    );

    expect(result).toEqual({ id: "msg_123" });
    expect(capturedUrl).toBe("https://api.resend.com/emails");
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe("Bearer re_live");
  });

  it("uses payload.from override when present", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = JSON.parse((init?.body as string) ?? "{}");
      return new Response(JSON.stringify({ id: "m" }), { status: 200 });
    };
    const transport = new ResendTransport({ apiKey: "k", fetchImpl });
    await transport.send({ to: "x@y.com", subject: "S", html: "<p>h</p>", from: "Custom <c@d.com>" }, FROM);
    expect(body.from).toBe("Custom <c@d.com>");
  });

  it("throws a retryable SettleKitError on 429", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ name: "rate_limit", message: "slow down" }), { status: 429 });
    const transport = new ResendTransport({ apiKey: "k", fetchImpl });
    await expect(
      transport.send({ to: "x@y.com", subject: "S", html: "<p>h</p>" }, FROM),
    ).rejects.toMatchObject({ code: "integration_error", retryable: true });
  });

  it("throws a non-retryable SettleKitError on 422", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "bad from" }), { status: 422 });
    const transport = new ResendTransport({ apiKey: "k", fetchImpl });
    let caught: unknown;
    try {
      await transport.send({ to: "x@y.com", subject: "S", html: "<p>h</p>" }, FROM);
    } catch (e) {
      caught = e;
    }
    expect(SettleKitError.is(caught)).toBe(true);
    expect((caught as SettleKitError).retryable).toBe(false);
    expect((caught as SettleKitError).message).toBe("bad from");
  });

  it("requires an apiKey", () => {
    expect(() => new ResendTransport({ apiKey: "" })).toThrow(SettleKitError);
  });
});

describe("createEmailClient", () => {
  it("drives a custom (in-memory) transport without network calls", async () => {
    const sent: Array<{ payload: EmailPayload; from: string }> = [];
    const memory: EmailTransport = {
      async send(payload, from): Promise<SendResult> {
        sent.push({ payload, from });
        return { id: `mem_${sent.length}` };
      },
    };

    const client = createEmailClient({ from: FROM, transport: memory });
    const res = await client.send({ to: "buyer@example.com", subject: "Receipt", html: "<p>hi</p>", text: "hi" });

    expect(res.id).toBe("mem_1");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.from).toBe(FROM);
    expect(sent[0]!.payload.subject).toBe("Receipt");
  });

  it("validates recipient addresses", async () => {
    const memory: EmailTransport = { async send() { return { id: "x" }; } };
    const client = createEmailClient({ from: FROM, transport: memory });
    await expect(client.send({ to: "not-an-email", subject: "S", html: "<p>h</p>" })).rejects.toThrow(
      SettleKitError,
    );
  });

  it("requires a from address", () => {
    expect(() => createEmailClient({ from: "" })).toThrow(SettleKitError);
  });

  it("requires an apiKey when no transport is supplied", () => {
    expect(() => createEmailClient({ from: FROM })).toThrow(SettleKitError);
  });
});
