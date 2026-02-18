import type { ApiMeta } from "../types";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,x-user-id,idempotency-key"
};

export function buildMeta(requestId: string, pagination?: ApiMeta["pagination"]): ApiMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    pagination
  };
}

export function ok(data: unknown, requestId: string, status = 200, pagination?: ApiMeta["pagination"]): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      meta: buildMeta(requestId, pagination)
    }),
    {
      status,
      headers: JSON_HEADERS
    }
  );
}

export function fail(
  requestId: string,
  code: string,
  message: string,
  status = 400,
  details?: Record<string, unknown>
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code,
        message,
        details
      },
      meta: buildMeta(requestId)
    }),
    {
      status,
      headers: JSON_HEADERS
    }
  );
}

export function options(): Response {
  return new Response(null, {
    status: 204,
    headers: JSON_HEADERS
  });
}

