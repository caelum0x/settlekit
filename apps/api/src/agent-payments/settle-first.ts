/**
 * "Settle first, then deliver" x402 middleware for purchases.
 *
 * `@x402/hono`'s `paymentMiddleware` verifies, runs the handler and settles
 * AFTER it (right for metered content). A purchase must never deliver an
 * artifact for a payment that has not settled, so this middleware drives the
 * same `x402HTTPResourceServer` with the `upfront` payment flow: the
 * facilitator settles BEFORE the handler, the handler reads the settlement
 * (`c.get("x402Settled")`) to record the payment and deliver, and the
 * PAYMENT-RESPONSE receipt is echoed on whatever the handler returns.
 */
import type { Context, MiddlewareHandler } from "hono";
import { basePath } from "hono/route";
import { HonoAdapter } from "@x402/hono";
import {
  getFacilitatorResponseError,
  type HTTPRequestContext,
  type x402HTTPResourceServer,
} from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";

/** Hono adapter that keeps the Hono context reachable from dynamic prices. */
export class ContextAdapter extends HonoAdapter {
  constructor(readonly context: Context) {
    super(context);
  }
}

export interface SettledPayment {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  settlement: SettleResponse;
}

export interface SettleFirstVariables {
  x402Settled?: SettledPayment;
}

function decodedRoutePath(c: Context): string {
  let path: string;
  try {
    path = decodeURIComponent(c.req.path);
  } catch {
    path = c.req.path;
  }
  let root = "";
  try {
    root = basePath(c);
  } catch {
    return path;
  }
  if (!root || root === "/" || !path.startsWith(root)) return path;
  if (path === root) return "";
  return path[root.length] === "/" ? path.slice(root.length) : path;
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const merged = new Headers(res.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: merged });
}

/** Build the middleware. Routes it guards must declare `extra.paymentFlow: "upfront"`. */
export function settleFirstPayment(httpServer: x402HTTPResourceServer): MiddlewareHandler {
  let init: Promise<void> | null = null;
  const initialize = async (): Promise<void> => {
    init ??= httpServer.initialize();
    try {
      await init;
    } catch (error) {
      init = null;
      throw error;
    }
  };

  return async (c, next) => {
    const adapter = new ContextAdapter(c);
    const context: HTTPRequestContext = {
      adapter,
      path: c.req.path,
      decodedPath: decodedRoutePath(c),
      method: c.req.method,
      ...(adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment")
        ? { paymentHeader: (adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment")) as string }
        : {}),
    };
    if (!httpServer.requiresPayment(context)) return next();

    let result: Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>;
    try {
      await initialize();
      result = await httpServer.processHTTPRequest(context);
    } catch (error) {
      const facilitatorError = getFacilitatorResponseError(error);
      if (facilitatorError) return c.json({ error: { code: "facilitator_error", message: facilitatorError.message } }, 502);
      throw error;
    }

    if (result.type === "no-payment-required") return next();
    if (result.type === "payment-error") {
      const { response } = result;
      for (const [key, value] of Object.entries(response.headers)) c.header(key, value);
      if (response.isHtml) return c.html(String(response.body ?? ""), response.status as 402);
      return c.json(response.body ?? {}, response.status as 402);
    }

    const settled = result.beforeHandlerSettlement;
    if (!settled || !settled.result.success) {
      await result.cancellationDispatcher.cancel({ reason: "after_verify_aborted" });
      return c.json({ error: { code: "configuration_error", message: "purchase routes must settle before delivery" } }, 500);
    }
    c.set("x402Settled" as never, {
      payload: result.paymentPayload,
      requirements: settled.requirements,
      settlement: settled.result,
    } satisfies SettledPayment as never);

    try {
      await next();
    } finally {
      const echo = await httpServer.processSettlement(
        result.paymentPayload,
        result.paymentRequirements,
        result.declaredExtensions,
        { request: context },
        undefined,
        settled,
      );
      c.res = withHeaders(c.res, echo.headers);
    }
  };
}
