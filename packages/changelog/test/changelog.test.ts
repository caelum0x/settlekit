import { describe, expect, it } from "vitest";
import { createChangelogEntry, latestChangelog } from "../src/index.js";

describe("changelog", () => {
  it("creates and sorts changelog entries", () => {
    const entry = createChangelogEntry({ version: "0.1.0", title: "Launch", category: "feature" });
    expect(latestChangelog([entry])?.version).toBe("0.1.0");
  });
});
