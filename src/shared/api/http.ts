import type { ApiEnvelope } from "../types/api";

const DEFAULT_USER_ID = "local-user";

function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (!configured) {
    if (typeof window !== "undefined" && window.location.hostname === "j-project.pages.dev") {
      return "https://jproject.metal5757.workers.dev/api/v1";
    }
    return "/api/v1";
  }

  const normalized = configured.replace(/\/+$/, "");
  if (normalized.endsWith("/api/v1")) {
    return normalized;
  }
  if (normalized.endsWith("/api")) {
    return `${normalized}/v1`;
  }
  return `${normalized}/api/v1`;
}

const API_BASE_URL = resolveApiBaseUrl();

export async function apiRequest<T>(
  path: string,
  init?: RequestInit & { requireUser?: boolean; idempotencyKey?: string; timeoutMs?: number }
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (init?.requireUser) {
    headers.set("x-user-id", DEFAULT_USER_ID);
  }
  if (init?.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  }

  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 8000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    if (!raw) {
      throw new Error(
        `API 응답이 비어 있습니다 (status ${response.status}). 워커 서버(127.0.0.1:8787)를 확인해 주세요.`
      );
    }

    if (!contentType.includes("application/json")) {
      const preview = raw.slice(0, 120).replace(/\s+/g, " ").trim();
      throw new Error(
        `JSON이 아닌 API 응답입니다 (status ${response.status}, content-type: ${contentType || "unknown"}): ${preview}`
      );
    }

    let json: ApiEnvelope<T>;
    try {
      json = JSON.parse(raw) as ApiEnvelope<T>;
    } catch {
      throw new Error(`잘못된 JSON API 응답입니다 (status ${response.status}).`);
    }

    if (!json.success) {
      throw new Error(`${json.error.code}: ${json.error.message}`);
    }
    return json.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("API 요청 시간이 초과되었습니다. 워커 서버(127.0.0.1:8787)를 확인해 주세요.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
