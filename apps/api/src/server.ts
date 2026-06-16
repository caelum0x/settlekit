/**
 * Production entrypoint: build the app + context once and serve it over Node via
 * `@hono/node-server`. Configurable through `PORT` (default 8787) and `HOST`.
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createContext } from "./context.js";

/** Create the server (without starting it) — handy for embedding / testing. */
export async function createServer() {
  const ctx = await createContext();
  return createApp(ctx);
}

/** Emit a structured startup/shutdown log line (matches the request logger). */
function log(message: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), app: "api", level: "info", msg: message, ...fields })}\n`,
  );
}

/** Start listening. Returns the running server handle. */
export async function startServer(port = Number(process.env.PORT ?? 8787)) {
  const app = await createServer();
  const server = serve({ fetch: app.fetch, port }, (info) => {
    log("api listening", { port: info.port, url: `http://localhost:${info.port}` });
  });

  // Graceful shutdown: stop accepting new connections and let in-flight requests
  // drain, then exit. A second signal (or a 10s timeout) forces exit.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      log("api force exit", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    log("api shutting down", { signal });
    const force = setTimeout(() => {
      log("api shutdown timed out; forcing exit", {});
      process.exit(1);
    }, 10_000);
    force.unref();
    server.close(() => {
      log("api shut down cleanly", {});
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
}

// Start automatically when run directly (node dist/server.js).
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  startServer();
}
