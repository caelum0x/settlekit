/**
 * Persistence codec for the document-projection pattern.
 *
 * Re-exported from `@settlekit/database` so the API and the worker share one
 * canonical implementation (see that package's `doc.ts` for the rationale).
 */
export { DOC_KEY, packDoc, unpackDoc, unpackDocs } from "@settlekit/database";
