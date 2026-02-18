import { decodeCursor, encodeCursor } from "../lib/pagination";
import { fail, ok } from "../lib/http";
import { getRequiredHeader, makeId, parseIntInRange, parseJson } from "../lib/utils";
import type { Env } from "../types";

interface PhraseRow {
  id: string;
  user_id: string;
  title: string;
  musical_key: string;
  time_signature: string;
  bpm: number;
  content_json: string;
  loop_start: number;
  loop_end: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CreatePhraseBody {
  title: string;
  musicalKey: string;
  timeSignature: string;
  bpm: number;
  content: unknown;
  loopStart: number;
  loopEnd: number;
}

interface PatchPhraseBody {
  title?: string;
  musicalKey?: string;
  timeSignature?: string;
  bpm?: number;
  content?: unknown;
  loopStart?: number;
  loopEnd?: number;
  version: number;
}

function mapPhrase(row: PhraseRow) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    musicalKey: row.musical_key,
    timeSignature: row.time_signature,
    bpm: row.bpm,
    content: JSON.parse(row.content_json),
    loopStart: row.loop_start,
    loopEnd: row.loop_end,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function handlePhrases(
  request: Request,
  env: Env,
  requestId: string,
  pathParts: string[]
): Promise<Response> {
  const userId = getRequiredHeader(request, "x-user-id", requestId);
  if (userId instanceof Response) return userId;

  if (request.method === "GET" && pathParts.length === 0) return listPhrases(request, env, requestId, userId);
  if (request.method === "POST" && pathParts.length === 0) return createPhrase(request, env, requestId, userId);
  if (request.method === "GET" && pathParts.length === 1) return getPhrase(env, requestId, userId, pathParts[0]);
  if (request.method === "PATCH" && pathParts.length === 1) return patchPhrase(request, env, requestId, userId, pathParts[0]);
  if (request.method === "DELETE" && pathParts.length === 1) return deletePhrase(env, requestId, userId, pathParts[0]);

  return fail(requestId, "VALIDATION_ERROR", "route not found", 404);
}

async function listPhrases(request: Request, env: Env, requestId: string, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseIntInRange(url.searchParams.get("limit"), 20, 1, 100);
  if (limit == null) {
    return fail(requestId, "VALIDATION_ERROR", "limit must be between 1 and 100", 400, { field: "limit" });
  }
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.get("cursor") && !cursor) {
    return fail(requestId, "VALIDATION_ERROR", "invalid cursor", 400, { field: "cursor" });
  }

  const clauses = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (cursor) {
    clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    params.push(cursor.sortValue, cursor.sortValue, cursor.id);
  }

  const sql = `SELECT id, user_id, title, musical_key, time_signature, bpm, content_json, loop_start, loop_end, version, created_at, updated_at
               FROM phrases
               WHERE ${clauses.join(" AND ")}
               ORDER BY updated_at DESC, id DESC
               LIMIT ?`;
  params.push(limit + 1);

  const rows = await env.DB.prepare(sql).bind(...params).all<PhraseRow>();
  const resultRows = rows.results ?? [];
  const hasNext = resultRows.length > limit;
  const visibleRows = hasNext ? resultRows.slice(0, limit) : resultRows;
  const items = visibleRows.map(mapPhrase);
  const last = visibleRows.at(-1);

  return ok(
    { items },
    requestId,
    200,
    {
      limit,
      nextCursor: hasNext && last ? encodeCursor({ sortValue: last.updated_at, id: last.id }) : null
    }
  );
}

async function createPhrase(request: Request, env: Env, requestId: string, userId: string): Promise<Response> {
  const body = await parseJson<CreatePhraseBody>(request, requestId);
  if (body instanceof Response) return body;

  const validation = validatePhrasePayload(body);
  if (validation) return fail(requestId, "VALIDATION_ERROR", validation.message, 400, { field: validation.field });

  const phraseId = makeId("phrase");
  await env.DB.prepare(
    `INSERT INTO phrases(id, user_id, title, musical_key, time_signature, bpm, content_json, loop_start, loop_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      phraseId,
      userId,
      body.title,
      body.musicalKey,
      body.timeSignature,
      body.bpm,
      JSON.stringify(body.content),
      body.loopStart,
      body.loopEnd
    )
    .run();

  return ok({ id: phraseId, version: 1 }, requestId, 201);
}

async function getPhrase(env: Env, requestId: string, userId: string, phraseId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, user_id, title, musical_key, time_signature, bpm, content_json, loop_start, loop_end, version, created_at, updated_at
     FROM phrases WHERE id = ? AND user_id = ? LIMIT 1`
  )
    .bind(phraseId, userId)
    .first<PhraseRow>();

  if (!row) return fail(requestId, "NOT_FOUND", "phrase not found", 404);
  return ok(mapPhrase(row), requestId);
}

async function patchPhrase(
  request: Request,
  env: Env,
  requestId: string,
  userId: string,
  phraseId: string
): Promise<Response> {
  const body = await parseJson<PatchPhraseBody>(request, requestId);
  if (body instanceof Response) return body;
  if (typeof body.version !== "number") {
    return fail(requestId, "VALIDATION_ERROR", "version is required", 400, { field: "version" });
  }

  const current = await env.DB.prepare(
    `SELECT id, user_id, title, musical_key, time_signature, bpm, content_json, loop_start, loop_end, version, created_at, updated_at
     FROM phrases WHERE id = ? AND user_id = ? LIMIT 1`
  )
    .bind(phraseId, userId)
    .first<PhraseRow>();
  if (!current) return fail(requestId, "NOT_FOUND", "phrase not found", 404);
  if (current.version !== body.version) {
    return fail(requestId, "CONFLICT", "phrase version conflict", 409, { currentVersion: current.version });
  }

  const next = {
    title: body.title ?? current.title,
    musicalKey: body.musicalKey ?? current.musical_key,
    timeSignature: body.timeSignature ?? current.time_signature,
    bpm: body.bpm ?? current.bpm,
    content: body.content ?? JSON.parse(current.content_json),
    loopStart: body.loopStart ?? current.loop_start,
    loopEnd: body.loopEnd ?? current.loop_end
  };
  const validation = validatePhrasePayload(next);
  if (validation) return fail(requestId, "VALIDATION_ERROR", validation.message, 400, { field: validation.field });

  const updatedAt = new Date().toISOString();
  const nextVersion = current.version + 1;
  const result = await env.DB.prepare(
    `UPDATE phrases
     SET title = ?, musical_key = ?, time_signature = ?, bpm = ?, content_json = ?, loop_start = ?, loop_end = ?, version = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND version = ?`
  )
    .bind(
      next.title,
      next.musicalKey,
      next.timeSignature,
      next.bpm,
      JSON.stringify(next.content),
      next.loopStart,
      next.loopEnd,
      nextVersion,
      updatedAt,
      phraseId,
      userId,
      body.version
    )
    .run();

  if ((result.meta.changes ?? 0) < 1) {
    return fail(requestId, "CONFLICT", "phrase version conflict", 409);
  }

  return ok({ id: phraseId, version: nextVersion }, requestId);
}

async function deletePhrase(env: Env, requestId: string, userId: string, phraseId: string): Promise<Response> {
  const result = await env.DB.prepare("DELETE FROM phrases WHERE id = ? AND user_id = ?").bind(phraseId, userId).run();
  if ((result.meta.changes ?? 0) < 1) return fail(requestId, "NOT_FOUND", "phrase not found", 404);
  return ok({ id: phraseId, deleted: true }, requestId);
}

function validatePhrasePayload(payload: {
  title: string;
  bpm: number;
  timeSignature: string;
  loopStart: number;
  loopEnd: number;
}): { field: string; message: string } | null {
  if (!payload.title || payload.title.length > 120) {
    return { field: "title", message: "title must be 1 to 120 chars" };
  }
  if (typeof payload.bpm !== "number" || payload.bpm < 40 || payload.bpm > 240) {
    return { field: "bpm", message: "bpm must be between 40 and 240" };
  }
  if (!["3/4", "4/4", "6/8"].includes(payload.timeSignature)) {
    return { field: "timeSignature", message: "unsupported timeSignature" };
  }
  if (payload.loopStart >= payload.loopEnd) {
    return { field: "loopStart", message: "loopStart must be less than loopEnd" };
  }
  return null;
}

