/**
 * Adapter between Express `(req, res)` handlers and web Fetch `(Request) ->
 * Response` handlers.
 *
 * `@settlekit/x402`'s `withSettleKitPayment(...)` wraps a Fetch handler, but
 * Express speaks the classic Node request/response idiom. This module bridges
 * the two: it builds a web `Request` from the Express `req` (method, absolute
 * URL, all headers including `Authorization` / `X-Payment`, and the body), runs
 * the wrapped Fetch handler, then copies the returned `Response` (status,
 * headers, body) back onto the Express `res`.
 */
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import type { FetchHandler } from "./x402.js";

/**
 * Reconstruct the absolute URL of an Express request. The web `Request`
 * constructor requires an absolute URL, so we synthesize one from the forwarded
 * protocol/host (falling back to the socket + Host header).
 */
function absoluteUrl(req: ExpressRequest): string {
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto ?? req.protocol ?? "http";

  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const host = forwardedHost ?? req.get("host") ?? "localhost";

  // `req.originalUrl` preserves the full path + query string as received.
  return `${protocol}://${host}${req.originalUrl}`;
}

/** Normalize a possibly-array header value to its first string entry. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Copy every Express request header onto a web `Headers` object. Array-valued
 * headers (e.g. repeated `Set-Cookie`-style inbound headers) are appended so no
 * value is lost. `Authorization` and `X-Payment` flow through unchanged.
 */
function toWebHeaders(req: ExpressRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry);
      }
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * Read the raw request body as a Buffer. We read the stream ourselves rather
 * than depending on `express.json()` so the adapter is self-contained and the
 * exact bytes are forwarded for any method/content-type.
 */
function readBody(req: ExpressRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Methods that, per the Fetch spec, must not carry a request body. */
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

/**
 * Build a web `Request` faithfully mirroring the inbound Express request.
 */
async function toWebRequest(req: ExpressRequest): Promise<Request> {
  const method = (req.method ?? "GET").toUpperCase();
  const headers = toWebHeaders(req);

  const init: RequestInit = { method, headers };

  if (!BODYLESS_METHODS.has(method)) {
    const body = await readBody(req);
    if (body.length > 0) {
      init.body = body;
    }
  }

  return new Request(absoluteUrl(req), init);
}

/**
 * Write a web `Response` back onto the Express `res`: status, every header, and
 * the body bytes.
 */
async function writeWebResponse(
  webResponse: Response,
  res: ExpressResponse,
): Promise<void> {
  res.status(webResponse.status);

  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const arrayBuffer = await webResponse.arrayBuffer();
  res.end(Buffer.from(arrayBuffer));
}

/**
 * Wrap a Fetch handler (such as the output of `withSettleKitPayment(...)`) as an
 * Express request handler. Any error converting/serving is turned into a clean
 * 500 so a thrown handler never leaks a stack trace to the client.
 */
export function expressFromFetch(handler: FetchHandler) {
  return async function expressHandler(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    try {
      const webRequest = await toWebRequest(req);
      const webResponse = await handler(webRequest);
      await writeWebResponse(webResponse, res);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "internal error";
      // Log full context server-side; return a safe envelope to the client.
      console.error("[express-adapter] handler failed:", error);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: { code: "internal_error", message } });
      } else {
        res.end();
      }
    }
  };
}
