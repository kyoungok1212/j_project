import { decodeCursor, encodeCursor } from "../lib/pagination";
import { fail, ok } from "../lib/http";
import {
  getRequiredHeader,
  hashPayload,
  makeId,
  parseIntInRange,
  parseJson
} from "../lib/utils";
import type { Env } from "../types";

interface SessionRow {
  id: string;
  user_id: string;
  category: string;
  target_type: string;
  target_id: string | null;
  bpm: number;
  duration_sec: number;
  result: string;
  created_at: string;
}

interface IdempotencyRow {
  response_json: string;
  request_hash: string;
}

interface CreateSessionBody {
  category: string;
  targetType: string;
  targetId?: string;
  bpm: number;
  durationSec: number;
  result: string;
}

function mapSession(row: SessionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    targetType: row.target_type,
    targetId: row.target_id,
    bpm: row.bpm,
    durationSec: row.duration_sec,
    result: row.result,
    createdAt: row.created_at
  };
}

export async function handleProgress(
  request: Request,
  env: Env,
  requestId: string,
  pathParts: string[]
): Promise<Response> {
  const userId = getRequiredHeader(request, "x-user-id", requestId);
  if (userId instanceof Response) return userId;

  if (pathParts[0] === "sessions") {
    if (request.method === "POST") return createSession(request, env, requestId, userId);
    if (request.method === "GET") return listSessions(request, env, requestId, userId);
  }
  if (pathParts[0] === "summary" && request.method === "GET") {
    return getSummary(request, env, requestId, userId);
  }
  return fail(requestId, "VALIDATION_ERROR", "route not found", 404);
}

async function createSession(request: Request, env: Env, requestId: string, userId: string): Promise<Response> {
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey) {
    return fail(requestId, "VALIDATION_ERROR", "Idempotency-Key header is required", 400);
  }

  const body = await parseJson<CreateSessionBody>(request, requestId);
  if (body instanceof Response) return body;

  const validation = validateSession(body);
  if (validation) return fail(requestId, "VALIDATION_ERROR", validation.message, 400, { field: validation.field });

  const rawBody = JSON.stringify(body);
  const requestHash = await hashPayload(rawBody);

  const existing = await env.DB.prepare(
    "SELECT response_json, request_hash FROM idempotency_keys WHERE user_id = ? AND idempotency_key = ? LIMIT 1"
  )
    .bind(userId, idempotencyKey)
    .first<IdempotencyRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      return fail(requestId, "CONFLICT", "idempotency key already used with different payload", 409);
    }
    return ok(JSON.parse(existing.response_json), requestId);
  }

  const sessionId = makeId("session");
  await env.DB.prepare(
    `INSERT INTO practice_sessions(id, user_id, category, target_type, target_id, bpm, duration_sec, result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(sessionId, userId, body.category, body.targetType, body.targetId ?? null, body.bpm, body.durationSec, body.result)
    .run();

  const responseData = { id: sessionId };
  await env.DB.prepare(
    `INSERT INTO idempotency_keys(id, user_id, idempotency_key, request_hash, response_json)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(makeId("idem"), userId, idempotencyKey, requestHash, JSON.stringify(responseData))
    .run();

  return ok(responseData, requestId, 201);
}

async function listSessions(request: Request, env: Env, requestId: string, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseIntInRange(url.searchParams.get("limit"), 20, 1, 100);
  if (limit == null) {
    return fail(requestId, "VALIDATION_ERROR", "limit must be between 1 and 100", 400, { field: "limit" });
  }
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.get("cursor") && !cursor) {
    return fail(requestId, "VALIDATION_ERROR", "invalid cursor", 400, { field: "cursor" });
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const category = url.searchParams.get("category");
  const clauses = ["user_id = ?"];
  const params: unknown[] = [userId];

  if (from) {
    clauses.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("created_at <= ?");
    params.push(to);
  }
  if (category) {
    clauses.push("category = ?");
    params.push(category);
  }
  if (cursor) {
    clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.sortValue, cursor.sortValue, cursor.id);
  }

  const sql = `SELECT id, user_id, category, target_type, target_id, bpm, duration_sec, result, created_at
               FROM practice_sessions
               WHERE ${clauses.join(" AND ")}
               ORDER BY created_at DESC, id DESC
               LIMIT ?`;
  params.push(limit + 1);

  const rows = await env.DB.prepare(sql).bind(...params).all<SessionRow>();
  const resultRows = rows.results ?? [];
  const hasNext = resultRows.length > limit;
  const visibleRows = hasNext ? resultRows.slice(0, limit) : resultRows;
  const items = visibleRows.map(mapSession);
  const last = visibleRows.at(-1);

  return ok(
    { items },
    requestId,
    200,
    {
      limit,
      nextCursor: hasNext && last ? encodeCursor({ sortValue: last.created_at, id: last.id }) : null
    }
  );
}

async function getSummary(request: Request, env: Env, requestId: string, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "week";
  const dateText = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!["week", "month"].includes(period)) {
    return fail(requestId, "VALIDATION_ERROR", "period must be week or month", 400, { field: "period" });
  }

  const base = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    return fail(requestId, "VALIDATION_ERROR", "invalid date", 400, { field: "date" });
  }

  const from = new Date(base);
  if (period === "week") {
    const day = from.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    from.setUTCDate(from.getUTCDate() - diff);
  } else {
    from.setUTCDate(1);
  }
  const to = new Date(from);
  if (period === "week") {
    to.setUTCDate(from.getUTCDate() + 7);
  } else {
    to.setUTCMonth(from.getUTCMonth() + 1);
  }

  const totals = await env.DB.prepare(
    `SELECT COALESCE(SUM(duration_sec), 0) AS total_sec, COUNT(*) AS session_count
     FROM practice_sessions
     WHERE user_id = ? AND created_at >= ? AND created_at < ?`
  )
    .bind(userId, from.toISOString(), to.toISOString())
    .first<{ total_sec: number; session_count: number }>();

  const bpmRows = await env.DB.prepare(
    `SELECT category, MAX(bpm) AS max_bpm
     FROM practice_sessions
     WHERE user_id = ? AND created_at >= ? AND created_at < ? AND result = 'success'
     GROUP BY category`
  )
    .bind(userId, from.toISOString(), to.toISOString())
    .all<{ category: string; max_bpm: number }>();

  const maxStableBpmByCategory: Record<string, number> = {};
  for (const row of bpmRows.results ?? []) {
    maxStableBpmByCategory[row.category] = row.max_bpm;
  }

  return ok(
    {
      period,
      totalPracticeSec: Number(totals?.total_sec ?? 0),
      sessionCount: Number(totals?.session_count ?? 0),
      maxStableBpmByCategory
    },
    requestId
  );
}

function validateSession(body: CreateSessionBody): { field: string; message: string } | null {
  if (!body.category) return { field: "category", message: "category is required" };
  if (!body.targetType) return { field: "targetType", message: "targetType is required" };
  if (typeof body.bpm !== "number" || body.bpm < 40 || body.bpm > 240) {
    return { field: "bpm", message: "bpm must be between 40 and 240" };
  }
  if (!Number.isInteger(body.durationSec) || body.durationSec < 1 || body.durationSec > 14400) {
    return { field: "durationSec", message: "durationSec must be between 1 and 14400" };
  }
  if (!body.result) return { field: "result", message: "result is required" };
  return null;
}

