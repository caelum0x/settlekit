/**
 * File delivery routes (plan §5).
 *
 * Issues HMAC-signed, usage-limited download URLs via the real
 * `@settlekit/file-delivery` `FileDeliveryService`, and redeems them by
 * verifying the signature/expiry and atomically consuming one download.
 */
import { Hono } from "hono";
import { z } from "zod";
import { validationError } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";

const issueSchema = z.object({
  fileId: z.string().min(1),
  customerId: z.string().min(1),
  expiresInSec: z.number().int().positive().optional(),
  maxDownloads: z.number().int().positive().optional(),
});

export function fileRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Issue a signed download URL + grant.
  app.post("/downloads", async (c) => {
    const body = await parseBody(c, issueSchema);
    const issued = await c.get("ctx").files.issueDownload({
      file: { id: body.fileId },
      customerId: body.customerId,
      ...(body.expiresInSec !== undefined ? { expiresInSec: body.expiresInSec } : {}),
      ...(body.maxDownloads !== undefined ? { maxDownloads: body.maxDownloads } : {}),
    });
    return created(c, issued);
  });

  // Redeem a signed download URL (the full URL is passed as ?url=).
  app.get("/download", async (c) => {
    const url = c.req.query("url");
    if (!url) throw validationError("query param 'url' is required");
    const result = await c.get("ctx").files.redeemDownload(url);
    return data(c, unwrapResult(result));
  });

  return app;
}
