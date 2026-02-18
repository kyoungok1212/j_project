import { decodeCursor, encodeCursor } from "../lib/pagination";
import { fail, ok } from "../lib/http";
import { parseIntInRange } from "../lib/utils";
import type { Env } from "../types";

const CHROMATIC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const ROOTS = [...CHROMATIC];
const STANDARD_TUNING = [
  { string: 6, openNote: "E" },
  { string: 5, openNote: "A" },
  { string: 4, openNote: "D" },
  { string: 3, openNote: "G" },
  { string: 2, openNote: "B" },
  { string: 1, openNote: "E" }
] as const;
const OPEN_NOTE_BY_STRING = new Map<number, (typeof CHROMATIC)[number]>(
  STANDARD_TUNING.map((item) => [item.string, item.openNote])
);
const FRET_MAX = 15;
const PATTERN_SYSTEMS = ["caged", "3nps"] as const;

const MODE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  major_blues: [0, 2, 3, 4, 7, 9],
  minor_blues: [0, 3, 5, 6, 7, 10],
  blues: [0, 3, 5, 6, 7, 10]
};

const MODE_NAME: Record<string, string> = {
  major: "Major",
  natural_minor: "Natural Minor",
  harmonic_minor: "Harmonic Minor",
  melodic_minor: "Melodic Minor",
  major_pentatonic: "Major Pentatonic",
  minor_pentatonic: "Minor Pentatonic",
  major_blues: "Major Blues",
  minor_blues: "Minor Blues",
  blues: "Blues"
};

const PENTA_BLUES_POSITION_WINDOWS: Record<number, { min: number; max: number }> = {
  1: { min: 0, max: 3 },
  2: { min: 2, max: 5 },
  3: { min: 4, max: 7 },
  4: { min: 7, max: 10 },
  5: { min: 9, max: 12 }
};

const THREE_NPS_POSITION_WINDOWS: Record<number, { min: number; max: number }> = {
  1: { min: 0, max: 5 },
  2: { min: 2, max: 7 },
  3: { min: 4, max: 9 },
  4: { min: 7, max: 12 },
  5: { min: 9, max: 14 }
};

// C major CAGED templates (position 1~5), then transposed by root.
const CAGED_C_MAJOR_TEMPLATES: Record<number, Record<number, number[]>> = {
  1: {
    6: [0, 1, 3],
    5: [0, 2, 3],
    4: [0, 2, 3],
    3: [0, 2, 4],
    2: [1, 3],
    1: [0, 1, 3]
  },
  2: {
    6: [3, 5],
    5: [2, 3, 5],
    4: [2, 3, 5],
    3: [2, 4, 5],
    2: [3, 5],
    1: [3, 5]
  },
  3: {
    6: [5, 7, 8],
    5: [5, 7, 8],
    4: [5, 7],
    3: [4, 5, 7],
    2: [5, 6, 8],
    1: [5, 7, 8]
  },
  4: {
    6: [7, 8, 10],
    5: [7, 8, 10],
    4: [7, 9, 10],
    3: [7, 9],
    2: [8, 10],
    1: [7, 8, 10]
  },
  5: {
    6: [8, 10, 12],
    5: [10, 12],
    4: [9, 10, 12],
    3: [9, 10, 12],
    2: [10, 12, 13],
    1: [10, 12]
  }
};

interface ScaleCatalogItem {
  id: string;
  name: string;
  mode: string;
  root: string;
  patternPositions: Array<{ position: number; notes: string[]; fretPositions: Array<{ string: number; frets: number[] }> }>;
}

function makeScaleCatalog(): ScaleCatalogItem[] {
  const modes = Object.keys(MODE_INTERVALS);
  const result: ScaleCatalogItem[] = [];
  for (const root of ROOTS) {
    for (const mode of modes) {
      const notes = getScaleNotes(root, mode);
      result.push({
        id: `scale_${root}_${mode}`.replaceAll("#", "s"),
        name: `${root} ${MODE_NAME[mode]}`,
        mode,
        root,
        patternPositions: [1, 2, 3, 4, 5].map((position) => ({
          position,
          notes,
          fretPositions: []
        }))
      });
    }
  }
  return result;
}

const SCALE_CATALOG = makeScaleCatalog();
const SCALE_BY_ID = new Map(SCALE_CATALOG.map((item) => [item.id, item]));

function getScaleNotes(root: string, mode: string): string[] {
  const rootIndex = CHROMATIC.indexOf(root as (typeof CHROMATIC)[number]);
  if (rootIndex < 0 || !MODE_INTERVALS[mode]) return [];
  return MODE_INTERVALS[mode].map((interval) => CHROMATIC[(rootIndex + interval) % CHROMATIC.length]);
}

function noteAt(stringNumber: number, fret: number): string {
  const open = OPEN_NOTE_BY_STRING.get(stringNumber);
  if (!open) {
    throw new Error(`unsupported string number: ${stringNumber}`);
  }
  const openIndex = CHROMATIC.indexOf(open);
  return CHROMATIC[(openIndex + fret) % CHROMATIC.length];
}

function rootFretOnLowE(root: string): number {
  const eIndex = CHROMATIC.indexOf("E");
  const rootIndex = CHROMATIC.indexOf(root as (typeof CHROMATIC)[number]);
  return (rootIndex - eIndex + 12) % 12;
}

function rootShiftFromC(root: string): number {
  const cIndex = CHROMATIC.indexOf("C");
  const rootIndex = CHROMATIC.indexOf(root as (typeof CHROMATIC)[number]);
  return (rootIndex - cIndex + 12) % 12;
}

function inferFamily(mode: string): "diatonic" | "pentatonic_or_blues" {
  if (
    mode === "major_pentatonic" ||
    mode === "minor_pentatonic" ||
    mode === "major_blues" ||
    mode === "minor_blues" ||
    mode === "blues"
  ) {
    return "pentatonic_or_blues";
  }
  return "diatonic";
}

function fitWindow(min: number, max: number): { min: number; max: number } | null {
  const shiftedCandidates = [-24, -12, 0, 12, 24]
    .map((shift) => ({ min: min + shift, max: max + shift, shift }))
    .filter((cand) => cand.min >= 0 && cand.max <= FRET_MAX);
  if (shiftedCandidates.length > 0) {
    shiftedCandidates.sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift));
    return { min: shiftedCandidates[0].min, max: shiftedCandidates[0].max };
  }

  if (max > FRET_MAX) {
    const overflow = max - FRET_MAX;
    min -= overflow;
    max -= overflow;
  }
  if (min < 0) {
    const underflow = -min;
    min += underflow;
    max += underflow;
  }
  min = Math.max(min, 0);
  max = Math.min(max, FRET_MAX);
  if (min > max) return null;
  return { min, max };
}

function getWindow(root: string, mode: string, position: number, system: "caged" | "3nps"): { min: number; max: number } | null {
  if (system === "3nps") {
    const baseWindow = THREE_NPS_POSITION_WINDOWS[position];
    if (!baseWindow) return null;
    const anchor = rootFretOnLowE(root);
    return fitWindow(anchor + baseWindow.min, anchor + baseWindow.max);
  }

  const family = inferFamily(mode);
  if (family === "diatonic") return null;
  const baseWindow = PENTA_BLUES_POSITION_WINDOWS[position];
  if (!baseWindow) return null;
  const anchor = rootFretOnLowE(root);
  return fitWindow(anchor + baseWindow.min, anchor + baseWindow.max);
}

function trimToThreeNps(frets: number[], min: number, max: number): number[] {
  if (frets.length <= 3) return frets;
  const center = (min + max) / 2;
  return [...frets]
    .sort((a, b) => {
      const diff = Math.abs(a - center) - Math.abs(b - center);
      return diff !== 0 ? diff : a - b;
    })
    .slice(0, 3)
    .sort((a, b) => a - b);
}

function pickTemplateOctaveOffset(templateByString: Record<number, number[]>, shift: number): number | null {
  const offsets = [0, -12, 12, -24, 24];
  const templateFrets = Object.values(templateByString).flat();
  for (const offset of offsets) {
    const ok = templateFrets.every((fret) => {
      const shifted = fret + shift + offset;
      return shifted >= 0 && shifted <= FRET_MAX;
    });
    if (ok) return offset;
  }
  return null;
}

function buildCagedTemplateFretPositions(
  root: string,
  mode: string,
  position: number
): Array<{ string: number; frets: number[] }> {
  const templateByString = CAGED_C_MAJOR_TEMPLATES[position];
  if (!templateByString) return [];

  const notes = new Set(getScaleNotes(root, mode));
  if (notes.size === 0) return [];

  const shift = rootShiftFromC(root);
  const offset = pickTemplateOctaveOffset(templateByString, shift);
  if (offset == null) return [];

  const rows: Array<{ string: number; frets: number[] }> = [];
  for (const { string: stringNumber } of STANDARD_TUNING) {
    const baseFrets = templateByString[stringNumber] ?? [];
    const shiftedFrets = baseFrets
      .map((fret) => fret + shift + offset)
      .filter((fret) => fret >= 0 && fret <= FRET_MAX)
      .filter((fret) => notes.has(noteAt(stringNumber, fret)));
    const uniqueSorted = [...new Set(shiftedFrets)].sort((a, b) => a - b);
    if (uniqueSorted.length > 0) {
      rows.push({ string: stringNumber, frets: uniqueSorted });
    }
  }
  return rows;
}

function buildFretPositions(
  root: string,
  mode: string,
  position: number,
  system: "caged" | "3nps"
): Array<{ string: number; frets: number[] }> {
  if (system === "caged" && inferFamily(mode) === "diatonic") {
    return buildCagedTemplateFretPositions(root, mode, position);
  }

  const notes = new Set(getScaleNotes(root, mode));
  if (notes.size === 0) return [];
  const minMax = getWindow(root, mode, position, system);
  if (!minMax) return [];
  const { min, max } = minMax;
  if (min > max) return [];

  const rows: Array<{ string: number; frets: number[] }> = [];
  for (const { string: stringNumber } of STANDARD_TUNING) {
    const frets: number[] = [];
    for (let fret = 0; fret <= FRET_MAX; fret += 1) {
      if (fret < min || fret > max) continue;
      const note = noteAt(stringNumber, fret);
      if (notes.has(note)) frets.push(fret);
    }
    const normalizedFrets = system === "3nps" ? trimToThreeNps(frets, min, max) : frets;
    if (normalizedFrets.length > 0) {
      rows.push({ string: stringNumber, frets: normalizedFrets });
    }
  }
  return rows;
}

export async function handleScales(
  request: Request,
  _env: Env,
  requestId: string,
  pathParts: string[]
): Promise<Response> {
  if (request.method !== "GET") {
    return fail(requestId, "VALIDATION_ERROR", "method not allowed", 405);
  }

  if (pathParts[0] === "pattern") {
    return handleScalePattern(request, requestId);
  }

  if (pathParts[0]) {
    return handleScaleDetail(requestId, pathParts[0]);
  }

  const url = new URL(request.url);
  const root = url.searchParams.get("root");
  const mode = url.searchParams.get("mode");
  const limit = parseIntInRange(url.searchParams.get("limit"), 50, 1, 100);
  if (limit == null) {
    return fail(requestId, "VALIDATION_ERROR", "limit must be between 1 and 100", 400, { field: "limit" });
  }
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (url.searchParams.get("cursor") && !cursor) {
    return fail(requestId, "VALIDATION_ERROR", "invalid cursor", 400, { field: "cursor" });
  }

  let items = SCALE_CATALOG;
  if (root) {
    items = items.filter((item) => item.root === root);
  }
  if (mode) {
    items = items.filter((item) => item.mode === mode);
  }

  if (cursor) {
    const idx = items.findIndex((item) => item.id === cursor.id);
    if (idx >= 0) {
      items = items.slice(idx + 1);
    }
  }

  const page = items.slice(0, limit + 1);
  const hasNext = page.length > limit;
  const visible = hasNext ? page.slice(0, limit) : page;
  const last = visible.at(-1);

  return ok(
    {
      items: visible
    },
    requestId,
    200,
    {
      limit,
      nextCursor: hasNext && last ? encodeCursor({ sortValue: last.id, id: last.id }) : null
    }
  );
}

async function handleScaleDetail(requestId: string, scaleId: string): Promise<Response> {
  const item = SCALE_BY_ID.get(scaleId);
  if (!item) {
    return fail(requestId, "NOT_FOUND", "scale not found", 404);
  }
  return ok(item, requestId);
}

async function handleScalePattern(request: Request, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const root = url.searchParams.get("root");
  const mode = url.searchParams.get("mode");
  const positionRaw = url.searchParams.get("position");
  const system = (url.searchParams.get("system") ?? "caged").toLowerCase() as "caged" | "3nps";
  const position = parseIntInRange(positionRaw, 1, 1, 5);

  if (!root || !mode || position == null) {
    return fail(requestId, "VALIDATION_ERROR", "root, mode and position are required", 400);
  }
  if (!ROOTS.includes(root as (typeof CHROMATIC)[number])) {
    return fail(requestId, "VALIDATION_ERROR", "unsupported root", 400, { field: "root" });
  }
  if (!MODE_INTERVALS[mode]) {
    return fail(requestId, "VALIDATION_ERROR", "unsupported mode", 400, { field: "mode" });
  }
  if (!PATTERN_SYSTEMS.includes(system)) {
    return fail(requestId, "VALIDATION_ERROR", "unsupported system", 400, { field: "system" });
  }

  const notes = getScaleNotes(root, mode);
  const fretPositions = buildFretPositions(root, mode, position, system);

  return ok(
    {
      root,
      mode,
      system,
      position,
      notes,
      tuning: STANDARD_TUNING,
      fretPositions
    },
    requestId
  );
}
