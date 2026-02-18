import { fail } from "./http";

export function makeRequestId(): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `req_${Date.now().toString(36)}${hex}`;
}

export function makeId(prefix = "id"): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${Date.now().toString(36)}${hex}`;
}

export async function parseJson<T>(request: Request, requestId: string): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return fail(requestId, "VALIDATION_ERROR", "invalid json body", 400);
  }
}

export function getRequiredHeader(request: Request, headerName: string, requestId: string): string | Response {
  const value = request.headers.get(headerName);
  if (!value) {
    return fail(requestId, "UNAUTHORIZED", `${headerName} header is required`, 401);
  }
  return value;
}

export function parseIntInRange(
  raw: string | null,
  defaultValue: number,
  min: number,
  max: number
): number | null {
  if (raw == null) return defaultValue;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < min || value > max) return null;
  return value;
}

export async function hashPayload(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

