import { afterEach, describe, expect, it, vi } from "vitest";
import { cellText, formatError, printTable } from "../src/output.js";

function captureStdout(fn: () => void): string {
  let buffer = "";
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      buffer += String(chunk);
      return true;
    });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return buffer;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cellText", () => {
  it("flattens Money to '<amount> <currency>'", () => {
    expect(cellText({ amount: "1.00", currency: "USDC" })).toBe("1.00 USDC");
  });

  it("renders nullish as a dash", () => {
    expect(cellText(undefined)).toBe("-");
    expect(cellText(null)).toBe("-");
  });
});

describe("printTable", () => {
  it("prints 'No results.' on empty input", () => {
    const out = captureStdout(() => printTable([], [{ header: "X", value: () => "" }]));
    expect(out).toBe("No results.\n");
  });

  it("aligns columns to the widest cell", () => {
    const rows = [{ id: "a", name: "longvalue" }, { id: "bb", name: "x" }];
    const out = captureStdout(() =>
      printTable(rows, [
        { header: "ID", value: (r) => r.id },
        { header: "NAME", value: (r) => r.name },
      ]),
    );
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe("ID  NAME     ");
    expect(lines[1]).toBe("--  ---------");
    expect(lines[2]).toBe("a   longvalue");
    // out.trimEnd() strips the final line's trailing pad; the table itself pads
    // every cell (verified by the padded header assertion above).
    expect(lines[3]).toBe("bb  x");
  });
});

describe("formatError", () => {
  it("uses the message for Error instances", () => {
    expect(formatError(new Error("boom"))).toBe("Error: boom");
  });

  it("stringifies non-Error values", () => {
    expect(formatError("plain")).toBe("Error: plain");
    expect(formatError(42)).toBe("Error: 42");
  });
});
