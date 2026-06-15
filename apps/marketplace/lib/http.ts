import type { ApiResponse } from "@/lib/types";

/** Serialize a successful API envelope as a JSON Response. */
export function jsonOk<T>(data: T, total?: number): Response {
  const body: ApiResponse<T> = {
    success: true,
    data,
    error: null,
    ...(total !== undefined ? { meta: { total } } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Serialize an error API envelope as a JSON Response. */
export function jsonError(message: string, status = 400): Response {
  const body: ApiResponse<null> = {
    success: false,
    data: null,
    error: message,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
