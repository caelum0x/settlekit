/**
 * Maps each {@link DeliveryActionType} to the {@link ActionHandler} that knows
 * how to execute and roll it back. The runner dispatches through this registry.
 */

import type { DeliveryAction, DeliveryActionType } from "@settlekit/common";
import { SettleKitError } from "@settlekit/common";
import type { ActionHandler } from "./types.js";

export class HandlerRegistry {
  private readonly handlers = new Map<DeliveryActionType, ActionHandler>();

  /**
   * Register a handler. Throws on a duplicate registration so misconfigured
   * apps fail fast at startup rather than silently shadowing a handler.
   */
  register<A extends DeliveryAction>(handler: ActionHandler<A>): this {
    if (this.handlers.has(handler.type)) {
      throw new SettleKitError({
        code: "conflict",
        message: `Duplicate delivery handler registered for action "${handler.type}"`,
        details: { type: handler.type },
      });
    }
    // The map is keyed by the same discriminant the handler narrows on, so this
    // widening to the base ActionHandler is sound for dispatch.
    this.handlers.set(handler.type, handler as ActionHandler);
    return this;
  }

  /** Returns the handler for `type`, or `undefined` if none is registered. */
  get(type: DeliveryActionType): ActionHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * Returns the handler for `type` or throws a `not_found` SettleKitError. Used
   * by the runner where a missing handler is an unrecoverable configuration bug.
   */
  resolve(type: DeliveryActionType): ActionHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new SettleKitError({
        code: "not_found",
        message: `No delivery handler registered for action "${type}"`,
        details: { type },
      });
    }
    return handler;
  }

  /** True if a handler exists for `type`. */
  has(type: DeliveryActionType): boolean {
    return this.handlers.has(type);
  }

  /** All registered action types, in insertion order. */
  registeredTypes(): DeliveryActionType[] {
    return [...this.handlers.keys()];
  }
}

/**
 * Build a registry from a list of handlers in one call. Convenience for app
 * wiring: `createRegistry([grantGithubRepoHandler(), ...])`.
 */
export function createRegistry(handlers: ReadonlyArray<ActionHandler>): HandlerRegistry {
  const registry = new HandlerRegistry();
  for (const handler of handlers) {
    registry.register(handler);
  }
  return registry;
}
