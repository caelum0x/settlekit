import { describe, expect, it } from "vitest";
import { jsonExport, toCsv } from "../src/index.js";

describe("exports", () => {
  it("exports CSV and JSON", () => {
    const rows = [{ id: "pay_1", amount: "10" }];
    expect(toCsv(rows, [{ header: "id", value: (row) => row.id }])).toContain('"pay_1"');
    expect(jsonExport(rows)).toContain("amount");
  });
});
