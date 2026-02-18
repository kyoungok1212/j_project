import { fail, ok } from "../lib/http";
import { getRequiredHeader, parseJson } from "../lib/utils";
import type { Env } from "../types";

interface DrumSheetRow {
  id: string;
  user_id: string;
  title: string;
  bpm: number;
  time_signature: string;
  steps_per_bar: number;
  total_bars: number;
  pattern_json: string;
  note_length_overrides_json: string;
  selected_samples_json: string;
  created_at: string;
  updated_at: string;
}

interface DrumSheetRevisionRow {
  id: number;
  sheet_id: string;
  user_id: string;
  revision_no: number;
  title: string;
  bpm: number;
  time_signature: string;
  steps_per_bar: number;
  total_bars: number;
  pattern_json: string;
  note_length_overrides_json: string;
  selected_samples_json: string;
  source_updated_at: string;
  saved_at: string;
}

interface DrumSheetPayload {
  title: string;
  bpm: number;
  timeSignature: string;
  stepsPerBar: number;
  totalBars: number;
  pattern: unknown;
  noteLengthOverrides: unknown;
  selectedSamples: unknown;
  updatedAt?: number;
}

function mapSheet(row: DrumSheetRow) {
  return {
    id: row.id,
    title: row.title,
    bpm: row.bpm,
    timeSignature: row.time_signature,
    stepsPerBar: row.steps_per_bar,
    totalBars: row.total_bars,
    pattern: JSON.parse(row.pattern_json),
    noteLengthOverrides: JSON.parse(row.note_length_overrides_json),
    selectedSamples: JSON.parse(row.selected_samples_json),
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at)
  };
}

function mapRevisionSummary(row: DrumSheetRevisionRow) {
  return {
    revision: row.revision_no,
    title: row.title,
    bpm: row.bpm,
    timeSignature: row.time_signature,
    stepsPerBar: row.steps_per_bar,
    totalBars: row.total_bars,
    sourceUpdatedAt: Date.parse(row.source_updated_at),
    savedAt: Date.parse(row.saved_at)
  };
}

function mapRevisionToSheet(row: DrumSheetRevisionRow) {
  return {
    id: row.sheet_id,
    title: row.title,
    bpm: row.bpm,
    timeSignature: row.time_signature,
    stepsPerBar: row.steps_per_bar,
    totalBars: row.total_bars,
    pattern: JSON.parse(row.pattern_json),
    noteLengthOverrides: JSON.parse(row.note_length_overrides_json),
    selectedSamples: JSON.parse(row.selected_samples_json),
    updatedAt: Date.parse(row.source_updated_at)
  };
}

interface DrumSheetSnapshot {
  title: string;
  bpm: number;
  timeSignature: string;
  stepsPerBar: number;
  totalBars: number;
  patternJson: string;
  noteLengthOverridesJson: string;
  selectedSamplesJson: string;
}

function makeSnapshotFromPayload(payload: DrumSheetPayload): DrumSheetSnapshot {
  return {
    title: payload.title,
    bpm: payload.bpm,
    timeSignature: payload.timeSignature,
    stepsPerBar: payload.stepsPerBar,
    totalBars: payload.totalBars,
    patternJson: JSON.stringify(payload.pattern),
    noteLengthOverridesJson: JSON.stringify(payload.noteLengthOverrides),
    selectedSamplesJson: JSON.stringify(payload.selectedSamples)
  };
}

function makeSnapshotFromRow(row: DrumSheetRow): DrumSheetSnapshot {
  return {
    title: row.title,
    bpm: row.bpm,
    timeSignature: row.time_signature,
    stepsPerBar: row.steps_per_bar,
    totalBars: row.total_bars,
    patternJson: row.pattern_json,
    noteLengthOverridesJson: row.note_length_overrides_json,
    selectedSamplesJson: row.selected_samples_json
  };
}

function validatePayload(payload: DrumSheetPayload): { field: string; message: string } | null {
  if (!payload.title || payload.title.length > 120) {
    return { field: "title", message: "title must be 1 to 120 chars" };
  }
  if (typeof payload.bpm !== "number" || payload.bpm < 40 || payload.bpm > 240) {
    return { field: "bpm", message: "bpm must be between 40 and 240" };
  }
  if (!payload.timeSignature || payload.timeSignature.length > 8) {
    return { field: "timeSignature", message: "invalid timeSignature" };
  }
  if (!Number.isFinite(payload.stepsPerBar) || payload.stepsPerBar < 1 || payload.stepsPerBar > 512) {
    return { field: "stepsPerBar", message: "stepsPerBar must be between 1 and 512" };
  }
  if (!Number.isFinite(payload.totalBars) || payload.totalBars < 1 || payload.totalBars > 256) {
    return { field: "totalBars", message: "totalBars must be between 1 and 256" };
  }
  if (!payload.pattern || typeof payload.pattern !== "object") {
    return { field: "pattern", message: "pattern must be an object" };
  }
  if (!payload.noteLengthOverrides || typeof payload.noteLengthOverrides !== "object") {
    return { field: "noteLengthOverrides", message: "noteLengthOverrides must be an object" };
  }
  if (!payload.selectedSamples || typeof payload.selectedSamples !== "object") {
    return { field: "selectedSamples", message: "selectedSamples must be an object" };
  }
  return null;
}

export async function handleDrumSheets(
  request: Request,
  env: Env,
  requestId: string,
  pathParts: string[]
): Promise<Response> {
  const userId = getRequiredHeader(request, "x-user-id", requestId);
  if (userId instanceof Response) return userId;

  if (request.method === "GET" && pathParts.length === 0) {
    return listSheets(env, requestId, userId);
  }
  if (request.method === "GET" && pathParts.length === 1) {
    return getSheet(env, requestId, userId, pathParts[0]);
  }
  if (request.method === "GET" && pathParts.length === 2 && pathParts[1] === "revisions") {
    return listSheetRevisions(env, requestId, userId, pathParts[0]);
  }
  if ((request.method === "PUT" || request.method === "POST") && pathParts.length === 1) {
    return upsertSheet(request, env, requestId, userId, pathParts[0]);
  }
  if (request.method === "POST" && pathParts.length === 4 && pathParts[1] === "revisions" && pathParts[3] === "restore") {
    return restoreSheetRevision(env, requestId, userId, pathParts[0], pathParts[2]);
  }
  if (request.method === "DELETE" && pathParts.length === 1) {
    return deleteSheet(env, requestId, userId, pathParts[0]);
  }

  return fail(requestId, "VALIDATION_ERROR", "route not found", 404);
}

async function listSheets(env: Env, requestId: string, userId: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, title, bpm, time_signature, steps_per_bar, total_bars,
            pattern_json, note_length_overrides_json, selected_samples_json, created_at, updated_at
     FROM drum_sheets
     WHERE user_id = ?
     ORDER BY updated_at DESC, id DESC`
  )
    .bind(userId)
    .all<DrumSheetRow>();
  return ok({ items: (rows.results ?? []).map(mapSheet) }, requestId);
}

async function getSheet(env: Env, requestId: string, userId: string, sheetId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, user_id, title, bpm, time_signature, steps_per_bar, total_bars,
            pattern_json, note_length_overrides_json, selected_samples_json, created_at, updated_at
     FROM drum_sheets
     WHERE id = ? AND user_id = ?
     LIMIT 1`
  )
    .bind(sheetId, userId)
    .first<DrumSheetRow>();

  if (!row) {
    return fail(requestId, "NOT_FOUND", "sheet not found", 404);
  }
  return ok(mapSheet(row), requestId);
}

async function listSheetRevisions(env: Env, requestId: string, userId: string, sheetId: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, sheet_id, user_id, revision_no, title, bpm, time_signature, steps_per_bar, total_bars,
            pattern_json, note_length_overrides_json, selected_samples_json, source_updated_at, saved_at
     FROM drum_sheet_revisions
     WHERE sheet_id = ? AND user_id = ?
     ORDER BY revision_no DESC
     LIMIT 120`
  )
    .bind(sheetId, userId)
    .all<DrumSheetRevisionRow>();

  return ok({ id: sheetId, items: (rows.results ?? []).map(mapRevisionSummary) }, requestId);
}

async function getLatestRevisionNo(env: Env, userId: string, sheetId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(MAX(revision_no), 0) AS latest
     FROM drum_sheet_revisions
     WHERE sheet_id = ? AND user_id = ?`
  )
    .bind(sheetId, userId)
    .first<{ latest: number }>();
  return Number(row?.latest ?? 0) || 0;
}

async function insertRevisionSnapshot(
  env: Env,
  userId: string,
  sheetId: string,
  revisionNo: number,
  snapshot: DrumSheetSnapshot,
  sourceUpdatedAtIso: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO drum_sheet_revisions(
       sheet_id, user_id, revision_no, title, bpm, time_signature, steps_per_bar, total_bars,
       pattern_json, note_length_overrides_json, selected_samples_json, source_updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sheetId,
      userId,
      revisionNo,
      snapshot.title,
      snapshot.bpm,
      snapshot.timeSignature,
      snapshot.stepsPerBar,
      snapshot.totalBars,
      snapshot.patternJson,
      snapshot.noteLengthOverridesJson,
      snapshot.selectedSamplesJson,
      sourceUpdatedAtIso
    )
    .run();
}

async function upsertSheet(
  request: Request,
  env: Env,
  requestId: string,
  userId: string,
  sheetId: string
): Promise<Response> {
  const body = await parseJson<DrumSheetPayload>(request, requestId);
  if (body instanceof Response) return body;

  const validation = validatePayload(body);
  if (validation) {
    return fail(requestId, "VALIDATION_ERROR", validation.message, 400, { field: validation.field });
  }

  const existing = await env.DB.prepare(
    `SELECT id, user_id, title, bpm, time_signature, steps_per_bar, total_bars,
            pattern_json, note_length_overrides_json, selected_samples_json, created_at, updated_at
     FROM drum_sheets
     WHERE id = ? AND user_id = ?
     LIMIT 1`
  )
    .bind(sheetId, userId)
    .first<DrumSheetRow>();

  const updatedAtIso = body.updatedAt ? new Date(body.updatedAt).toISOString() : new Date().toISOString();
  const incomingSnapshot = makeSnapshotFromPayload(body);
  let latestRevisionNo = await getLatestRevisionNo(env, userId, sheetId);

  if (existing && latestRevisionNo === 0) {
    await insertRevisionSnapshot(env, userId, sheetId, 1, makeSnapshotFromRow(existing), existing.updated_at);
    latestRevisionNo = 1;
  }

  if (existing) {
    await env.DB.prepare(
      `UPDATE drum_sheets
       SET title = ?, bpm = ?, time_signature = ?, steps_per_bar = ?, total_bars = ?,
           pattern_json = ?, note_length_overrides_json = ?, selected_samples_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        body.title,
        body.bpm,
        body.timeSignature,
        body.stepsPerBar,
        body.totalBars,
        incomingSnapshot.patternJson,
        incomingSnapshot.noteLengthOverridesJson,
        incomingSnapshot.selectedSamplesJson,
        updatedAtIso,
        sheetId,
        userId
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO drum_sheets(
         id, user_id, title, bpm, time_signature, steps_per_bar, total_bars,
         pattern_json, note_length_overrides_json, selected_samples_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sheetId,
        userId,
        body.title,
        body.bpm,
        body.timeSignature,
        body.stepsPerBar,
        body.totalBars,
        incomingSnapshot.patternJson,
        incomingSnapshot.noteLengthOverridesJson,
        incomingSnapshot.selectedSamplesJson,
        updatedAtIso
      )
      .run();
  }

  const nextRevisionNo = latestRevisionNo + 1;
  await insertRevisionSnapshot(env, userId, sheetId, nextRevisionNo, incomingSnapshot, updatedAtIso);

  return ok({ id: sheetId, revision: nextRevisionNo }, requestId);
}

async function restoreSheetRevision(
  env: Env,
  requestId: string,
  userId: string,
  sheetId: string,
  revisionText: string
): Promise<Response> {
  const revisionNo = Number.parseInt(revisionText, 10);
  if (!Number.isFinite(revisionNo) || revisionNo < 1) {
    return fail(requestId, "VALIDATION_ERROR", "invalid revision", 400, { field: "revision" });
  }

  const revision = await env.DB.prepare(
    `SELECT id, sheet_id, user_id, revision_no, title, bpm, time_signature, steps_per_bar, total_bars,
            pattern_json, note_length_overrides_json, selected_samples_json, source_updated_at, saved_at
     FROM drum_sheet_revisions
     WHERE sheet_id = ? AND user_id = ? AND revision_no = ?
     LIMIT 1`
  )
    .bind(sheetId, userId, revisionNo)
    .first<DrumSheetRevisionRow>();

  if (!revision) {
    return fail(requestId, "NOT_FOUND", "revision not found", 404);
  }

  const restoredAtIso = new Date().toISOString();
  const exists = await env.DB.prepare("SELECT id FROM drum_sheets WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(sheetId, userId)
    .first<{ id: string }>();

  if (exists) {
    await env.DB.prepare(
      `UPDATE drum_sheets
       SET title = ?, bpm = ?, time_signature = ?, steps_per_bar = ?, total_bars = ?,
           pattern_json = ?, note_length_overrides_json = ?, selected_samples_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        revision.title,
        revision.bpm,
        revision.time_signature,
        revision.steps_per_bar,
        revision.total_bars,
        revision.pattern_json,
        revision.note_length_overrides_json,
        revision.selected_samples_json,
        restoredAtIso,
        sheetId,
        userId
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO drum_sheets(
         id, user_id, title, bpm, time_signature, steps_per_bar, total_bars,
         pattern_json, note_length_overrides_json, selected_samples_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sheetId,
        userId,
        revision.title,
        revision.bpm,
        revision.time_signature,
        revision.steps_per_bar,
        revision.total_bars,
        revision.pattern_json,
        revision.note_length_overrides_json,
        revision.selected_samples_json,
        restoredAtIso
      )
      .run();
  }

  const latestRevisionNo = await getLatestRevisionNo(env, userId, sheetId);
  await insertRevisionSnapshot(
    env,
    userId,
    sheetId,
    latestRevisionNo + 1,
    {
      title: revision.title,
      bpm: revision.bpm,
      timeSignature: revision.time_signature,
      stepsPerBar: revision.steps_per_bar,
      totalBars: revision.total_bars,
      patternJson: revision.pattern_json,
      noteLengthOverridesJson: revision.note_length_overrides_json,
      selectedSamplesJson: revision.selected_samples_json
    },
    restoredAtIso
  );

  return ok({ id: sheetId, restoredFromRevision: revisionNo, sheet: mapRevisionToSheet(revision) }, requestId);
}

async function deleteSheet(env: Env, requestId: string, userId: string, sheetId: string): Promise<Response> {
  const result = await env.DB.prepare("DELETE FROM drum_sheets WHERE id = ? AND user_id = ?").bind(sheetId, userId).run();
  if ((result.meta.changes ?? 0) < 1) {
    return fail(requestId, "NOT_FOUND", "sheet not found", 404);
  }
  return ok({ id: sheetId, deleted: true }, requestId);
}
