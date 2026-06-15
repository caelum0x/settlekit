import { describe, expect, it } from "vitest";
import { renderEmailTemplate, templateRequiresProductName } from "../src/index.js";

describe("email templates", () => {
  it("renders transactional email text", () => {
    expect(renderEmailTemplate("access_granted", { productName: "Repo Pro" }).text).toContain("Repo Pro");
    expect(templateRequiresProductName("receipt")).toBe(true);
  });
});
