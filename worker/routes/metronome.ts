import { decodeCursor, encodeCursor } from "../lib/pagination";
import { fail, ok } from "../lib/http";
import { getRequiredHeader, makeId, parseIntInRange, parseJson } from "../lib/utils";
import type { Env } from "../types";

interface MetronomePresetRow {
  id: string;
  name: string;
  bpm: number;
  time_signature: string;
  subdivision: string;
  accent_pattern_json: string;
  created_at: string;
}

interface CreateMetronomePresetBody {
  name: string;
  bpm: number;
  timeSignature: string;
  subdivision: string;
  accentPattern: number[];
}

function mapPreset(row: MetronomePresetRow) {
  return {
    id: row.id,
    name: row.name,
    bpm: row.bpm,
    timeSignature: row.time_signature,
    subdivision: row.subdivision,
    accentPattern: JSON.parse(row.accent_pattern_json),
    createdAt: row.created_at
  };
}

export async function handleMetronome(
  request: Request,
  env: Env,
  requestId: string,
  pathParts: string[]
): Promise<Response> {
  const userId = getRequiredHeader(request, "x-user-id", requestId);
  if (userId instanceof Response) return userId;

  if (pathParts[0] !== "presets") {
    return fail(requestId, "VALIDATION_ERROR", "route not found", 404);
  }

  if (request.method === "GET" && pathParts.length === 1) {
    return listPresets(request, env, requestId, userId);
  }
  if (request.method === "POST" && pathParts.length === 1) {
    return createPreset(request, env, requestId, userId);
  }
  if (request.method === "DELETE" && pathParts.length === 2) {
    return deletePreset(env, requestId, userId, pathParts[1]);
  }

  return fail(requestId, "VALIDATION_ERROR", "route not found", 404);
}

async function listPresets(request: Request, env: Env, requestId: string, userId: string): Promise<Response> {
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
    clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.sortValue, cursor.sortValue, cursor.id);
  }

  const sql = `SELECT id, name, bpm, time_signature, subdivision, accent_pattern_json, created_at
               FROM metronome_presets
               WHERE ${clauses.join(" AND ")}
               ORDER BY created_at DESC, id DESC
               LIMIT ?`;
  params.push(limit + 1);

  const rows = await env.DB.prepare(sql).bind(...params).all<MetronomePresetRow>();
  const results = rows.results ?? [];
  const hasNext = results.length > limit;
  const visible = hasNext ? results.slice(0, limit) : results;
  const items = visible.map(mapPreset);
  const last = visible.at(-1);

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

async function createPreset(request: Request, env: Env, requestId: string, userId: string): Promise<Response> {
  const body = await parseJson<CreateMetronomePresetBody>(request, requestId);
  if (body instanceof Response) return body;

  if (!body.name || body.name.length > 80) {
    return fail(requestId, "VALIDATION_ERROR", "name must be 1 to 80 chars", 400, { field: "name" });
  }
  if (typeof body.bpm !== "number" || body.bpm < 40 || body.bpm > 240) {
    return fail(requestId, "VALIDATION_ERROR", "bpm must be between 40 and 240", 400, { field: "bpm" });
  }
  if (!["3/4", "4/4", "6/8"].includes(body.timeSignature)) {
    return fail(requestId, "VALIDATION_ERROR", "unsupported timeSignature", 400, { field: "timeSignature" });
  }
  if (!Array.isArray(body.accentPattern)) {
    return fail(requestId, "VALIDATION_ERROR", "accentPattern must be an array", 400, { field: "accentPattern" });
  }

  const presetId = makeId("preset");
  await env.DB.prepare(
    `INSERT INTO metronome_presets(id, user_id, name, bpm, time_signature, subdivision, accent_pattern_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(presetId, userId, body.name, body.bpm, body.timeSignature, body.subdivision, JSON.stringify(body.accentPattern))
    .run();

  return ok({ id: presetId }, requestId, 201);
}

async function deletePreset(env: Env, requestId: string, userId: string, presetId: string): Promise<Response> {
  const result = await env.DB.prepare("DELETE FROM metronome_presets WHERE id = ? AND user_id = ?")
    .bind(presetId, userId)
    .run();
  if ((result.meta.changes ?? 0) < 1) {
    return fail(requestId, "NOT_FOUND", "preset not found", 404);
  }
  return ok({ id: presetId, deleted: true }, requestId);
}
