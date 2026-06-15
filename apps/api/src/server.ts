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

/** Start listening. Returns the running server handle. */
export async function startServer(port = Number(process.env.PORT ?? 8787)) {
  const app = await createServer();
  const server = serve({ fetch: app.fetch, port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`SettleKit API listening on http://localhost:${info.port}`);
  });
  return server;
}

// Start automatically when run directly (node dist/server.js).
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  startServer();
}
