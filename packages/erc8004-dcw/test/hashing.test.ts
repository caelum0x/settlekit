import { describe, expect, it, vi } from "vitest";
import { feedbackHash, requestHash, utf8ToHex } from "../src/index.js";

describe("utf8ToHex", () => {
  it("encodes a string to lowercase 0x-prefixed UTF-8 hex", () => {
    expect(utf8ToHex("AB")).toBe("0x4142");
  });

  it("maps the empty string to 0x", () => {
    expect(utf8ToHex("")).toBe("0x");
  });
});

describe("feedbackHash", () => {
  it("calls the injected keccak256 with toHex(tag) and returns its output", () => {
    const keccak = vi.fn(() => "0xfeed");
    const toHex = vi.fn((s: string) => `0x${s}`);

    const result = feedbackHash("successful_trade", keccak, toHex);

    expect(toHex).toHaveBeenCalledTimes(1);
    expect(toHex).toHaveBeenCalledWith("successful_trade");
    expect(keccak).toHaveBeenCalledTimes(1);
    expect(keccak).toHaveBeenCalledWith("0xsuccessful_trade");
    expect(result).toBe("0xfeed");
  });

  it("defaults toHex to utf8ToHex when not provided", () => {
    const keccak = vi.fn((hex: string) => `keccak(${hex})`);
    const result = feedbackHash("AB", keccak);
    expect(keccak).toHaveBeenCalledTimes(1);
    expect(keccak).toHaveBeenCalledWith("0x4142");
    expect(result).toBe("keccak(0x4142)");
  });
});

describe("requestHash", () => {
  it("calls the injected keccak256 with toHex(subject) and returns its output", () => {
    const keccak = vi.fn(() => "0xreq");
    const toHex = vi.fn((s: string) => `0x${s}`);

    const result = requestHash("subject-1", keccak, toHex);

    expect(toHex).toHaveBeenCalledTimes(1);
    expect(toHex).toHaveBeenCalledWith("subject-1");
    expect(keccak).toHaveBeenCalledTimes(1);
    expect(keccak).toHaveBeenCalledWith("0xsubject-1");
    expect(result).toBe("0xreq");
  });
});
