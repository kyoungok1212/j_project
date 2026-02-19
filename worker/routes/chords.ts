import { decodeCursor, encodeCursor } from "../lib/pagination";
import { fail, ok } from "../lib/http";
import { getRequiredHeader, parseIntInRange, parseJson } from "../lib/utils";
import type { Env } from "../types";

interface ChordRow {
  id: string;
  name: string;
  type: string;
  root: string;
  tones_json: string;
  fingering_json: string;
}

interface ChordManualStateRow {
  user_id: string;
  voicings_json: string;
  mutes_json: string;
  barres_json: string;
}

interface ChordManualStatePayload {
  voicings?: unknown;
  mutes?: unknown;
  barres?: unknown;
}

function mapChord(row: ChordRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    root: row.root,
    tones: JSON.parse(row.tones_json),
    fingering: JSON.parse(row.fingering_json)
  };
}

export async function handleChords(
  request: Request,
  env: Env,
  requestId: string,
  pathParts: string[]
): Promise<Response> {
  if (pathParts[0] === "state") {
    return handleChordManualState(request, env, requestId);
  }

  if (request.method !== "GET") {
    return fail(requestId, "VALIDATION_ERROR", "method not allowed", 405);
  }

  if (pathParts[0] === "quiz") {
    return handleChordsQuiz(request, env, requestId);
  }

  if (pathParts[0]) {
    return handleChordDetail(env, requestId, pathParts[0]);
  }

  const url = new URL(request.url);
  const root = url.searchParams.get("root");
  const type = url.searchParams.get("type");
  const limit = parseIntInRange(url.searchParams.get("limit"), 20, 1, 100);
  if (limit == null) {
    return fail(requestId, "VALIDATION_ERROR", "limit must be between 1 and 100", 400, { field: "limit" });
  }

  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.get("cursor") && !cursor) {
    return fail(requestId, "VALIDATION_ERROR", "invalid cursor", 400, { field: "cursor" });
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (root) {
    clauses.push("root = ?");
    params.push(root);
  }
  if (type) {
    clauses.push("type = ?");
    params.push(type);
  }
  if (cursor) {
    clauses.push("id > ?");
    params.push(cursor.id);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT id, name, type, root, tones_json, fingering_json FROM chords ${whereClause} ORDER BY id ASC LIMIT ?`;
  params.push(limit + 1);

  const result = await env.DB.prepare(sql).bind(...params).all<ChordRow>();
  const rows = result.results ?? [];
  const hasNext = rows.length > limit;
  const visibleRows = hasNext ? rows.slice(0, limit) : rows;
  const items = visibleRows.map(mapChord);
  const last = visibleRows.at(-1);

  return ok(
    { items },
    requestId,
    200,
    {
      limit,
      nextCursor: hasNext && last ? encodeCursor({ sortValue: last.id, id: last.id }) : null
    }
  );
}

async function handleChordDetail(env: Env, requestId: string, chordId: string): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT id, name, type, root, tones_json, fingering_json FROM chords WHERE id = ? LIMIT 1"
  )
    .bind(chordId)
    .first<ChordRow>();

  if (!row) {
    return fail(requestId, "NOT_FOUND", "chord not found", 404);
  }

  return ok(mapChord(row), requestId);
}

async function handleChordsQuiz(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const count = parseIntInRange(url.searchParams.get("count"), 10, 1, 30);
  if (count == null) {
    return fail(requestId, "VALIDATION_ERROR", "count must be between 1 and 30", 400, { field: "count" });
  }

  const allRows = await env.DB.prepare(
    "SELECT id, name, type, root, tones_json, fingering_json FROM chords ORDER BY id ASC LIMIT 100"
  ).all<ChordRow>();
  const chords = (allRows.results ?? []).map(mapChord);
  if (chords.length < 4) {
    return fail(requestId, "VALIDATION_ERROR", "at least 4 chords are required for quiz", 400);
  }

  const questions = Array.from({ length: count }, (_, i) => {
    const answer = chords[i % chords.length];
    const distractors = chords.filter((c) => c.id !== answer.id).slice(0, 3);
    const choices = [answer.name, ...distractors.map((d) => d.name)];
    return {
      id: `q_${i + 1}`,
      chordId: answer.id,
      promptType: "name_from_tones",
      prompt: { tones: answer.tones },
      choices,
      answerIndex: 0
    };
  });

  return ok({ questions }, requestId);
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function handleChordManualState(request: Request, env: Env, requestId: string): Promise<Response> {
  const userId = getRequiredHeader(request, "x-user-id", requestId);
  if (userId instanceof Response) return userId;

  if (request.method === "GET") {
    const row = await env.DB.prepare(
      `SELECT user_id, voicings_json, mutes_json, barres_json
       FROM user_chord_states
       WHERE user_id = ?
       LIMIT 1`
    )
      .bind(userId)
      .first<ChordManualStateRow>();

    if (!row) {
      return ok({ voicings: {}, mutes: {}, barres: {} }, requestId);
    }

    return ok(
      {
        voicings: JSON.parse(row.voicings_json),
        mutes: JSON.parse(row.mutes_json),
        barres: JSON.parse(row.barres_json)
      },
      requestId
    );
  }

  if (request.method === "PUT") {
    const body = await parseJson<ChordManualStatePayload>(request, requestId);
    if (body instanceof Response) return body;

    const voicings = asJsonObject(body.voicings);
    if (!voicings) {
      return fail(requestId, "VALIDATION_ERROR", "voicings must be an object", 400, { field: "voicings" });
    }
    const mutes = asJsonObject(body.mutes);
    if (!mutes) {
      return fail(requestId, "VALIDATION_ERROR", "mutes must be an object", 400, { field: "mutes" });
    }
    const barres = asJsonObject(body.barres);
    if (!barres) {
      return fail(requestId, "VALIDATION_ERROR", "barres must be an object", 400, { field: "barres" });
    }

    await env.DB.prepare(
      `INSERT INTO user_chord_states(user_id, voicings_json, mutes_json, barres_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         voicings_json = excluded.voicings_json,
         mutes_json = excluded.mutes_json,
         barres_json = excluded.barres_json,
         updated_at = excluded.updated_at`
    )
      .bind(userId, JSON.stringify(voicings), JSON.stringify(mutes), JSON.stringify(barres), new Date().toISOString())
      .run();

    return ok({ saved: true }, requestId);
  }

  return fail(requestId, "VALIDATION_ERROR", "method not allowed", 405);
}
