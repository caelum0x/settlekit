import { describe, expect, it } from "vitest";
import { createAuditLogEntry, filterAuditLogByResource } from "../src/index.js";

describe("audit log", () => {
  it("records resource-scoped events", () => {
    const entry = createAuditLogEntry({ organizationId: "org_1", actorType: "user", actorId: "user_1", action: "product.publish", resourceType: "product", resourceId: "prod_1", metadata: {} });
    expect(filterAuditLogByResource([entry], "product", "prod_1")).toHaveLength(1);
  });
});
