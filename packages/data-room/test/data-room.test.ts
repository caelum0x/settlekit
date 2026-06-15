import { describe, expect, it } from "vitest";
import { canAccessDataRoomDocument, grantDataRoomAccess } from "../src/index.js";

describe("data room", () => {
  it("grants customer access to restricted documents", () => {
    const document = { id: "doc_1", title: "Report", classification: "restricted" as const, allowedCustomerIds: [] };
    expect(canAccessDataRoomDocument(document, "cus_1")).toBe(false);
    expect(canAccessDataRoomDocument(grantDataRoomAccess(document, "cus_1"), "cus_1")).toBe(true);
  });
});
