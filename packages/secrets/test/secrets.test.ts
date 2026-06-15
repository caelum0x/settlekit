import { describe, expect, it } from "vitest";
import { createSecretReference, rotateSecretReference } from "../src/index.js";

describe("secrets", () => {
  it("creates and rotates secret references", () => {
    const { reference, plaintext } = createSecretReference("whsec");
    expect(plaintext.length).toBeGreaterThan(20);
    expect(rotateSecretReference(reference).version).toBe(2);
  });
});
