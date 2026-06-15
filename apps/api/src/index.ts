/**
 * @settlekit/api — public entrypoint.
 *
 * Re-exports the app factory, context builder, and server helpers so the API can
 * be embedded (e.g. in the worker app or tests) or run standalone via server.ts.
 */
export { createApp } from "./app.js";
export { createContext, type AppContext, type AppEnv } from "./context.js";
export { createServer, startServer } from "./server.js";
export { data, created, error } from "./http/respond.js";
