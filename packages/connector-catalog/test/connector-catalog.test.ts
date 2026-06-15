import { describe, expect, it } from "vitest";
import { connectorReady, enabledConnectors } from "../src/index.js";

describe("connector catalog", () => {
  it("filters enabled and ready connectors", () => {
    const connector = { key: "github", name: "GitHub", category: "access" as const, requiredSecrets: ["GITHUB_APP_ID"], enabled: true };
    expect(enabledConnectors([connector])).toHaveLength(1);
    expect(connectorReady(connector, ["GITHUB_APP_ID"])).toBe(true);
  });
});
