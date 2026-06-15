import { describe, it, expect } from "vitest";
import {
  createDefaultRegistry,
  createRegistry,
  HandlerRegistry,
  issueLicenseKeyHandler,
  sendWebhookHandler,
  allHandlers,
} from "../src/index.js";
import type { ActionHandler, DeliveryActionType } from "../src/index.js";

describe("HandlerRegistry", () => {
  it("dispatches each action type to its registered handler", () => {
    const registry = createDefaultRegistry();
    const types: DeliveryActionType[] = [
      "github_invite",
      "github_team_add",
      "license_key_create",
      "api_key_create",
      "file_access_grant",
      "discord_role_add",
      "saas_entitlement_create",
      "webhook_send",
      "email_send",
    ];
    for (const type of types) {
      const handler = registry.get(type);
      expect(handler, `handler for ${type}`).toBeDefined();
      expect(handler?.type).toBe(type);
    }
  });

  it("resolve() returns the handler and registeredTypes lists all of them", () => {
    const registry = createDefaultRegistry();
    expect(registry.resolve("license_key_create").type).toBe("license_key_create");
    expect(registry.registeredTypes()).toHaveLength(allHandlers().length);
    expect(registry.has("webhook_send")).toBe(true);
  });

  it("get() returns undefined and resolve() throws for an unregistered type", () => {
    const registry = createRegistry([issueLicenseKeyHandler()]);
    expect(registry.get("webhook_send")).toBeUndefined();
    expect(() => registry.resolve("webhook_send")).toThrowError(/No delivery handler/);
  });

  it("rejects duplicate handler registration with a conflict error", () => {
    const registry = new HandlerRegistry();
    registry.register(sendWebhookHandler());
    expect(() => registry.register(sendWebhookHandler())).toThrowError(/Duplicate/);
  });

  it("createRegistry builds from an explicit handler list", () => {
    const handlers: ActionHandler[] = [issueLicenseKeyHandler(), sendWebhookHandler()];
    const registry = createRegistry(handlers);
    expect(registry.registeredTypes().sort()).toEqual(
      ["license_key_create", "webhook_send"].sort(),
    );
  });
});
