import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Annotation, BarlineType, Beam, Formatter, GhostNote, Renderer, Stave, StaveNote, Stem, Voice } from "vexflow";
import { getDrumSheets, upsertDrumSheet } from "../api";
import { GP_FILE_ACCEPT, GpImportError, importDrumSheetFromGpFile, type ImportedDrumSheet } from "../gpImport";
import { DRUM_SAMPLE_SETTINGS_EVENT, readDrumSampleSettings } from "../sampleSettings";
import {
  METRONOME_FORCE_STOP_EVENT,
  METRONOME_SETTINGS_EVENT,
  METRONOME_SUBDIVISION_STEPS,
  emitMetronomeSettings,
  emitMetronomeVisualState,
  readMetronomeSettings,
  type MetronomeSettings
} from "../../metronome/shared";

const TRACKS = [
  { id: "kick", label: "킥" },
  { id: "snare", label: "스네어" },
  { id: "rimshot", label: "림샷" },
  { id: "sidestick", label: "사이드스틱" },
  { id: "high_tom", label: "하이 탐" },
  { id: "mid_tom", label: "미드 탐" },
  { id: "floor_tom", label: "플로어 탐" },
  { id: "hi_hat_open", label: "하이햇 오픈" },
  { id: "hi_hat_close", label: "하이햇 클로즈" },
  { id: "foot_hi_hat", label: "풋 하이햇" },
  { id: "ride_cymbal", label: "라이드 심벌" },
  { id: "crash_cymbal", label: "크래시 심벌" }
] as const;

const TIME_SIGNATURE_OPTIONS = [
  { value: "1/4", label: "1/4", stepsPerBar: 8 },
  { value: "2/4", label: "2/4", stepsPerBar: 16 },
  { value: "3/4", label: "3/4", stepsPerBar: 24 },
  { value: "6/8", label: "6/8", stepsPerBar: 24 },
  { value: "4/4", label: "4/4", stepsPerBar: 32 },
  { value: "6/4", label: "6/4", stepsPerBar: 48 },
  { value: "12/8", label: "12/8", stepsPerBar: 48 }
] as const;
const SHEET_STORAGE_KEY = "jguitar_sheet_maker_v1";
const DEFAULT_WE_WILL_ROCK_YOU_ID = "default-we-will-rock-you";
const DEFAULT_WE_WILL_ROCK_YOU_TITLE = "Queen - We Will Rock You (기본)";
const NOTATION_STAFF_TOP = 34;
const DEFAULT_NOTATION_STEP_WIDTH = 14;
const GRID_TRACK_COLUMN_WIDTH = 120;
const DEFAULT_NOTATION_GRID_START = GRID_TRACK_COLUMN_WIDTH + 4;
const NOTATION_RIGHT_PADDING = 18;
const NOTATION_HEIGHT = 136;
const NOTATION_NOTE_FILL = "rgba(235, 245, 255, 0.95)";
const NOTATION_NOTE_STROKE = "rgba(223, 238, 255, 0.92)";
const GRID_VIRTUAL_OVERSCAN_STEPS = 24;
const SCORE_NOTATION_MIN_WIDTH = 520;
const SCORE_NOTATION_ROW_HEIGHT = 164;
const SCORE_STAFF_TOP_OFFSET = 10;
const SCORE_FIRST_ROW_SYMBOL_WIDTH = 76;
const SCORE_RIGHT_SAFE_GUTTER = 28;
const SCORE_NOTE_FILL = "rgba(24, 30, 40, 0.96)";
const SCORE_NOTE_STROKE = "rgba(22, 28, 38, 0.92)";
const MOBILE_SCORE_BREAKPOINT = 860;

type DrumTrackId = (typeof TRACKS)[number]["id"];
type DrumPattern = Record<DrumTrackId, boolean[]>;
type DrumTrackSampleMap = Partial<Record<DrumTrackId, string>>;
type VoicePart = "hand" | "foot";
type NoteLengthSteps = 1 | 2 | 4 | 8;
type TimeSignatureValue = (typeof TIME_SIGNATURE_OPTIONS)[number]["value"];
type SheetViewMode = "edit" | "score";

const STEPS_PER_32ND = 1;
const STEPS_PER_16TH = 2;
const STEPS_PER_8TH = 4;
const STEPS_PER_QUARTER = 8;
const INPUT_NOTE_LENGTH_OPTIONS: Array<{ value: NoteLengthSteps; label: string }> = [
  { value: STEPS_PER_QUARTER, label: "4분" },
  { value: STEPS_PER_8TH, label: "8분" },
  { value: STEPS_PER_16TH, label: "16분" },
  { value: STEPS_PER_32ND, label: "32분" }
];

function isTimeSignatureValue(value: string): value is TimeSignatureValue {
  return TIME_SIGNATURE_OPTIONS.some((option) => option.value === value);
}

function resolveStepsPerBar(timeSignature: TimeSignatureValue): number {
  const found = TIME_SIGNATURE_OPTIONS.find((option) => option.value === timeSignature);
  return found?.stepsPerBar ?? 32;
}

function resolveLegacyStepsPerBar(timeSignature: TimeSignatureValue): number {
  switch (timeSignature) {
    case "1/4":
      return 4;
    case "2/4":
      return 8;
    case "3/4":
      return 12;
    case "6/8":
      return 12;
    case "4/4":
      return 16;
    case "6/4":
      return 24;
    case "12/8":
      return 24;
    default:
      return resolveStepsPerBar(timeSignature);
  }
}

function inferTimeSignatureFromStepsPerBar(stepsPerBar: number): TimeSignatureValue {
  switch (stepsPerBar) {
    case 4:
    case 8:
      return "1/4";
    case 16:
      return "2/4";
    case 12:
      return "3/4";
    case 24:
      return "6/8";
    case 32:
      return "4/4";
    case 48:
      return "12/8";
    default:
      return "4/4";
  }
}

function parseTimeSignature(timeSignature: TimeSignatureValue): { numerator: number; denominator: number } {
  const [numeratorText, denominatorText] = timeSignature.split("/");
  const numerator = Number.parseInt(numeratorText, 10);
  const denominator = Number.parseInt(denominatorText, 10);
  if (!Number.isFinite(numerator) || numerator < 1 || !Number.isFinite(denominator) || denominator < 1) {
    return { numerator: 4, denominator: 4 };
  }
  return { numerator, denominator };
}

function getTransportQuarterBeatsPerBar(timeSignature: TimeSignatureValue): number {
  const { numerator, denominator } = parseTimeSignature(timeSignature);
  return numerator * (4 / denominator);
}

function getMetronomeSyncBeatsPerBar(timeSignature: TimeSignatureValue): number {
  const { numerator, denominator } = parseTimeSignature(timeSignature);
  if (denominator === 8 && numerator >= 6 && numerator % 3 === 0) {
    // Compound meter: 12/8 -> 4 beats, 6/8 -> 2 beats
    return numerator / 3;
  }
  return getTransportQuarterBeatsPerBar(timeSignature);
}

function getStepDurationMs(sheet: SavedSheet): number {
  const bpm = Math.max(40, Math.min(240, sheet.bpm));
  const stepsPerBar = Math.max(1, sheet.stepsPerBar);
  const barMs = (60000 / bpm) * Math.max(1, getTransportQuarterBeatsPerBar(sheet.timeSignature));
  return barMs / stepsPerBar;
}

const TRACK_TO_NOTATION_KEY: Record<DrumTrackId, string> = {
  kick: "f/4",
  snare: "c/5",
  rimshot: "c/5/x2",
  sidestick: "b/4/x2",
  high_tom: "e/5",
  mid_tom: "d/5",
  floor_tom: "a/4",
  hi_hat_open: "g/5/x2",
  hi_hat_close: "g/5/x2",
  foot_hi_hat: "d/4/x2",
  ride_cymbal: "f/5/x2",
  crash_cymbal: "a/5/x2"
};

const HAND_TRACKS: DrumTrackId[] = [
  "hi_hat_open",
  "hi_hat_close",
  "ride_cymbal",
  "crash_cymbal",
  "snare",
  "rimshot",
  "sidestick",
  "high_tom",
  "mid_tom",
  "floor_tom"
];

const FOOT_TRACKS: DrumTrackId[] = ["kick", "foot_hi_hat"];

type NotationTickable = GhostNote | StaveNote;

function buildDurationKey(voicePart: VoicePart, step: number): string {
  return `${voicePart}:${step}`;
}

function clampStepIndex(step: number, totalSteps: number): number {
  if (totalSteps <= 1) {
    return 0;
  }
  return Math.max(0, Math.min(totalSteps - 1, Math.floor(step)));
}

function mapStepsToDuration(steps: NoteLengthSteps): "4" | "8" | "16" | "32" {
  if (steps === STEPS_PER_QUARTER) return "4";
  if (steps === STEPS_PER_8TH) return "8";
  if (steps === STEPS_PER_16TH) return "16";
  return "32";
}

function createNotationTickable(activeTracks: DrumTrackId[], stemDirection: number, duration: "4" | "8" | "16" | "32", id?: string): StaveNote {
  const keys = Array.from(new Set(activeTracks.map((trackId) => TRACK_TO_NOTATION_KEY[trackId])));
  const note = new StaveNote({
    clef: "percussion",
    keys,
    duration,
    stemDirection
  });
  if (id) {
    note.setAttribute("id", id);
  }
  note.setStyle({ fillStyle: NOTATION_NOTE_FILL, strokeStyle: NOTATION_NOTE_STROKE });
  note.setStemStyle({ strokeStyle: NOTATION_NOTE_STROKE });
  note.setLedgerLineStyle({ strokeStyle: NOTATION_NOTE_STROKE });
  const hiHatKey = TRACK_TO_NOTATION_KEY.hi_hat_close;
  const hiHatKeyIndex = keys.indexOf(hiHatKey);
  if (hiHatKeyIndex >= 0) {
    const hasOpenHiHat = activeTracks.includes("hi_hat_open");
    if (hasOpenHiHat) {
      const marker = new Annotation("o")
        .setJustification(Annotation.HorizontalJustify.CENTER)
        .setVerticalJustification(Annotation.VerticalJustify.TOP);
      marker.setStyle({ fillStyle: NOTATION_NOTE_FILL, strokeStyle: NOTATION_NOTE_STROKE });
      note.addModifier(marker, hiHatKeyIndex);
    }
  }
  return note;
}

function createNotationRest(duration: "4" | "8" | "16" | "32", id?: string): StaveNote {
  const restDuration = `${duration}r` as "4r" | "8r" | "16r" | "32r";
  const rest = new StaveNote({
    clef: "percussion",
    keys: ["b/4"],
    duration: restDuration
  });
  if (id) {
    rest.setAttribute("id", id);
  }
  rest.setStyle({ fillStyle: NOTATION_NOTE_FILL, strokeStyle: NOTATION_NOTE_STROKE });
  return rest;
}

function createNotationSpacer(duration: "4" | "8" | "16" | "32", id?: string): GhostNote {
  const spacer = new GhostNote({ duration });
  if (id) {
    spacer.setAttribute("id", id);
  }
  return spacer;
}

function isCoveredByDurationOverride(
  editorSheet: SavedSheet,
  trackIds: DrumTrackId[],
  voicePart: VoicePart,
  step: number,
  noteLengthOverrides: Record<string, NoteLengthSteps>,
  excludeStartStep?: number
): boolean {
  for (const [key, length] of Object.entries(noteLengthOverrides)) {
    const [part, stepText] = key.split(":");
    if (part !== voicePart) {
      continue;
    }
    const start = Number.parseInt(stepText, 10);
    if (!Number.isFinite(start)) {
      continue;
    }
    if (excludeStartStep != null && start === excludeStartStep) {
      continue;
    }
    if (start >= step || step >= start + length) {
      continue;
    }
    const hasStartHit = trackIds.some((trackId) => editorSheet.pattern[trackId][start]);
    if (hasStartHit) {
      return true;
    }
  }
  return false;
}

function hasVoiceBaseEventAtStep(
  editorSheet: SavedSheet,
  trackIds: DrumTrackId[],
  voicePart: VoicePart,
  step: number,
  noteLengthOverrides: Record<string, NoteLengthSteps>,
  excludeStartStep?: number
): boolean {
  if (trackIds.some((trackId) => editorSheet.pattern[trackId][step])) {
    return true;
  }
  return isCoveredByDurationOverride(editorSheet, trackIds, voicePart, step, noteLengthOverrides, excludeStartStep);
}

function hasVoiceAutoSustainAtStep(
  editorSheet: SavedSheet,
  trackIds: DrumTrackId[],
  voicePart: VoicePart,
  step: number,
  noteLengthOverrides: Record<string, NoteLengthSteps>
): boolean {
  void editorSheet;
  void trackIds;
  void voicePart;
  void step;
  void noteLengthOverrides;
  // Disable implicit sustain so duration only follows explicit user input.
  return false;
}

function hasVoiceEventAtStep(
  editorSheet: SavedSheet,
  trackIds: DrumTrackId[],
  voicePart: VoicePart,
  step: number,
  noteLengthOverrides: Record<string, NoteLengthSteps>,
  excludeStartStep?: number
): boolean {
  if (hasVoiceBaseEventAtStep(editorSheet, trackIds, voicePart, step, noteLengthOverrides, excludeStartStep)) {
    return true;
  }
  if (excludeStartStep != null) {
    return false;
  }
  return hasVoiceAutoSustainAtStep(editorSheet, trackIds, voicePart, step, noteLengthOverrides);
}

function hasAnyEventAtStep(editorSheet: SavedSheet, step: number, noteLengthOverrides: Record<string, NoteLengthSteps>): boolean {
  return (
    hasVoiceEventAtStep(editorSheet, HAND_TRACKS, "hand", step, noteLengthOverrides) ||
    hasVoiceEventAtStep(editorSheet, FOOT_TRACKS, "foot", step, noteLengthOverrides)
  );
}

function hasAnyTrackHitInRange(
  editorSheet: SavedSheet,
  fromStep: number,
  toStep: number,
  noteLengthOverrides: Record<string, NoteLengthSteps>
): boolean {
  for (let step = fromStep; step <= toStep; step += 1) {
    if (hasAnyEventAtStep(editorSheet, step, noteLengthOverrides)) {
      return true;
    }
  }
  return false;
}

function inferAutoLength(
  editorSheet: SavedSheet,
  trackIds: DrumTrackId[],
  voicePart: VoicePart,
  step: number,
  barEndStep: number,
  noteLengthOverrides: Record<string, NoteLengthSteps>
): NoteLengthSteps {
  void editorSheet;
  void trackIds;
  void voicePart;
  void step;
  void barEndStep;
  void noteLengthOverrides;
  // Disable implicit auto length expansion.
  return STEPS_PER_32ND;
}

function clampNoteLengthToBar(step: number, barEndStep: number, requested: NoteLengthSteps): NoteLengthSteps {
  const remaining = Math.max(1, barEndStep - step);
  if (requested <= remaining) {
    return requested;
  }
  if (remaining >= STEPS_PER_QUARTER) return STEPS_PER_QUARTER;
  if (remaining >= STEPS_PER_8TH) return STEPS_PER_8TH;
  if (remaining >= STEPS_PER_16TH) return STEPS_PER_16TH;
  return STEPS_PER_32ND;
}

function resolveLengthForStep(
  _editorSheet: SavedSheet,
  _trackIds: DrumTrackId[],
  _voicePart: VoicePart,
  _step: number,
  _barEndStep: number,
  requested: NoteLengthSteps,
  _noteLengthOverrides: Record<string, NoteLengthSteps>
): NoteLengthSteps {
  // Keep the requested duration as-is (no auto shrinking to 16th/32nd).
  return requested;
}

function resolveVoiceStartAtStep(
  editorSheet: SavedSheet,
  trackIds: DrumTrackId[],
  voicePart: VoicePart,
  step: number,
  barEndStep: number,
  noteLengthOverrides: Record<string, NoteLengthSteps>
): { activeTracks: DrumTrackId[]; length: NoteLengthSteps } | null {
  const activeTracks = trackIds.filter((trackId) => editorSheet.pattern[trackId][step]);
  if (activeTracks.length === 0) {
    return null;
  }
  const overrideLength = noteLengthOverrides[buildDurationKey(voicePart, step)];
  const requestedLength = overrideLength ?? inferAutoLength(editorSheet, trackIds, voicePart, step, barEndStep, noteLengthOverrides);
  const resolvedLength = clampNoteLengthToBar(
    step,
    barEndStep,
    resolveLengthForStep(editorSheet, trackIds, voicePart, step, barEndStep, requestedLength, noteLengthOverrides)
  );
  return { activeTracks, length: resolvedLength };
}

function buildMergedFootStartSteps(
  editorSheet: SavedSheet,
  barStartStep: number,
  noteLengthOverrides: Record<string, NoteLengthSteps>
): Set<number> {
  const mergedSteps = new Set<number>();
  const barEndStep = barStartStep + editorSheet.stepsPerBar;
  for (let step = barStartStep; step < barEndStep; step += 1) {
    const handStart = resolveVoiceStartAtStep(editorSheet, HAND_TRACKS, "hand", step, barEndStep, noteLengthOverrides);
    if (!handStart) {
      continue;
    }
    const footStart = resolveVoiceStartAtStep(editorSheet, FOOT_TRACKS, "foot", step, barEndStep, noteLengthOverrides);
    if (!footStart) {
      continue;
    }
    if (handStart.length === footStart.length) {
      mergedSteps.add(step);
    }
  }
  return mergedSteps;
}

function buildVoiceTickables(
  editorSheet: SavedSheet,
  trackIds: DrumTrackId[],
  barStartStep: number,
  stemDirection: number,
  voicePart: VoicePart,
  noteLengthOverrides: Record<string, NoteLengthSteps>,
  mergedFootStartSteps?: Set<number>
): NotationTickable[] {
  const tickables: NotationTickable[] = [];
  let offset = 0;
  const barEndStep = barStartStep + editorSheet.stepsPerBar;
  while (offset < editorSheet.stepsPerBar) {
    const step = barStartStep + offset;
    const activeTracks = trackIds.filter((trackId) => editorSheet.pattern[trackId][step]);
    const canUseEighthRest = offset % STEPS_PER_8TH === 0 && offset + STEPS_PER_8TH - 1 < editorSheet.stepsPerBar;
    const canUseSixteenthRest = offset % STEPS_PER_16TH === 0 && offset + STEPS_PER_16TH - 1 < editorSheet.stepsPerBar;
    const hasAnyHitNow = hasAnyEventAtStep(editorSheet, step, noteLengthOverrides);
    const tickId = `tick-${voicePart}-${step}`;
    if (activeTracks.length === 0) {
      if (hasAnyHitNow) {
        tickables.push(createNotationSpacer("32", tickId));
        offset += STEPS_PER_32ND;
        continue;
      }
      if (
        offset % STEPS_PER_QUARTER === 0 &&
        step + STEPS_PER_QUARTER - 1 < barEndStep &&
        !hasAnyTrackHitInRange(editorSheet, step, step + STEPS_PER_QUARTER - 1, noteLengthOverrides)
      ) {
        tickables.push(createNotationRest("4", tickId));
        offset += STEPS_PER_QUARTER;
        continue;
      }
      if (canUseEighthRest && !hasAnyTrackHitInRange(editorSheet, step, step + STEPS_PER_8TH - 1, noteLengthOverrides)) {
        tickables.push(createNotationRest("8", tickId));
        offset += STEPS_PER_8TH;
        continue;
      }
      if (canUseSixteenthRest && !hasAnyTrackHitInRange(editorSheet, step, step + STEPS_PER_16TH - 1, noteLengthOverrides)) {
        tickables.push(createNotationRest("16", tickId));
        offset += STEPS_PER_16TH;
        continue;
      }
      tickables.push(createNotationRest("32", tickId));
      offset += STEPS_PER_32ND;
      continue;
    }

    const overrideLength = noteLengthOverrides[buildDurationKey(voicePart, step)];
    const requestedLength = overrideLength ?? inferAutoLength(editorSheet, trackIds, voicePart, step, barEndStep, noteLengthOverrides);
    const resolvedLength = clampNoteLengthToBar(
      step,
      barEndStep,
      resolveLengthForStep(editorSheet, trackIds, voicePart, step, barEndStep, requestedLength, noteLengthOverrides)
    );
    if (voicePart === "foot" && mergedFootStartSteps?.has(step)) {
      tickables.push(createNotationSpacer(mapStepsToDuration(resolvedLength), tickId));
      offset += resolvedLength;
      continue;
    }
    let noteTracks = activeTracks;
    if (voicePart === "hand" && mergedFootStartSteps?.has(step)) {
      const footTracksAtStep = FOOT_TRACKS.filter((trackId) => editorSheet.pattern[trackId][step]);
      if (footTracksAtStep.length > 0) {
        noteTracks = Array.from(new Set([...activeTracks, ...footTracksAtStep]));
      }
    }
    tickables.push(
      createNotationTickable(noteTracks, stemDirection, mapStepsToDuration(resolvedLength), `note-edit-${voicePart}-${step}`)
    );
    offset += resolvedLength;
  }
  return tickables;
}

function getBeamGroupEighthCount(timeSignature: TimeSignatureValue): number {
  if (timeSignature === "6/8" || timeSignature === "12/8") {
    return 3;
  }
  return 2;
}

function getTickableStepLength(tickable: NotationTickable): number {
  const duration = tickable.getDuration();
  if (duration.startsWith("4")) {
    return STEPS_PER_QUARTER;
  }
  if (duration.startsWith("8")) {
    return STEPS_PER_8TH;
  }
  if (duration.startsWith("16")) {
    return STEPS_PER_16TH;
  }
  return STEPS_PER_32ND;
}

function createDurationBeams(tickables: NotationTickable[], timeSignature: TimeSignatureValue, duration: "8" | "16" | "32"): Beam[] {
  const beams: Beam[] = [];
  let currentGroup: StaveNote[] = [];
  const groupSteps = getBeamGroupEighthCount(timeSignature) * STEPS_PER_8TH;
  let offsetInBarSteps = 0;
  const makeFlatBeam = (notes: StaveNote[]): Beam => {
    const beam = new Beam([...notes]);
    beam.renderOptions.flatBeams = true;
    return beam;
  };
  const flushGroup = (): void => {
    if (currentGroup.length > 1) {
      beams.push(makeFlatBeam(currentGroup));
    }
    currentGroup = [];
  };
  for (const tickable of tickables) {
    const durationSteps = getTickableStepLength(tickable);
    const startsAtGroupBoundary = offsetInBarSteps % groupSteps === 0;
    const endsAtGroupBoundary = (offsetInBarSteps + durationSteps) % groupSteps === 0;
    if (tickable instanceof StaveNote && !tickable.isRest() && tickable.getDuration() === duration) {
      if (startsAtGroupBoundary) {
        flushGroup();
      }
      currentGroup.push(tickable);
      offsetInBarSteps += durationSteps;
      if (endsAtGroupBoundary) {
        flushGroup();
      }
      continue;
    }
    flushGroup();
    offsetInBarSteps += durationSteps;
  }
  flushGroup();
  return beams;
}

function createGroupedBeams(tickables: NotationTickable[], timeSignature: TimeSignatureValue): Beam[] {
  return [
    ...createDurationBeams(tickables, timeSignature, "8"),
    ...createDurationBeams(tickables, timeSignature, "16"),
    ...createDurationBeams(tickables, timeSignature, "32")
  ];
}

function applyNotationStyleToTickables(tickables: NotationTickable[], fill: string, stroke: string): void {
  for (const tickable of tickables) {
    if (!(tickable instanceof StaveNote)) {
      continue;
    }
    tickable.setStyle({ fillStyle: fill, strokeStyle: stroke });
    tickable.setStemStyle({ strokeStyle: stroke });
    tickable.setLedgerLineStyle({ strokeStyle: stroke });
    for (const modifier of tickable.getModifiers()) {
      if ("setStyle" in modifier && typeof modifier.setStyle === "function") {
        modifier.setStyle({ fillStyle: fill, strokeStyle: stroke });
      }
    }
  }
}

function countBarHitVoices(sheet: SavedSheet, bar: number): number {
  const barStart = bar * sheet.stepsPerBar;
  const barEnd = barStart + sheet.stepsPerBar;
  let count = 0;
  for (let step = barStart; step < barEnd; step += 1) {
    if (HAND_TRACKS.some((trackId) => sheet.pattern[trackId][step])) {
      count += 1;
    }
    if (FOOT_TRACKS.some((trackId) => sheet.pattern[trackId][step])) {
      count += 1;
    }
  }
  return count;
}

function resolveScoreBarsPerLine(sheet: SavedSheet, paperWidth: number): number {
  const safeWidth = Number.isFinite(paperWidth) ? Math.max(320, paperWidth) : 980;
  const widthCap = safeWidth < 640 ? 2 : safeWidth < 1024 ? 3 : 4;
  const totalBars = Math.max(1, sheet.totalBars);
  const totalHitVoices = Array.from({ length: totalBars }, (_, bar) => countBarHitVoices(sheet, bar)).reduce((sum, value) => sum + value, 0);
  const avgHitsPerBar = totalHitVoices / totalBars;
  const densityBars = avgHitsPerBar >= 22 ? 2 : avgHitsPerBar >= 12 ? 3 : 4;
  return Math.max(2, Math.min(4, Math.min(widthCap, densityBars)));
}

function resolveScoreFirstRowBars(barsPerLine: number): number {
  if (barsPerLine <= 2) {
    return barsPerLine;
  }
  return 2;
}

function buildScoreRowBarPlan(totalBars: number, barsPerLine: number): number[] {
  const safeTotalBars = Math.max(1, totalBars);
  const safeBarsPerLine = Math.max(1, barsPerLine);
  const firstRowBars = Math.max(1, resolveScoreFirstRowBars(safeBarsPerLine));
  const plan: number[] = [];
  let remaining = safeTotalBars;
  let row = 0;
  while (remaining > 0) {
    const capacity = row === 0 ? firstRowBars : safeBarsPerLine;
    const barsInRow = Math.min(remaining, capacity);
    plan.push(barsInRow);
    remaining -= barsInRow;
    row += 1;
  }
  return plan;
}

function lockTickContextsToStepGrid(
  formatter: Formatter,
  barStartStep: number,
  barEndStep: number,
  stepCenters: number[],
  notationGridStart: number,
  notationStepWidth: number,
  stepOffsetMap?: Map<number, number>
): void {
  const tickContexts = formatter.getTickContexts();
  if (!tickContexts || tickContexts.list.length === 0) {
    return;
  }

  const getPriority = (tickable: NotationTickable): number => {
    if (tickable instanceof StaveNote) {
      return tickable.isRest() ? 1 : 2;
    }
    return 0;
  };
  const getAnchorCenterX = (tickable: NotationTickable): number => {
    if (tickable instanceof StaveNote && !tickable.isRest()) {
      const noteHeadBegin = tickable.getNoteHeadBeginX();
      const glyphWidth = tickable.getGlyphWidth();
      if (Number.isFinite(noteHeadBegin) && Number.isFinite(glyphWidth) && glyphWidth > 0) {
        return noteHeadBegin + glyphWidth * 0.5;
      }
    }
    const abs = tickable.getAbsoluteX();
    return Number.isFinite(abs) ? abs : Number.NaN;
  };
  const getAnchorAbsoluteX = (tickable: NotationTickable): number => {
    const abs = tickable.getAbsoluteX();
    return Number.isFinite(abs) ? abs : Number.NaN;
  };
  const getStepFromTickable = (tickable: NotationTickable): number | null => {
    const rawId = tickable.getAttribute("id");
    if (typeof rawId !== "string") {
      return null;
    }
    const matched = /^(?:note-edit|tick)-(?:hand|foot)-(\d+)$/.exec(rawId);
    if (!matched) {
      return null;
    }
    const step = Number.parseInt(matched[1], 10);
    if (!Number.isFinite(step)) {
      return null;
    }
    return step;
  };

  for (const tick of tickContexts.list) {
    const context = tickContexts.map[tick];
    if (!context) {
      continue;
    }
    const tickables = context.getTickables() as NotationTickable[];
    let anchor: NotationTickable | null = null;
    let anchorPriority = -1;

    for (const tickable of tickables) {
      const priority = getPriority(tickable);
      if (priority > anchorPriority) {
        anchor = tickable;
        anchorPriority = priority;
      }
    }

    if (!anchor) {
      continue;
    }
    let anchorStep = getStepFromTickable(anchor);
    if (anchorStep == null) {
      for (const tickable of tickables) {
        const fallbackStep = getStepFromTickable(tickable);
        if (fallbackStep != null) {
          anchorStep = fallbackStep;
          break;
        }
      }
    }
    if (anchorStep == null || anchorStep < barStartStep || anchorStep >= barEndStep) {
      continue;
    }
    const anchorAbsoluteX = getAnchorAbsoluteX(anchor);
    if (!Number.isFinite(anchorAbsoluteX)) {
      continue;
    }
    const currentCenterX = getAnchorCenterX(anchor);
    const centerOffset = Number.isFinite(currentCenterX) ? currentCenterX - anchorAbsoluteX : 0;
    const targetCenterX =
      (stepCenters[anchorStep] ?? notationGridStart + anchorStep * notationStepWidth + notationStepWidth * 0.5) +
      (stepOffsetMap?.get(anchorStep) ?? 0);
    const targetAnchorX = targetCenterX - centerOffset;
    const delta = targetAnchorX - anchorAbsoluteX;
    if (Math.abs(delta) > 0.05) {
      context.setX(context.getX() + delta);
    }
  }
}

interface DrumSampleManifest {
  version?: number;
  source?: string;
  tracks?: Partial<Record<DrumTrackId, DrumSampleOption[]>>;
}

interface DrumSampleOption {
  value: string;
  label: string;
}

interface SavedSheet {
  id: string;
  title: string;
  bpm: number;
  timeSignature: TimeSignatureValue;
  stepsPerBar: number;
  totalBars: number;
  pattern: DrumPattern;
  noteLengthOverrides?: Record<string, NoteLengthSteps>;
  selectedSamples: DrumTrackSampleMap;
  updatedAt: number;
}

interface BeatSelectionRange {
  trackStart: number;
  trackEnd: number;
  stepStart: number;
  stepEnd: number;
}

interface BeatClipboardBlock {
  width: number;
  height: number;
  values: boolean[][];
  noteLengthOverrides: Record<string, NoteLengthSteps>;
}

interface NotationDebugPoint {
  step: number;
  targetX: number;
  actualX: number;
}

interface ScoreStepPoint {
  x: number;
  top: number;
  height: number;
}

interface ScoreBarRect {
  x: number;
  top: number;
  width: number;
  height: number;
}

interface SheetTrackRowProps {
  track: (typeof TRACKS)[number];
  trackIndex: number;
  stepCount: number;
  visibleStepStart: number;
  visibleStepEnd: number;
  stepsPerBar: number;
  patternRow: boolean[];
  hasSelection: boolean;
  selectedTrackStart: number;
  selectedTrackEnd: number;
  selectedStepStart: number;
  selectedStepEnd: number;
  inputNoteLength: NoteLengthSteps;
  onGridMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onGridMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onGridClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

const SheetTrackRow = memo(
  function SheetTrackRow({
    track,
    trackIndex,
    stepCount,
    visibleStepStart,
    visibleStepEnd,
    stepsPerBar,
    patternRow,
    hasSelection,
    selectedTrackStart,
    selectedTrackEnd,
    selectedStepStart,
    selectedStepEnd,
    inputNoteLength,
    onGridMouseDown,
    onGridMouseEnter,
    onGridClick
  }: SheetTrackRowProps) {
    void inputNoteLength;
    const rowStyle = useMemo(() => ({ ["--sheet-step-count" as string]: stepCount }) as CSSProperties, [stepCount]);
    return (
      <div className="sheet-maker-row" style={rowStyle}>
        <div className="sheet-maker-track-control">
          <span className="sheet-maker-track-label">{track.label}</span>
        </div>
        {visibleStepStart > 0 ? <span className="sheet-maker-step-spacer" style={{ gridColumn: `span ${visibleStepStart}` }} /> : null}
        {Array.from({ length: Math.max(0, visibleStepEnd - visibleStepStart + 1) }, (_, index) => {
          const step = visibleStepStart + index;
          const active = patternRow[step];
          const barStart = step > 0 && step % stepsPerBar === 0;
          const selected =
            hasSelection &&
            trackIndex >= selectedTrackStart &&
            trackIndex <= selectedTrackEnd &&
            step >= selectedStepStart &&
            step <= selectedStepEnd;
          return (
            <button
              key={`${track.id}:${step}`}
              type="button"
              data-track-id={track.id}
              data-track-index={trackIndex}
              data-step={step}
              className={`sheet-maker-step-btn ${barStart ? "bar-start" : ""} ${active ? "active" : ""} ${selected ? "selected" : ""}`.trim()}
              onMouseDown={onGridMouseDown}
              onMouseEnter={onGridMouseEnter}
              onDragStart={(event) => event.preventDefault()}
              onClick={onGridClick}
              aria-label="비트 토글"
            />
          );
        })}
        {visibleStepEnd < stepCount - 1 ? (
          <span className="sheet-maker-step-spacer" style={{ gridColumn: `span ${stepCount - visibleStepEnd - 1}` }} />
        ) : null}
      </div>
    );
  },
  (prev, next) =>
    prev.track.id === next.track.id &&
    prev.trackIndex === next.trackIndex &&
    prev.stepCount === next.stepCount &&
    prev.visibleStepStart === next.visibleStepStart &&
    prev.visibleStepEnd === next.visibleStepEnd &&
    prev.stepsPerBar === next.stepsPerBar &&
    prev.patternRow === next.patternRow &&
    prev.hasSelection === next.hasSelection &&
    prev.selectedTrackStart === next.selectedTrackStart &&
    prev.selectedTrackEnd === next.selectedTrackEnd &&
    prev.selectedStepStart === next.selectedStepStart &&
    prev.selectedStepEnd === next.selectedStepEnd &&
    prev.inputNoteLength === next.inputNoteLength
);

function normalizeSelectionRange(selection: BeatSelectionRange): BeatSelectionRange {
  return {
    trackStart: Math.min(selection.trackStart, selection.trackEnd),
    trackEnd: Math.max(selection.trackStart, selection.trackEnd),
    stepStart: Math.min(selection.stepStart, selection.stepEnd),
    stepEnd: Math.max(selection.stepStart, selection.stepEnd)
  };
}

function makeEmptyPattern(totalSteps: number): DrumPattern {
  return TRACKS.reduce((acc, track) => {
    acc[track.id] = Array.from({ length: totalSteps }, () => false);
    return acc;
  }, {} as DrumPattern);
}

function cloneSamples(samples: DrumTrackSampleMap): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const value = samples[track.id];
    if (typeof value === "string" && value) {
      acc[track.id] = value;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

function emptySampleOptions(): Record<DrumTrackId, DrumSampleOption[]> {
  return TRACKS.reduce((acc, track) => {
    acc[track.id] = [];
    return acc;
  }, {} as Record<DrumTrackId, DrumSampleOption[]>);
}

function buildDefaultSamples(options: Record<DrumTrackId, DrumSampleOption[]>): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const first = options[track.id]?.[0];
    if (first) {
      acc[track.id] = first.value;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

function clonePattern(pattern: DrumPattern): DrumPattern {
  return TRACKS.reduce((acc, track) => {
    acc[track.id] = [...pattern[track.id]];
    return acc;
  }, {} as DrumPattern);
}

function resizePattern(pattern: DrumPattern, totalSteps: number): DrumPattern {
  return TRACKS.reduce((acc, track) => {
    const row = pattern[track.id].slice(0, totalSteps);
    if (row.length < totalSteps) {
      row.push(...Array.from({ length: totalSteps - row.length }, () => false));
    }
    acc[track.id] = row;
    return acc;
  }, {} as DrumPattern);
}

function cloneNoteLengthOverrides(value?: Record<string, NoteLengthSteps>): Record<string, NoteLengthSteps> {
  return value ? { ...value } : {};
}

function normalizeNoteLengthOverridesForPattern(
  editorSheet: SavedSheet | null,
  value: Record<string, NoteLengthSteps>
): Record<string, NoteLengthSteps> {
  if (!editorSheet) {
    return {};
  }
  const totalSteps = editorSheet.stepsPerBar * editorSheet.totalBars;
  const next: Record<string, NoteLengthSteps> = {};
  for (const [key, length] of Object.entries(value)) {
    const [voicePart, stepText] = key.split(":");
    if (voicePart !== "hand" && voicePart !== "foot") {
      continue;
    }
    if (length !== STEPS_PER_32ND && length !== STEPS_PER_16TH && length !== STEPS_PER_8TH && length !== STEPS_PER_QUARTER) {
      continue;
    }
    const step = Number.parseInt(stepText, 10);
    if (!Number.isFinite(step) || step < 0 || step >= totalSteps || step + length > totalSteps) {
      continue;
    }
    const barStartStep = Math.floor(step / editorSheet.stepsPerBar) * editorSheet.stepsPerBar;
    const barEndStep = barStartStep + editorSheet.stepsPerBar;
    if (step + length > barEndStep) {
      continue;
    }
    const voiceTracks = voicePart === "hand" ? HAND_TRACKS : FOOT_TRACKS;
    const hasStartHit = voiceTracks.some((trackId) => editorSheet.pattern[trackId][step]);
    if (!hasStartHit) {
      continue;
    }
    next[key] = length;
  }
  return next;
}

function cloneSheet(sheet: SavedSheet): SavedSheet {
  return {
    ...sheet,
    pattern: clonePattern(sheet.pattern),
    noteLengthOverrides: cloneNoteLengthOverrides(sheet.noteLengthOverrides),
    selectedSamples: cloneSamples(sheet.selectedSamples)
  };
}

function isSamePattern(a: DrumPattern, b: DrumPattern): boolean {
  for (const track of TRACKS) {
    const aRow = a[track.id];
    const bRow = b[track.id];
    if (aRow.length !== bRow.length) {
      return false;
    }
    for (let i = 0; i < aRow.length; i += 1) {
      if (aRow[i] !== bRow[i]) {
        return false;
      }
    }
  }
  return true;
}

function isSameSamples(a: DrumTrackSampleMap, b: DrumTrackSampleMap): boolean {
  for (const track of TRACKS) {
    if ((a[track.id] ?? "") !== (b[track.id] ?? "")) {
      return false;
    }
  }
  return true;
}

function isSameNoteLengthOverrides(a: Record<string, NoteLengthSteps> = {}, b: Record<string, NoteLengthSteps> = {}): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function mergeSamplesWithDefaults(samples: DrumTrackSampleMap, defaults: DrumTrackSampleMap): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const fromSheet = samples[track.id];
    if (typeof fromSheet === "string" && fromSheet) {
      acc[track.id] = fromSheet;
      return acc;
    }
    const fromDefault = defaults[track.id];
    if (typeof fromDefault === "string" && fromDefault) {
      acc[track.id] = fromDefault;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

function normalizeSamplesForOptions(
  samples: DrumTrackSampleMap,
  options: Record<DrumTrackId, DrumSampleOption[]>,
  defaults: DrumTrackSampleMap
): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const choices = options[track.id] ?? [];
    const value = samples[track.id];
    if (typeof value === "string" && value && choices.some((item) => item.value === value)) {
      acc[track.id] = value;
      return acc;
    }
    const fallback = defaults[track.id];
    if (typeof fallback === "string" && fallback && choices.some((item) => item.value === fallback)) {
      acc[track.id] = fallback;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

function mapStorageSamplesToTracks(stored: Record<string, string>): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const value = stored[track.id];
    if (typeof value === "string" && value) {
      acc[track.id] = value;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

const LEGACY_PATTERN_FALLBACKS: Partial<Record<DrumTrackId, string[]>> = {
  hi_hat_close: ["hi_hat"],
  crash_cymbal: ["splash_cymbal"]
};

const LEGACY_SAMPLE_FALLBACKS: Partial<Record<DrumTrackId, string[]>> = {
  hi_hat_close: ["hi_hat"],
  crash_cymbal: ["splash_cymbal"]
};

function parseBooleanStepRow(value: unknown, totalSteps: number): boolean[] | null {
  if (!Array.isArray(value) || value.length !== totalSteps || value.some((step) => typeof step !== "boolean")) {
    return null;
  }
  return [...value];
}

function parseNoteLengthOverrides(
  value: unknown,
  totalSteps: number,
  ratio: number
): Record<string, NoteLengthSteps> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const raw = value as Record<string, unknown>;
  const next: Record<string, NoteLengthSteps> = {};
  for (const [key, rawLength] of Object.entries(raw)) {
    const [voicePart, stepText] = key.split(":");
    if (voicePart !== "hand" && voicePart !== "foot") {
      continue;
    }
    const step = Number.parseInt(stepText, 10);
    const length = typeof rawLength === "number" ? rawLength : Number(rawLength);
    if (!Number.isFinite(step) || !Number.isFinite(length)) {
      continue;
    }
    const mappedStep = Math.max(0, Math.min(totalSteps - 1, Math.floor(step * ratio)));
    const mappedLength = Math.max(STEPS_PER_32ND, Math.round(length * ratio));
    let normalizedLength: NoteLengthSteps | null = null;
    if (mappedLength >= STEPS_PER_QUARTER) {
      normalizedLength = STEPS_PER_QUARTER;
    } else if (mappedLength >= STEPS_PER_8TH) {
      normalizedLength = STEPS_PER_8TH;
    } else if (mappedLength >= STEPS_PER_16TH) {
      normalizedLength = STEPS_PER_16TH;
    } else {
      normalizedLength = STEPS_PER_32ND;
    }
    if (mappedStep + normalizedLength > totalSteps) {
      continue;
    }
    next[buildDurationKey(voicePart, mappedStep)] = normalizedLength;
  }
  return next;
}

function remapPatternSteps(pattern: DrumPattern, fromTotalSteps: number, toTotalSteps: number): DrumPattern {
  if (fromTotalSteps === toTotalSteps) {
    return clonePattern(pattern);
  }
  const next = makeEmptyPattern(toTotalSteps);
  const ratio = toTotalSteps / fromTotalSteps;
  for (const track of TRACKS) {
    const row = pattern[track.id];
    for (let index = 0; index < row.length; index += 1) {
      if (!row[index]) {
        continue;
      }
      const mappedIndex = Math.max(0, Math.min(toTotalSteps - 1, Math.floor(index * ratio)));
      next[track.id][mappedIndex] = true;
    }
  }
  return next;
}

function parseSheet(value: unknown): SavedSheet | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const bpm = Number(record.bpm);
  const storedStepsPerBar = Number(record.stepsPerBar);
  const totalBars = Number(record.totalBars);
  const storedTotalSteps = storedStepsPerBar * totalBars;
  const parsedTimeSignature = typeof record.timeSignature === "string" ? record.timeSignature : "";
  const timeSignature = isTimeSignatureValue(parsedTimeSignature) ? parsedTimeSignature : inferTimeSignatureFromStepsPerBar(storedStepsPerBar);
  const normalizedStepsPerBar = resolveStepsPerBar(timeSignature);
  const legacyStepsPerBar = resolveLegacyStepsPerBar(timeSignature);
  const shouldUpgradeLegacyGrid = storedStepsPerBar === legacyStepsPerBar && normalizedStepsPerBar !== legacyStepsPerBar;
  const stepsPerBar = shouldUpgradeLegacyGrid ? normalizedStepsPerBar : storedStepsPerBar;
  const totalSteps = stepsPerBar * totalBars;
  const stepRatio = storedTotalSteps > 0 ? totalSteps / storedTotalSteps : 1;

  if (!title || !Number.isFinite(bpm) || !Number.isFinite(storedStepsPerBar) || !Number.isFinite(totalBars)) {
    return null;
  }
  if (bpm < 40 || bpm > 240 || storedStepsPerBar < 1 || totalBars < 1 || storedTotalSteps < 1) {
    return null;
  }
  if (typeof record.id !== "string" || !record.id) {
    return null;
  }
  if (typeof record.updatedAt !== "number" || !Number.isFinite(record.updatedAt)) {
    return null;
  }
  if (!record.pattern || typeof record.pattern !== "object") {
    return null;
  }

  const nextPattern = {} as DrumPattern;
  const pattern = record.pattern as Record<string, unknown>;
  let hasValidPatternRow = false;
  for (const track of TRACKS) {
    const keys = [track.id, ...(LEGACY_PATTERN_FALLBACKS[track.id] ?? [])];
    let resolved: boolean[] | null = null;
    for (const key of keys) {
      const parsedRow = parseBooleanStepRow(pattern[key], storedTotalSteps);
      if (parsedRow) {
        resolved = parsedRow;
        break;
      }
    }
    if (resolved) {
      nextPattern[track.id] = resolved;
      hasValidPatternRow = true;
      continue;
    }
    nextPattern[track.id] = Array.from({ length: storedTotalSteps }, () => false);
  }
  if (!hasValidPatternRow) {
    return null;
  }
  const normalizedPattern = shouldUpgradeLegacyGrid
    ? remapPatternSteps(nextPattern, storedTotalSteps, totalSteps)
    : nextPattern;
  const noteLengthOverrides = parseNoteLengthOverrides(record.noteLengthOverrides, totalSteps, stepRatio);

  const nextSamples: DrumTrackSampleMap = {};
  if (record.selectedSamples && typeof record.selectedSamples === "object") {
    const selected = record.selectedSamples as Record<string, unknown>;
    for (const track of TRACKS) {
      const keys = [track.id, ...(LEGACY_SAMPLE_FALLBACKS[track.id] ?? [])];
      for (const key of keys) {
        const sample = selected[key];
        if (typeof sample === "string" && sample) {
          nextSamples[track.id] = sample;
          break;
        }
      }
    }
  }

  return {
    id: record.id,
    title,
    bpm,
    timeSignature,
    stepsPerBar,
    totalBars,
    updatedAt: record.updatedAt,
    pattern: normalizedPattern,
    noteLengthOverrides,
    selectedSamples: nextSamples
  };
}

function readSavedSheetsFromLocal(): SavedSheet[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(SHEET_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => parseSheet(item))
      .filter((item): item is SavedSheet => item != null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeSavedSheetsToLocal(sheets: SavedSheet[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(SHEET_STORAGE_KEY, JSON.stringify(sheets));
  } catch {
    // ignore storage write failures
  }
}

function buildWeWillRockYouSheet(): SavedSheet {
  const stepsPerBar = resolveStepsPerBar("4/4");
  const totalBars = 2;
  const totalSteps = stepsPerBar * totalBars;
  const pattern = makeEmptyPattern(totalSteps);
  const stompInBar = [0, 8];
  const clapInBar = [16];

  for (let bar = 0; bar < totalBars; bar += 1) {
    const offset = bar * stepsPerBar;
    for (const step of stompInBar) {
      pattern.kick[offset + step] = true;
      pattern.floor_tom[offset + step] = true;
    }
    for (const step of clapInBar) {
      pattern.snare[offset + step] = true;
    }
  }

  return {
    id: DEFAULT_WE_WILL_ROCK_YOU_ID,
    title: DEFAULT_WE_WILL_ROCK_YOU_TITLE,
    bpm: 81,
    timeSignature: "4/4",
    stepsPerBar,
    totalBars,
    pattern,
    noteLengthOverrides: {},
    selectedSamples: {},
    updatedAt: 1767225600000
  };
}

function normalizeLegacySheetTitle(sheet: SavedSheet): SavedSheet {
  if (sheet.id !== DEFAULT_WE_WILL_ROCK_YOU_ID) {
    return sheet;
  }
  if (sheet.title === DEFAULT_WE_WILL_ROCK_YOU_TITLE) {
    return sheet;
  }
  return {
    ...sheet,
    title: DEFAULT_WE_WILL_ROCK_YOU_TITLE
  };
}

function withDefaultSheets(sheets: SavedSheet[]): SavedSheet[] {
  const next = sheets.map((sheet) => normalizeLegacySheetTitle(sheet));
  if (!next.some((sheet) => sheet.id === DEFAULT_WE_WILL_ROCK_YOU_ID)) {
    next.unshift(buildWeWillRockYouSheet());
  }
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  return next;
}

export function SheetPlayView() {
  const [titleInput, setTitleInput] = useState("새 악보");
  const [bpmInput, setBpmInput] = useState(90);
  const [timeSignatureInput, setTimeSignatureInput] = useState<TimeSignatureValue>("4/4");
  const [totalBarsInput, setTotalBarsInput] = useState<number>(4);
  const [savedSheets, setSavedSheets] = useState<SavedSheet[]>(() => withDefaultSheets(readSavedSheetsFromLocal()));
  const [sampleOptions, setSampleOptions] = useState<Record<DrumTrackId, DrumSampleOption[]>>(() => emptySampleOptions());
  const [defaultSamples, setDefaultSamples] = useState<DrumTrackSampleMap>({});
  const [globalSamples, setGlobalSamples] = useState<DrumTrackSampleMap>({});
  const [, setSampleLoadedCount] = useState(0);
  const [sampleLoadError, setSampleLoadError] = useState("");
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [editorSheet, setEditorSheet] = useState<SavedSheet | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [metronomeSettings, setMetronomeSettings] = useState<MetronomeSettings>(() => readMetronomeSettings());
  const [editTitleInput, setEditTitleInput] = useState("");
  const [editTimeSignatureInput, setEditTimeSignatureInput] = useState<TimeSignatureValue>("4/4");
  const [editTotalBarsInput, setEditTotalBarsInput] = useState<number>(4);
  const [running, setRunning] = useState(false);
  const [countInActive, setCountInActive] = useState(false);
  const [countInEnabled, setCountInEnabled] = useState(true);
  const [metronomeSyncEnabled, setMetronomeSyncEnabled] = useState(false);
  const [inputNoteLength, setInputNoteLength] = useState<NoteLengthSteps>(STEPS_PER_16TH);
  const [currentStep, setCurrentStep] = useState(0);
  const [, setSheetMessage] = useState("");
  const [showTrackGrid, setShowTrackGrid] = useState(true);
  const [sheetViewMode, setSheetViewMode] = useState<SheetViewMode>("edit");
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(`(max-width: ${MOBILE_SCORE_BREAKPOINT}px)`).matches;
  });
  const [beatSelection, setBeatSelection] = useState<BeatSelectionRange | null>(null);
  const [dragAnchor, setDragAnchor] = useState<{ trackIndex: number; step: number } | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [noteLengthOverrides, setNoteLengthOverrides] = useState<Record<string, NoteLengthSteps>>({});
  const [notationStepWidth, setNotationStepWidth] = useState(DEFAULT_NOTATION_STEP_WIDTH);
  const [notationGridStart, setNotationGridStart] = useState(DEFAULT_NOTATION_GRID_START);
  const [notationGridRight, setNotationGridRight] = useState(DEFAULT_NOTATION_GRID_START + DEFAULT_NOTATION_STEP_WIDTH * 32);
  const [stepCenters, setStepCenters] = useState<number[]>([]);
  const [visibleStepRange, setVisibleStepRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [showNotationDebug] = useState(false);
  const [notationDebugPoints, setNotationDebugPoints] = useState<NotationDebugPoint[]>([]);
  const [notationSurfaceOffsetX, setNotationSurfaceOffsetX] = useState(0);
  const [scorePaperWidth, setScorePaperWidth] = useState(0);
  const [scoreStepPoints, setScoreStepPoints] = useState<ScoreStepPoint[]>([]);
  const [scoreBarRects, setScoreBarRects] = useState<ScoreBarRect[]>([]);
  const timerRef = useRef<number | null>(null);
  const countInTimerRef = useRef<number[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sampleBufferRef = useRef<Partial<Record<DrumTrackId, AudioBuffer>>>({});
  const sampleBufferUrlRef = useRef<Partial<Record<DrumTrackId, string>>>({});
  const sampleLoadPromiseRef = useRef<Record<string, Promise<AudioBuffer | null>>>({});
  const defaultSamplesRef = useRef(defaultSamples);
  const globalSamplesRef = useRef(globalSamples);
  const selectionClipboardRef = useRef<BeatClipboardBlock | null>(null);
  const dragMovedRef = useRef(false);
  const dragAnchorRef = useRef<{ trackIndex: number; step: number } | null>(null);
  const gpFileInputRef = useRef<HTMLInputElement | null>(null);
  const trackGridScrollRef = useRef<HTMLDivElement | null>(null);
  const notationSurfaceRef = useRef<HTMLDivElement | null>(null);
  const scorePaperRef = useRef<HTMLDivElement | null>(null);
  const scoreNotationWrapRef = useRef<HTMLDivElement | null>(null);
  const scoreNotationSurfaceRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef(editorSheet);
  const noteLengthOverridesRef = useRef(noteLengthOverrides);
  const currentStepRef = useRef(0);
  const lastUiStepSyncAtRef = useRef(0);
  const transportStartTimeRef = useRef<number | null>(null);
  const transportStartStepRef = useRef(0);
  const nextScheduledStepRef = useRef(0);
  const nextScheduledStepTimeRef = useRef(0);
  const playheadDragActiveRef = useRef(false);
  const countInSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
  const syncedMetronomeEnabledRef = useRef(false);
  const syncedMetronomeNextTickTimeRef = useRef(0);
  const syncedMetronomeTickIndexRef = useRef(0);
  const syncedMetronomeBeatsPerBarRef = useRef(4);
  const syncedMetronomeSubdivisionsRef = useRef(1);
  const syncedMetronomeSecondsPerTickRef = useRef(0.5);
  const canSaveSheet = (() => {
    if (!editorSheet) {
      return false;
    }
    const base = savedSheets.find((sheet) => sheet.id === editorSheet.id);
    if (!base) {
      return true;
    }
    const sameMeta =
      editorSheet.title === base.title &&
      editorSheet.bpm === base.bpm &&
      editorSheet.timeSignature === base.timeSignature &&
      editorSheet.stepsPerBar === base.stepsPerBar &&
      editorSheet.totalBars === base.totalBars;
    const samePattern = isSamePattern(editorSheet.pattern, base.pattern);
    const sameNoteLengths = isSameNoteLengthOverrides(noteLengthOverrides, base.noteLengthOverrides ?? {});
    return !(sameMeta && samePattern && sameNoteLengths);
  })();
  const sampleSelectionKey = TRACKS.map((track) => globalSamples[track.id] ?? defaultSamples[track.id] ?? "").join("|");
  const metronomeSyncBpm = editorSheet?.bpm ?? 0;
  const metronomeSyncTimeSignature = editorSheet?.timeSignature ?? "4/4";
  const metronomeSyncSubdivision = metronomeSettings.subdivision;
  const isScoreFullscreen = sheetViewMode === "score";

  useEffect(() => {
    editorRef.current = editorSheet;
  }, [editorSheet]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_SCORE_BREAKPOINT}px)`);
    const handleViewportChange = (): void => {
      setIsMobileViewport(mediaQuery.matches);
    };
    handleViewportChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleViewportChange);
      return () => {
        mediaQuery.removeEventListener("change", handleViewportChange);
      };
    }

    window.addEventListener("resize", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    if (!isScoreFullscreen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isScoreFullscreen]);

  useEffect(() => {
    function handleMetronomeEvent(event: Event): void {
      const custom = event as CustomEvent<MetronomeSettings>;
      if (custom.detail) {
        setMetronomeSettings(custom.detail);
        return;
      }
      setMetronomeSettings(readMetronomeSettings());
    }

    window.addEventListener(METRONOME_SETTINGS_EVENT, handleMetronomeEvent as EventListener);
    return () => window.removeEventListener(METRONOME_SETTINGS_EVENT, handleMetronomeEvent as EventListener);
  }, []);

  useEffect(() => {
    noteLengthOverridesRef.current = noteLengthOverrides;
  }, [noteLengthOverrides]);

  useEffect(() => {
    defaultSamplesRef.current = defaultSamples;
  }, [defaultSamples]);

  useEffect(() => {
    globalSamplesRef.current = globalSamples;
  }, [globalSamples]);

  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  useEffect(() => {
    dragAnchorRef.current = dragAnchor;
  }, [dragAnchor]);

  useEffect(() => {
    const normalized = normalizeNoteLengthOverridesForPattern(editorSheet, noteLengthOverridesRef.current);
    if (!isSameNoteLengthOverrides(normalized, noteLengthOverridesRef.current)) {
      noteLengthOverridesRef.current = normalized;
      setNoteLengthOverrides(normalized);
    }
  }, [editorSheet]);

  useEffect(() => {
    if (savedSheets.length === 0) {
      setSelectedSheetId("");
      return;
    }
    if (!savedSheets.some((sheet) => sheet.id === selectedSheetId)) {
      setSelectedSheetId(savedSheets[0].id);
    }
  }, [savedSheets, selectedSheetId]);

  useEffect(() => {
    writeSavedSheetsToLocal(savedSheets);
  }, [savedSheets]);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedSheetsFromDb(): Promise<void> {
      try {
        const response = await getDrumSheets();
        const loadedFromDb = response.items
          .map((item) => parseSheet(item))
          .filter((item): item is SavedSheet => item != null)
          .sort((a, b) => b.updatedAt - a.updatedAt);

        if (cancelled) {
          return;
        }

        if (loadedFromDb.length > 0) {
          setSavedSheets(withDefaultSheets(loadedFromDb));
          return;
        }

        const localSheets = readSavedSheetsFromLocal();
        if (localSheets.length === 0) {
          setSavedSheets(withDefaultSheets([]));
          return;
        }

        for (const local of localSheets) {
          await upsertDrumSheet({
            id: local.id,
            title: local.title,
            bpm: local.bpm,
            timeSignature: local.timeSignature,
            stepsPerBar: local.stepsPerBar,
            totalBars: local.totalBars,
            pattern: local.pattern,
            noteLengthOverrides: local.noteLengthOverrides ?? {},
            selectedSamples: local.selectedSamples,
            updatedAt: local.updatedAt
          });
        }

        if (!cancelled) {
          setSavedSheets(withDefaultSheets(localSheets));
          setToastMessage("로컬 악보를 DB로 옮겼습니다.");
        }
      } catch {
        if (!cancelled) {
          const localSheets = readSavedSheetsFromLocal();
          setSavedSheets(withDefaultSheets(localSheets));
          setToastMessage("DB 연결 실패로 로컬 악보를 표시합니다.");
        }
      }
    }

    void loadSavedSheetsFromDb();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadManifest(): Promise<void> {
      try {
        const response = await fetch("/real-drum/manifest.json");
        if (!response.ok) {
          throw new Error(`?섑뵆 紐⑸줉 濡쒕뱶 ?ㅽ뙣 (${response.status})`);
        }
        const parsed = (await response.json()) as DrumSampleManifest;
        if (!parsed || typeof parsed !== "object" || !parsed.tracks || typeof parsed.tracks !== "object") {
          throw new Error("?섑뵆 紐⑸줉 ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎.");
        }
        if (cancelled) return;

        const nextOptions = emptySampleOptions();
        const tracksRecord = parsed.tracks as Record<string, unknown>;
        for (const track of TRACKS) {
          const rawOptions = tracksRecord[track.id];
          if (!Array.isArray(rawOptions)) continue;
          nextOptions[track.id] = rawOptions
            .map((option, index) => {
              if (!option || typeof option !== "object") {
                return null;
              }
              const record = option as Record<string, unknown>;
              const value = typeof record.value === "string" ? record.value : "";
              if (!value) {
                return null;
              }
              const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : `${track.label} ${index + 1}`;
              return { value, label };
            })
            .filter((option): option is DrumSampleOption => option != null);
        }
        const availableTrackCount = TRACKS.filter((track) => nextOptions[track.id].length > 0).length;
        if (availableTrackCount === 0) {
          throw new Error("?ъ슜 媛?ν븳 ?몃옓 ?섑뵆???놁뒿?덈떎.");
        }

        const defaults = buildDefaultSamples(nextOptions);
        const storedGlobalSamples = mapStorageSamplesToTracks(readDrumSampleSettings());
        const normalizedGlobalSamples = normalizeSamplesForOptions(storedGlobalSamples, nextOptions, defaults);

        setSampleOptions(nextOptions);
        setDefaultSamples(defaults);
        setGlobalSamples(normalizedGlobalSamples);
      } catch (err) {
        if (!cancelled) {
          setSampleLoadError(err instanceof Error ? err.message : "?섑뵆 紐⑸줉 濡쒕뱶 ?ㅽ뙣");
        }
      }
    }

    void loadManifest();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (Object.values(sampleOptions).every((options) => options.length === 0)) {
      return;
    }
    const syncFromSettings = (): void => {
      const storedGlobalSamples = mapStorageSamplesToTracks(readDrumSampleSettings());
      const normalizedGlobalSamples = normalizeSamplesForOptions(storedGlobalSamples, sampleOptions, defaultSamples);
      setGlobalSamples((prev) => {
        if (isSameSamples(prev, normalizedGlobalSamples)) {
          return prev;
        }
        return normalizedGlobalSamples;
      });
    };
    syncFromSettings();
    window.addEventListener(DRUM_SAMPLE_SETTINGS_EVENT, syncFromSettings as EventListener);
    return () => {
      window.removeEventListener(DRUM_SAMPLE_SETTINGS_EVENT, syncFromSettings as EventListener);
    };
  }, [sampleOptions, defaultSamples]);

  useEffect(() => {
    const activeSamples = mergeSamplesWithDefaults(globalSamples, defaultSamples);
    const selectedCount = TRACKS.reduce((acc, track) => (activeSamples[track.id] ? acc + 1 : acc), 0);
    if (selectedCount === 0) return;

    let cancelled = false;
    async function loadSamplesForTracks(): Promise<void> {
      setSampleLoadError("");
      setSampleLoadedCount(0);
      let loadedCount = 0;

      for (const track of TRACKS) {
        const sampleUrl = activeSamples[track.id];
        if (!sampleUrl) {
          delete sampleBufferRef.current[track.id];
          delete sampleBufferUrlRef.current[track.id];
          continue;
        }
        try {
          const decoded = await ensureTrackSampleBuffer(track.id, sampleUrl);
          if (!decoded) {
            throw new Error(`${track.label} 샘플 로드 실패`);
          }
          loadedCount += 1;
          if (!cancelled) {
            setSampleLoadedCount(loadedCount);
          }
        } catch (err) {
          if (!cancelled) {
            setSampleLoadError(err instanceof Error ? err.message : `${track.label} 샘플 로드 실패`);
          }
        }
      }
    }

    void loadSamplesForTracks();
    return () => {
      cancelled = true;
    };
  }, [sampleSelectionKey]);

  useEffect(() => {
    if (!running || !editorSheet) {
      return;
    }
    const totalSteps = editorSheet.stepsPerBar * editorSheet.totalBars;
    const stepsPerBar = editorSheet.stepsPerBar;
    const startStep = clampStepIndex(transportStartStepRef.current, totalSteps);
    const stepSec = getStepDurationMs(editorSheet) / 1000;
    const lookAheadSec = 0.24;
    const scheduleIntervalMs = 24;
    const ctx = getAudioContext();
    const startAt = transportStartTimeRef.current ?? ctx.currentTime + 0.03;
    transportStartTimeRef.current = startAt;
    if (nextScheduledStepTimeRef.current <= 0 || nextScheduledStepTimeRef.current < startAt - stepSec) {
      nextScheduledStepRef.current = startStep;
      nextScheduledStepTimeRef.current = startAt;
    }
    if (nextScheduledStepRef.current < 0 || nextScheduledStepRef.current >= totalSteps) {
      nextScheduledStepRef.current = startStep;
    }

    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
    }
    let cancelled = false;

    const schedule = (): void => {
      if (cancelled) {
        return;
      }
      const nowSec = ctx.currentTime;
      let guard = 0;
      const maxQueuedSteps = Math.max(8, Math.ceil((lookAheadSec / Math.max(0.0005, stepSec)) * 3));

      while (nextScheduledStepTimeRef.current <= nowSec + lookAheadSec && guard < maxQueuedSteps) {
        const step = nextScheduledStepRef.current;
        playStep(step, nextScheduledStepTimeRef.current);
        nextScheduledStepRef.current = (step + 1) % totalSteps;
        nextScheduledStepTimeRef.current += stepSec;
        guard += 1;
      }

      if (syncedMetronomeEnabledRef.current && syncedMetronomeSecondsPerTickRef.current > 0) {
        let metronomeGuard = 0;
        const maxQueuedTicks = Math.max(8, Math.ceil((lookAheadSec / Math.max(0.0005, syncedMetronomeSecondsPerTickRef.current)) * 3));
        while (syncedMetronomeNextTickTimeRef.current <= nowSec + lookAheadSec && metronomeGuard < maxQueuedTicks) {
          const tickIndex = syncedMetronomeTickIndexRef.current;
          const subdivisionsPerBeat = Math.max(1, syncedMetronomeSubdivisionsRef.current);
          const beatsPerBar = Math.max(1, syncedMetronomeBeatsPerBarRef.current);
          const tickInBeat = tickIndex % subdivisionsPerBeat;
          const beatInBar = Math.floor(tickIndex / subdivisionsPerBeat) % beatsPerBar;
          const tickType: "bar" | "beat" | "sub" = tickInBeat === 0 ? (beatInBar === 0 ? "bar" : "beat") : "sub";
          triggerSyncedMetronomeTick(tickType, syncedMetronomeNextTickTimeRef.current);
          syncedMetronomeTickIndexRef.current = tickIndex + 1;
          syncedMetronomeNextTickTimeRef.current += syncedMetronomeSecondsPerTickRef.current;
          metronomeGuard += 1;
        }
      }

      const elapsedSec = nowSec - startAt;
      if (elapsedSec >= 0) {
        const uiStep = (startStep + Math.floor(elapsedSec / stepSec)) % totalSteps;
        const nowPerf = performance.now();
        const hitBarStart = uiStep % stepsPerBar === 0;
        const uiSyncIntervalMs = 180;
        if (uiStep !== currentStepRef.current && (hitBarStart || nowPerf - lastUiStepSyncAtRef.current >= uiSyncIntervalMs)) {
          currentStepRef.current = uiStep;
          lastUiStepSyncAtRef.current = nowPerf;
          setCurrentStep(uiStep);
        }
      }

      timerRef.current = window.setTimeout(schedule, scheduleIntervalMs);
    };

    schedule();

    return () => {
      cancelled = true;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [running, editorSheet]);

  useEffect(() => {
    if (!running || !editorSheet || !metronomeSyncEnabled) {
      stopSyncedMetronome();
      return;
    }
    try {
      const activeSheet = editorRef.current;
      if (activeSheet) {
        startSyncedMetronome(activeSheet);
      }
    } catch {
      setToastMessage("메트로놈 연동 재생에 실패했습니다.");
    }
    return () => {
      stopSyncedMetronome();
    };
  }, [running, metronomeSyncEnabled, metronomeSyncBpm, metronomeSyncTimeSignature, metronomeSyncSubdivision]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      for (const timeoutId of countInTimerRef.current) {
        window.clearTimeout(timeoutId);
      }
      countInTimerRef.current = [];
      for (const source of countInSourcesRef.current) {
        try {
          source.stop();
        } catch {
          // ignore; source may already be ended.
        }
      }
      countInSourcesRef.current = [];
      stopSyncedMetronome();
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  function getAudioContext(): AudioContext {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }

  async function ensureTrackSampleBuffer(trackId: DrumTrackId, sampleUrl: string): Promise<AudioBuffer | null> {
    const existing = sampleBufferRef.current[trackId];
    if (existing && sampleBufferUrlRef.current[trackId] === sampleUrl) {
      return existing;
    }

    const key = `${trackId}::${sampleUrl}`;
    const inFlight = sampleLoadPromiseRef.current[key];
    if (inFlight) {
      return inFlight;
    }

    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const ctx = getAudioContext();
        const response = await fetch(sampleUrl);
        if (!response.ok) {
          throw new Error(`${trackId} sample load failed (${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        sampleBufferRef.current = {
          ...sampleBufferRef.current,
          [trackId]: decoded
        };
        sampleBufferUrlRef.current = {
          ...sampleBufferUrlRef.current,
          [trackId]: sampleUrl
        };
        return decoded;
      } catch {
        return null;
      } finally {
        delete sampleLoadPromiseRef.current[key];
      }
    })();

    sampleLoadPromiseRef.current[key] = promise;
    return promise;
  }

  function getActiveSampleUrl(trackId: DrumTrackId): string {
    const activeSamples = globalSamplesRef.current;
    const defaults = defaultSamplesRef.current;
    return activeSamples[trackId] ?? defaults[trackId] ?? "";
  }

  function triggerTrack(trackId: DrumTrackId, atTimeSec?: number, allowFallback = true): void {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.0005, atTimeSec ?? now);
    const activeSampleUrl = getActiveSampleUrl(trackId);
    const sample = sampleBufferUrlRef.current[trackId] === activeSampleUrl ? sampleBufferRef.current[trackId] : undefined;
    if (sample) {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      let gainValue = 1;
      if (trackId === "hi_hat_open") gainValue = 0.78;
      if (trackId === "hi_hat_close") gainValue = 0.72;
      if (trackId === "foot_hi_hat") gainValue = 0.66;
      if (trackId === "ride_cymbal") gainValue = 0.68;
      if (trackId === "crash_cymbal") gainValue = 0.8;
      if (trackId === "rimshot") gainValue = 0.9;
      if (trackId === "sidestick") gainValue = 0.84;
      source.buffer = sample;
      gain.gain.value = gainValue;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(startAt);
      return;
    }
    if (!allowFallback) {
      return;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    let frequency = 220;
    let wave: OscillatorType = "triangle";
    let peak = 0.16;
    let release = 0.08;

    switch (trackId) {
      case "kick":
        frequency = 92;
        wave = "sine";
        peak = 0.26;
        release = 0.12;
        osc.frequency.setValueAtTime(120, startAt);
        osc.frequency.exponentialRampToValueAtTime(62, startAt + release);
        break;
      case "snare":
        frequency = 220;
        wave = "triangle";
        peak = 0.2;
        release = 0.08;
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
      case "rimshot":
        frequency = 340;
        wave = "square";
        peak = 0.18;
        release = 0.06;
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
      case "sidestick":
        frequency = 420;
        wave = "triangle";
        peak = 0.13;
        release = 0.05;
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
      case "high_tom":
        frequency = 210;
        wave = "sine";
        peak = 0.2;
        release = 0.09;
        osc.frequency.setValueAtTime(260, startAt);
        osc.frequency.exponentialRampToValueAtTime(190, startAt + release);
        break;
      case "mid_tom":
        frequency = 160;
        wave = "sine";
        peak = 0.2;
        release = 0.1;
        osc.frequency.setValueAtTime(200, startAt);
        osc.frequency.exponentialRampToValueAtTime(130, startAt + release);
        break;
      case "floor_tom":
        frequency = 126;
        wave = "sine";
        peak = 0.22;
        release = 0.12;
        osc.frequency.setValueAtTime(160, startAt);
        osc.frequency.exponentialRampToValueAtTime(96, startAt + release);
        break;
      case "ride_cymbal":
        frequency = 960;
        wave = "triangle";
        peak = 0.1;
        release = 0.08;
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
      case "hi_hat_open":
        frequency = 760;
        wave = "square";
        peak = 0.11;
        release = 0.12;
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
      case "hi_hat_close":
        frequency = 920;
        wave = "square";
        peak = 0.1;
        release = 0.045;
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
      case "foot_hi_hat":
        frequency = 640;
        wave = "square";
        peak = 0.08;
        release = 0.035;
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
      case "crash_cymbal":
        frequency = 740;
        wave = "square";
        peak = 0.12;
        release = 0.13;
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
      default:
        osc.frequency.setValueAtTime(frequency, startAt);
        break;
    }

    osc.type = wave;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.0025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + release);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + release + 0.01);
  }

  function triggerCountInClick(accent: boolean, atTimeSec?: number, registerForCancel = false): void {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.0005, atTimeSec ?? now);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const peak = accent ? 0.17 : 0.13;
    const release = 0.045;
    osc.type = "square";
    osc.frequency.setValueAtTime(accent ? 1320 : 1120, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + release);
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (registerForCancel) {
      countInSourcesRef.current.push(osc);
      osc.onended = () => {
        const index = countInSourcesRef.current.indexOf(osc);
        if (index >= 0) {
          countInSourcesRef.current.splice(index, 1);
        }
      };
    }
    osc.start(startAt);
    osc.stop(startAt + release + 0.01);
  }

  function triggerSyncedMetronomeTick(tickType: "bar" | "beat" | "sub", atTimeSec: number): void {
    const ctx = getAudioContext();
    const startAt = Math.max(ctx.currentTime + 0.0005, atTimeSec);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const metronomeVolume = Number.isFinite(metronomeSettings.volume)
      ? Math.max(0, Math.min(1, metronomeSettings.volume))
      : 1;
    let frequency = 900;
    let peakGain = 0.17;
    let releaseTime = 0.05;

    if (tickType === "bar") {
      frequency = 1240;
      peakGain = 0.24;
      releaseTime = 0.06;
    } else if (tickType === "sub") {
      frequency = 760;
      peakGain = 0.11;
      releaseTime = 0.036;
    }

    osc.frequency.value = frequency;
    const scaledPeakGain = Math.max(0.0001, peakGain * metronomeVolume);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(scaledPeakGain, startAt + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + releaseTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + releaseTime + 0.01);
  }

  function playStep(step: number, atTimeSec?: number): void {
    const active = editorRef.current;
    if (!active) {
      return;
    }
    for (const track of TRACKS) {
      if (active.pattern[track.id][step]) {
        triggerTrack(track.id, atTimeSec, true);
      }
    }
  }

  function clearCountInTimers(): void {
    if (countInTimerRef.current.length === 0) {
      return;
    }
    for (const timeoutId of countInTimerRef.current) {
      window.clearTimeout(timeoutId);
    }
    countInTimerRef.current = [];
  }

  function buildSyncedMetronomeSettings(sheet: SavedSheet): MetronomeSettings {
    const source = metronomeSettings;
    const metronomeBeatsPerBar = Math.max(1, Math.min(12, Math.round(getMetronomeSyncBeatsPerBar(sheet.timeSignature))));
    const bpm = Math.max(40, Math.min(240, sheet.bpm));
    return {
      bpm,
      timeSignature: `${metronomeBeatsPerBar}/4`,
      subdivision: source.subdivision ?? "quarter",
      volume: source.volume,
      running: false
    };
  }

  function startSyncedMetronome(sheet: SavedSheet): void {
    const settings = buildSyncedMetronomeSettings(sheet);
    const transportBeatsPerBar = Math.max(1, getTransportQuarterBeatsPerBar(sheet.timeSignature));
    const beatsPerBarRaw = Number.parseInt(settings.timeSignature.split("/")[0], 10);
    const beatsPerBar = Number.isFinite(beatsPerBarRaw) && beatsPerBarRaw > 0 ? beatsPerBarRaw : 4;
    const subdivisionsPerBeat = METRONOME_SUBDIVISION_STEPS[settings.subdivision] ?? 1;
    const engineBpmRaw = settings.bpm * (beatsPerBar / transportBeatsPerBar);
    const engineBpm = Math.max(40, Math.min(240, engineBpmRaw));
    const fallbackStartAt = getAudioContext().currentTime + (metronomeSyncEnabled ? 0.16 : 0.06);
    const startAt = transportStartTimeRef.current ?? fallbackStartAt;
    window.dispatchEvent(new Event(METRONOME_FORCE_STOP_EVENT));
    emitMetronomeSettings(settings);
    emitMetronomeVisualState({ ...settings, bpm: engineBpm, running: true });
    syncedMetronomeBeatsPerBarRef.current = beatsPerBar;
    syncedMetronomeSubdivisionsRef.current = Math.max(1, subdivisionsPerBeat);
    syncedMetronomeSecondsPerTickRef.current = 60 / engineBpm / Math.max(1, subdivisionsPerBeat);
    syncedMetronomeNextTickTimeRef.current = startAt;
    syncedMetronomeTickIndexRef.current = 0;
    syncedMetronomeEnabledRef.current = true;
  }

  function stopSyncedMetronome(): void {
    syncedMetronomeEnabledRef.current = false;
    syncedMetronomeTickIndexRef.current = 0;
    syncedMetronomeNextTickTimeRef.current = 0;
    const settings = readMetronomeSettings();
    emitMetronomeVisualState({ ...settings, running: false });
  }

  function stopPlaybackTransport(): void {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    transportStartTimeRef.current = null;
    transportStartStepRef.current = currentStepRef.current;
    nextScheduledStepRef.current = currentStepRef.current;
    nextScheduledStepTimeRef.current = 0;
    lastUiStepSyncAtRef.current = 0;
    clearCountInTimers();
    stopSyncedMetronome();
    for (const source of countInSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // ignore; source may already be ended.
      }
    }
    countInSourcesRef.current = [];
    setCountInActive(false);
    setRunning(false);
  }

  const setPlaybackCursorStep = useCallback((step: number): void => {
    const active = editorRef.current;
    if (!active) {
      return;
    }
    const stepCount = Math.max(1, active.stepsPerBar * active.totalBars);
    const clamped = clampStepIndex(step, stepCount);
    currentStepRef.current = clamped;
    transportStartStepRef.current = clamped;
    nextScheduledStepRef.current = clamped;
    setCurrentStep(clamped);
  }, []);

  const resolveNotationStepFromClientX = useCallback((clientX: number): number | null => {
    const active = editorRef.current;
    const wrap = notationSurfaceRef.current?.parentElement;
    if (!active || !wrap) {
      return null;
    }
    const stepCount = Math.max(1, active.stepsPerBar * active.totalBars);
    const rect = wrap.getBoundingClientRect();
    const localX = clientX - rect.left;
    const stepWidth = Math.max(1, notationStepWidth || DEFAULT_NOTATION_STEP_WIDTH);
    const approx = clampStepIndex(Math.round((localX - notationGridStart - stepWidth * 0.5) / stepWidth), stepCount);

    let nearest = approx;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let offset = -3; offset <= 3; offset += 1) {
      const candidate = approx + offset;
      if (candidate < 0 || candidate >= stepCount) {
        continue;
      }
      const center = stepCenters[candidate];
      if (!Number.isFinite(center)) {
        continue;
      }
      const distance = Math.abs(center - localX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    }

    return nearest;
  }, [notationGridStart, notationStepWidth, stepCenters]);

  function createSheet(): boolean {
    const safeTitle = titleInput.trim();
    if (!safeTitle) {
      setSheetMessage("제목을 입력해주세요.");
      return false;
    }
    const bpm = Math.max(40, Math.min(240, Math.round(bpmInput || 90)));
    const timeSignature = timeSignatureInput;
    const stepsPerBar = resolveStepsPerBar(timeSignature);
    const totalBars = Math.max(1, Math.min(256, Math.round(totalBarsInput || 4)));
    const totalSteps = stepsPerBar * totalBars;
    const nextSheet: SavedSheet = {
      id: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: safeTitle,
      bpm,
      timeSignature,
      stepsPerBar,
      totalBars,
      pattern: makeEmptyPattern(totalSteps),
      noteLengthOverrides: {},
      selectedSamples: cloneSamples(defaultSamples),
      updatedAt: Date.now()
    };
    editorRef.current = nextSheet;
    setEditorSheet(nextSheet);
    setSheetViewMode("edit");
    setCurrentStep(0);
    currentStepRef.current = 0;
    transportStartStepRef.current = 0;
    nextScheduledStepRef.current = 0;
    stopPlaybackTransport();
    setNoteLengthOverrides(cloneNoteLengthOverrides(nextSheet.noteLengthOverrides));
    setSheetMessage("새 악보 편집을 시작합니다.");
    return true;
  }

  function createSheetFromModal(): void {
    if (createSheet()) {
      setShowCreateModal(false);
    }
  }

  function openGpImportPicker(): void {
    gpFileInputRef.current?.click();
  }

  function applyImportedSheet(imported: ImportedDrumSheet): void {
    const totalSteps = imported.stepsPerBar * imported.totalBars;
    const nextPattern = makeEmptyPattern(totalSteps);
    const importedNoteLengths = cloneNoteLengthOverrides(imported.noteLengthOverrides);
    for (const track of TRACKS) {
      nextPattern[track.id] = [...(imported.pattern[track.id] ?? nextPattern[track.id])];
    }

    const nextSheet: SavedSheet = {
      id: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: imported.title.trim() || "가져온 GP 드럼 악보",
      bpm: imported.bpm,
      timeSignature: imported.timeSignature,
      stepsPerBar: imported.stepsPerBar,
      totalBars: imported.totalBars,
      pattern: nextPattern,
      noteLengthOverrides: importedNoteLengths,
      selectedSamples: cloneSamples(defaultSamplesRef.current),
      updatedAt: Date.now()
    };

    stopPlaybackTransport();
    editorRef.current = nextSheet;
    noteLengthOverridesRef.current = importedNoteLengths;
    setEditorSheet(nextSheet);
    setSheetViewMode("edit");
    setTitleInput(nextSheet.title);
    setBpmInput(nextSheet.bpm);
    setTimeSignatureInput(nextSheet.timeSignature);
    setTotalBarsInput(nextSheet.totalBars);
    setCurrentStep(0);
    currentStepRef.current = 0;
    transportStartStepRef.current = 0;
    nextScheduledStepRef.current = 0;
    setBeatSelection(null);
    setDragAnchor(null);
    setNoteLengthOverrides(importedNoteLengths);
    setSheetMessage(`"${nextSheet.title}" GP 가져오기 완료`);
  }

  async function handleGpFileInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const imported = await importDrumSheetFromGpFile(file);
      applyImportedSheet(imported);
      setToastMessage(`GP 드럼 악보를 불러왔습니다. (매핑 ${imported.mappedNoteCount}, 무시 ${imported.ignoredNoteCount})`);
    } catch (error) {
      if (error instanceof GpImportError) {
        if (error.code === "NO_DRUM_TRACK" || error.code === "EMPTY_TRACK") {
          setToastMessage("드럼 트랙이 없어 GP 불러오기를 할 수 없습니다.");
          return;
        }
        if (error.code === "UNSUPPORTED_TIME_SIGNATURE") {
          setToastMessage("이 박자표는 현재 가져오기를 지원하지 않습니다.");
          return;
        }
        if (error.code === "FILE_TOO_LARGE") {
          setToastMessage("파일 크기가 너무 큽니다. 10MB 이하만 가져올 수 있습니다.");
          return;
        }
      }
      setToastMessage("GP 파일을 읽지 못했습니다. 파일 형식을 확인해 주세요.");
    }
  }

  function openEditModal(): void {
    if (!editorSheet) {
      setSheetMessage("먼저 악보를 만들거나 불러와 주세요.");
      return;
    }
    setEditTitleInput(editorSheet.title);
    setEditTimeSignatureInput(editorSheet.timeSignature);
    setEditTotalBarsInput(editorSheet.totalBars);
    setShowEditModal(true);
  }

  function applyEditFromModal(): void {
    if (!editorSheet) {
      return;
    }
    const safeTitle = editTitleInput.trim();
    if (!safeTitle) {
      setSheetMessage("제목을 입력해주세요.");
      return;
    }
    const timeSignature = editTimeSignatureInput;
    const stepsPerBar = resolveStepsPerBar(timeSignature);
    const totalBars = Math.max(1, Math.min(256, Math.round(editTotalBarsInput || editorSheet.totalBars)));
    const totalSteps = stepsPerBar * totalBars;
    const stepsPerBarChanged = stepsPerBar !== editorSheet.stepsPerBar;
    const next = cloneSheet(editorSheet);
    next.title = safeTitle;
    next.timeSignature = timeSignature;
    next.stepsPerBar = stepsPerBar;
    next.totalBars = totalBars;
    next.pattern = resizePattern(editorSheet.pattern, totalSteps);
    const baseOverrides = stepsPerBarChanged ? {} : cloneNoteLengthOverrides(noteLengthOverridesRef.current);
    const normalizedOverrides = normalizeNoteLengthOverridesForPattern(next, baseOverrides);
    next.noteLengthOverrides = normalizedOverrides;
    stopPlaybackTransport();
    const clampedStep = clampStepIndex(currentStepRef.current, totalSteps);
    setCurrentStep(clampedStep);
    currentStepRef.current = clampedStep;
    transportStartStepRef.current = clampedStep;
    nextScheduledStepRef.current = clampedStep;
    editorRef.current = next;
    setEditorSheet(next);
    noteLengthOverridesRef.current = normalizedOverrides;
    setTitleInput(safeTitle);
    setTimeSignatureInput(timeSignature);
    setTotalBarsInput(totalBars);
    const hasPersistedSheet = savedSheets.some((sheet) => sheet.id === next.id);
    if (hasPersistedSheet) {
      void persistSheet({
        ...cloneSheet(next),
        noteLengthOverrides: cloneNoteLengthOverrides(normalizedOverrides),
        updatedAt: Date.now()
      });
    }
    setNoteLengthOverrides(normalizedOverrides);
    setShowEditModal(false);
    setSheetMessage(hasPersistedSheet ? "악보 편집 정보를 저장했습니다." : "악보 편집 정보를 적용했습니다.");
  }

  const beginBeatSelection = useCallback((trackIndex: number, step: number, event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragMovedRef.current = false;
    const anchor = { trackIndex, step };
    dragAnchorRef.current = anchor;
    setDragAnchor(anchor);
    setBeatSelection({
      trackStart: trackIndex,
      trackEnd: trackIndex,
      stepStart: step,
      stepEnd: step
    });
  }, []);

  const extendBeatSelection = useCallback((trackIndex: number, step: number): void => {
    const anchor = dragAnchorRef.current;
    if (!anchor) {
      return;
    }
    setBeatSelection((prev) => {
      const next = {
        trackStart: anchor.trackIndex,
        trackEnd: trackIndex,
        stepStart: anchor.step,
        stepEnd: step
      };
      if (
        prev &&
        prev.trackStart === next.trackStart &&
        prev.trackEnd === next.trackEnd &&
        prev.stepStart === next.stepStart &&
        prev.stepEnd === next.stepEnd
      ) {
        return prev;
      }
      dragMovedRef.current = true;
      return next;
    });
  }, []);

  function copySelectedBeatBlock(): boolean {
    if (!editorSheet || !beatSelection) {
      return false;
    }
    const selection = normalizeSelectionRange(beatSelection);
    const height = selection.trackEnd - selection.trackStart + 1;
    const width = selection.stepEnd - selection.stepStart + 1;
    const values = Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, col) => {
        const trackId = TRACKS[selection.trackStart + row].id;
        return editorSheet.pattern[trackId][selection.stepStart + col];
      })
    );
    const selectedTrackIds = TRACKS.slice(selection.trackStart, selection.trackEnd + 1).map((track) => track.id);
    const selectedHandTrackSet = new Set(selectedTrackIds.filter((trackId) => HAND_TRACKS.includes(trackId)));
    const selectedFootTrackSet = new Set(selectedTrackIds.filter((trackId) => FOOT_TRACKS.includes(trackId)));
    const copiedOverrides: Record<string, NoteLengthSteps> = {};
    for (const [key, length] of Object.entries(noteLengthOverridesRef.current)) {
      const [voicePart, stepText] = key.split(":");
      if (voicePart !== "hand" && voicePart !== "foot") {
        continue;
      }
      const step = Number.parseInt(stepText, 10);
      if (!Number.isFinite(step) || step < selection.stepStart || step > selection.stepEnd) {
        continue;
      }
      const selectedVoiceTracks = voicePart === "hand" ? selectedHandTrackSet : selectedFootTrackSet;
      if (selectedVoiceTracks.size === 0) {
        continue;
      }
      let hasSelectedVoiceHit = false;
      for (const trackId of selectedVoiceTracks) {
        if (editorSheet.pattern[trackId][step]) {
          hasSelectedVoiceHit = true;
          break;
        }
      }
      if (!hasSelectedVoiceHit) {
        continue;
      }
      copiedOverrides[`${voicePart}:${step - selection.stepStart}`] = length;
    }

    selectionClipboardRef.current = { width, height, values, noteLengthOverrides: copiedOverrides };
    setToastMessage(`비트 ${height}x${width} 복사 완료`);
    return true;
  }

  function pasteSelectedBeatBlock(): boolean {
    const copied = selectionClipboardRef.current;
    const active = editorRef.current;
    if (!active || !copied) {
      return false;
    }
    const totalStepsInSheet = active.stepsPerBar * active.totalBars;
    const selection = beatSelection ? normalizeSelectionRange(beatSelection) : null;
    const targetTrack = selection ? selection.trackStart : 0;
    const targetStep = selection ? selection.stepStart : currentStepRef.current;
    const appliedHeight = Math.min(copied.height, Math.max(0, TRACKS.length - targetTrack));
    const appliedWidth = Math.min(copied.width, Math.max(0, totalStepsInSheet - targetStep));
    if (appliedHeight < 1 || appliedWidth < 1) {
      return false;
    }
    const nextPattern = { ...active.pattern };
    for (let row = 0; row < appliedHeight; row += 1) {
      const trackId = TRACKS[targetTrack + row].id;
      const nextRow = [...nextPattern[trackId]];
      for (let col = 0; col < appliedWidth; col += 1) {
        nextRow[targetStep + col] = copied.values[row][col];
      }
      nextPattern[trackId] = nextRow;
    }
    const nextEditor: SavedSheet = {
      ...active,
      pattern: nextPattern
    };

    const affectedTrackIds = TRACKS.slice(targetTrack, targetTrack + appliedHeight).map((track) => track.id);
    const affectedVoices = new Set<VoicePart>();
    if (affectedTrackIds.some((trackId) => HAND_TRACKS.includes(trackId))) {
      affectedVoices.add("hand");
    }
    if (affectedTrackIds.some((trackId) => FOOT_TRACKS.includes(trackId))) {
      affectedVoices.add("foot");
    }
    const nextOverrides = { ...noteLengthOverridesRef.current };
    for (const voice of affectedVoices) {
      for (let col = 0; col < appliedWidth; col += 1) {
        delete nextOverrides[`${voice}:${targetStep + col}`];
      }
    }
    for (const [relativeKey, length] of Object.entries(copied.noteLengthOverrides)) {
      const [voiceText, relativeStepText] = relativeKey.split(":");
      if (voiceText !== "hand" && voiceText !== "foot") {
        continue;
      }
      const voice = voiceText as VoicePart;
      if (!affectedVoices.has(voice)) {
        continue;
      }
      const relativeStep = Number.parseInt(relativeStepText, 10);
      if (!Number.isFinite(relativeStep) || relativeStep < 0 || relativeStep >= appliedWidth) {
        continue;
      }
      const absoluteStep = targetStep + relativeStep;
      nextOverrides[`${voice}:${absoluteStep}`] = length;
    }

    const normalizedOverrides = normalizeNoteLengthOverridesForPattern(nextEditor, nextOverrides);
    editorRef.current = nextEditor;
    setEditorSheet(nextEditor);
    noteLengthOverridesRef.current = normalizedOverrides;
    setNoteLengthOverrides(normalizedOverrides);
    setBeatSelection({
      trackStart: targetTrack,
      trackEnd: targetTrack + appliedHeight - 1,
      stepStart: targetStep,
      stepEnd: targetStep + appliedWidth - 1
    });
    setToastMessage(`비트 ${appliedHeight}x${appliedWidth} 붙여넣기 완료`);
    return true;
  }

  function deleteSelectedBeatBlock(): boolean {
    const active = editorRef.current;
    if (!active || !beatSelection) {
      return false;
    }
    const selection = normalizeSelectionRange(beatSelection);
    const trackStart = Math.max(0, Math.min(selection.trackStart, TRACKS.length - 1));
    const trackEnd = Math.max(0, Math.min(selection.trackEnd, TRACKS.length - 1));
    const totalStepsInSheet = active.stepsPerBar * active.totalBars;
    const stepStart = Math.max(0, Math.min(selection.stepStart, totalStepsInSheet - 1));
    const stepEnd = Math.max(0, Math.min(selection.stepEnd, totalStepsInSheet - 1));
    if (trackStart > trackEnd || stepStart > stepEnd) {
      return false;
    }

    const nextPattern = { ...active.pattern };
    let removedCount = 0;
    for (let trackIndex = trackStart; trackIndex <= trackEnd; trackIndex += 1) {
      const trackId = TRACKS[trackIndex].id;
      const nextRow = [...nextPattern[trackId]];
      for (let step = stepStart; step <= stepEnd; step += 1) {
        if (nextRow[step]) {
          removedCount += 1;
        }
        nextRow[step] = false;
      }
      nextPattern[trackId] = nextRow;
    }

    const nextEditor: SavedSheet = {
      ...active,
      pattern: nextPattern
    };
    const affectedTrackIds = TRACKS.slice(trackStart, trackEnd + 1).map((track) => track.id);
    const affectedVoices = new Set<VoicePart>();
    if (affectedTrackIds.some((trackId) => HAND_TRACKS.includes(trackId))) {
      affectedVoices.add("hand");
    }
    if (affectedTrackIds.some((trackId) => FOOT_TRACKS.includes(trackId))) {
      affectedVoices.add("foot");
    }
    const nextOverrides = { ...noteLengthOverridesRef.current };
    for (const voice of affectedVoices) {
      for (let step = stepStart; step <= stepEnd; step += 1) {
        delete nextOverrides[buildDurationKey(voice, step)];
      }
    }
    const normalizedOverrides = normalizeNoteLengthOverridesForPattern(nextEditor, nextOverrides);

    editorRef.current = nextEditor;
    setEditorSheet(nextEditor);
    noteLengthOverridesRef.current = normalizedOverrides;
    setNoteLengthOverrides(normalizedOverrides);
    setToastMessage(
      removedCount > 0
        ? `선택 구간 비트 ${removedCount}개 삭제 완료`
        : "선택 구간에 삭제할 비트가 없습니다."
    );
    return true;
  }

  const applyInputNoteLengthToSelection = useCallback((nextLength: NoteLengthSteps): void => {
    setInputNoteLength(nextLength);
    const active = editorRef.current;
    const selectionRaw = beatSelection;
    if (!active || !selectionRaw) {
      return;
    }

    const selection = normalizeSelectionRange(selectionRaw);
    const selectedTrackIds = TRACKS.slice(selection.trackStart, selection.trackEnd + 1).map((track) => track.id);
    const nextOverrides = { ...noteLengthOverridesRef.current };
    let changedCount = 0;
    let skippedCount = 0;

    for (const voicePart of ["hand", "foot"] as const) {
      const voiceTracks = voicePart === "hand" ? HAND_TRACKS : FOOT_TRACKS;
      const selectedVoiceTrackIds = selectedTrackIds.filter((trackId) => voiceTracks.includes(trackId));
      if (selectedVoiceTrackIds.length === 0) {
        continue;
      }

      for (let step = selection.stepStart; step <= selection.stepEnd; step += 1) {
        const hasSelectedVoiceHit = selectedVoiceTrackIds.some((trackId) => active.pattern[trackId][step]);
        if (!hasSelectedVoiceHit) {
          continue;
        }

        const barStartStep = Math.floor(step / active.stepsPerBar) * active.stepsPerBar;
        const barEndStep = barStartStep + active.stepsPerBar;
        if (step + nextLength > barEndStep) {
          skippedCount += 1;
          continue;
        }

        const key = buildDurationKey(voicePart, step);
        const prevLength = nextOverrides[key];
        nextOverrides[key] = nextLength;

        let conflict = false;
        for (let s = step + 1; s < Math.min(step + nextLength, barEndStep); s += 1) {
          if (hasVoiceEventAtStep(active, voiceTracks, voicePart, s, nextOverrides, step)) {
            conflict = true;
            break;
          }
        }

        if (conflict) {
          if (prevLength == null) {
            delete nextOverrides[key];
          } else {
            nextOverrides[key] = prevLength;
          }
          skippedCount += 1;
          continue;
        }

        for (let s = step + 1; s < Math.min(step + nextLength, barEndStep); s += 1) {
          delete nextOverrides[buildDurationKey(voicePart, s)];
        }
        changedCount += 1;
      }
    }

    const normalized = normalizeNoteLengthOverridesForPattern(active, nextOverrides);
    if (!isSameNoteLengthOverrides(normalized, noteLengthOverridesRef.current)) {
      noteLengthOverridesRef.current = normalized;
      setNoteLengthOverrides(normalized);
    }
    if (changedCount > 0 || skippedCount > 0) {
      setToastMessage(`선택 구간 길이 적용: ${changedCount}개${skippedCount > 0 ? `, ${skippedCount}개 건너뜀` : ""}`);
    }
  }, [beatSelection]);

  const handleStepClick = useCallback((trackId: DrumTrackId, step: number, event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (dragMovedRef.current) {
      event.preventDefault();
      dragMovedRef.current = false;
      return;
    }
    const active = editorRef.current;
    if (!active) {
      return;
    }
    const activeNoteLengthOverrides = noteLengthOverridesRef.current;
    const wasActive = active.pattern[trackId][step];
    const voicePart: VoicePart = FOOT_TRACKS.includes(trackId) ? "foot" : "hand";
    const voiceTracks = voicePart === "hand" ? HAND_TRACKS : FOOT_TRACKS;
    const barStartStep = Math.floor(step / active.stepsPerBar) * active.stepsPerBar;
    const barEndStep = barStartStep + active.stepsPerBar;
    const requestedLength = inputNoteLength;
    const key = buildDurationKey(voicePart, step);
    const hasOtherVoiceTrackAtStep = voiceTracks.some((id) => id !== trackId && active.pattern[id][step]);
    const hasSameVoicePatternAtStep = voiceTracks.some((id) => active.pattern[id][step]);
    const coveredBySameVoiceDurationAtStep = isCoveredByDurationOverride(
      active,
      voiceTracks,
      voicePart,
      step,
      activeNoteLengthOverrides
    );
    const coveredBySameVoiceSustainAtStep =
      !hasSameVoicePatternAtStep &&
      (coveredBySameVoiceDurationAtStep || hasVoiceAutoSustainAtStep(active, voiceTracks, voicePart, step, activeNoteLengthOverrides));

    if (!wasActive && coveredBySameVoiceSustainAtStep) {
      setToastMessage("해당 스텝은 같은 보이스 음표 길이에 포함되어 있습니다. 길이를 먼저 변경해 주세요.");
      return;
    }

    if (!wasActive && !hasSameVoicePatternAtStep) {
      if (step + requestedLength > barEndStep) {
        setToastMessage("선택한 음표 길이가 마디를 넘어갑니다.");
        return;
      }
      for (let s = step; s < step + requestedLength && s < barEndStep; s += 1) {
        if (hasVoiceEventAtStep(active, voiceTracks, voicePart, s, activeNoteLengthOverrides)) {
          setToastMessage("해당 구간은 같은 보이스 음표 길이가 이미 차지하고 있습니다.");
          return;
        }
      }
    }

    const nextTrackRow = [...active.pattern[trackId]];
    nextTrackRow[step] = !wasActive;
    const nextEditor: SavedSheet = {
      ...active,
      pattern: {
        ...active.pattern,
        [trackId]: nextTrackRow
      }
    };
    editorRef.current = nextEditor;
    setEditorSheet(nextEditor);

    const nextOverrides = { ...activeNoteLengthOverrides };
    if (wasActive) {
      if (!hasOtherVoiceTrackAtStep) {
        delete nextOverrides[key];
      }
    } else if (!hasSameVoicePatternAtStep) {
      nextOverrides[key] = requestedLength;
    }
    if (!isSameNoteLengthOverrides(nextOverrides, activeNoteLengthOverrides)) {
      noteLengthOverridesRef.current = nextOverrides;
      setNoteLengthOverrides(nextOverrides);
    }
  }, [inputNoteLength]);

  function parseGridCellMeta(target: HTMLButtonElement): { trackId: DrumTrackId; trackIndex: number; step: number } | null {
    const trackIdText = target.dataset.trackId;
    const trackIndexText = target.dataset.trackIndex;
    const stepText = target.dataset.step;
    if (!trackIdText || !trackIndexText || !stepText) {
      return null;
    }
    const trackIndex = Number.parseInt(trackIndexText, 10);
    const step = Number.parseInt(stepText, 10);
    if (!Number.isFinite(trackIndex) || !Number.isFinite(step)) {
      return null;
    }
    const trackId = TRACKS[trackIndex]?.id;
    if (!trackId || trackId !== trackIdText) {
      return null;
    }
    return { trackId, trackIndex, step };
  }

  const handleGridCellMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>): void => {
    const meta = parseGridCellMeta(event.currentTarget);
    if (!meta) {
      return;
    }
    beginBeatSelection(meta.trackIndex, meta.step, event);
  }, [beginBeatSelection]);

  const handleGridCellMouseEnter = useCallback((event: ReactMouseEvent<HTMLButtonElement>): void => {
    const meta = parseGridCellMeta(event.currentTarget);
    if (!meta) {
      return;
    }
    extendBeatSelection(meta.trackIndex, meta.step);
  }, [extendBeatSelection]);

  const handleGridCellClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>): void => {
    const meta = parseGridCellMeta(event.currentTarget);
    if (!meta) {
      return;
    }
    handleStepClick(meta.trackId, meta.step, event);
  }, [handleStepClick]);

  function mergeSavedSheet(nextSheet: SavedSheet): void {
    setSavedSheets((prev) => {
      const existingIndex = prev.findIndex((sheet) => sheet.id === nextSheet.id);
      const next = existingIndex >= 0 ? [...prev] : [nextSheet, ...prev];
      if (existingIndex >= 0) {
        next[existingIndex] = nextSheet;
      }
      return withDefaultSheets(next);
    });
    setSelectedSheetId(nextSheet.id);
  }

  async function persistSheet(nextSheet: SavedSheet): Promise<boolean> {
    mergeSavedSheet(nextSheet);
    try {
      await upsertDrumSheet({
        id: nextSheet.id,
        title: nextSheet.title,
        bpm: nextSheet.bpm,
        timeSignature: nextSheet.timeSignature,
        stepsPerBar: nextSheet.stepsPerBar,
        totalBars: nextSheet.totalBars,
        pattern: nextSheet.pattern,
        noteLengthOverrides: nextSheet.noteLengthOverrides ?? {},
        selectedSamples: nextSheet.selectedSamples,
        updatedAt: nextSheet.updatedAt
      });
      setToastMessage(`"${nextSheet.title}" 저장되었습니다.`);
      return true;
    } catch {
      setToastMessage("DB 저장에 실패해 로컬에 임시 저장했습니다.");
      return true;
    }
  }

  async function saveSheet(): Promise<void> {
    if (!editorSheet) {
      setSheetMessage("먼저 악보를 만들거나 불러와 주세요.");
      return;
    }
    const safeTitle = editorSheet.title.trim();
    if (!safeTitle) {
      setSheetMessage("제목을 입력해주세요.");
      return;
    }
    const nextSheet: SavedSheet = {
      ...cloneSheet(editorSheet),
      title: safeTitle,
      noteLengthOverrides: cloneNoteLengthOverrides(noteLengthOverrides),
      updatedAt: Date.now()
    };
    const saved = await persistSheet(nextSheet);
    if (saved) {
      editorRef.current = nextSheet;
      setEditorSheet(nextSheet);
      setSheetMessage(`"${nextSheet.title}" 저장 완료`);
    }
  }

  function loadSheet(): void {
    if (!selectedSheetId) {
      setSheetMessage("불러올 악보를 선택해 주세요.");
      return;
    }
    const target = savedSheets.find((sheet) => sheet.id === selectedSheetId);
    if (!target) {
      setSheetMessage("선택한 악보를 찾을 수 없습니다.");
      return;
    }
    const next = cloneSheet(target);
    editorRef.current = next;
    setEditorSheet(next);
    setSheetViewMode("edit");
    setTitleInput(target.title);
    setBpmInput(target.bpm);
    setTimeSignatureInput(target.timeSignature);
    setTotalBarsInput(target.totalBars);
    setCurrentStep(0);
    currentStepRef.current = 0;
    transportStartStepRef.current = 0;
    nextScheduledStepRef.current = 0;
    stopPlaybackTransport();
    setNoteLengthOverrides(cloneNoteLengthOverrides(next.noteLengthOverrides));
    setSheetMessage(`"${target.title}" 불러오기 완료`);
    setToastMessage(`"${target.title}" 불러왔습니다.`);
  }

  function togglePlayback(): void {
    if (!editorSheet) {
      setSheetMessage("먼저 악보를 만들거나 불러와 주세요.");
      return;
    }
    editorRef.current = editorSheet;
    if (running || countInActive) {
      stopPlaybackTransport();
      return;
    }
    const startStep = clampStepIndex(currentStepRef.current, editorSheet.stepsPerBar * editorSheet.totalBars);
    stopPlaybackTransport();
    setCurrentStep(startStep);
    currentStepRef.current = startStep;
    transportStartStepRef.current = startStep;
    const ctx = getAudioContext();
    const leadInSec = metronomeSyncEnabled ? 0.16 : 0.06;
    if (!countInEnabled) {
      const startAt = ctx.currentTime + leadInSec;
      transportStartTimeRef.current = startAt;
      nextScheduledStepRef.current = startStep;
      nextScheduledStepTimeRef.current = startAt;
      setCountInActive(false);
      setRunning(true);
      return;
    }
    const bpm = Math.max(40, Math.min(240, editorSheet.bpm));
    const beatSec = 60 / bpm;
    const countInStartAt = ctx.currentTime + leadInSec;
    const transportStartAt = countInStartAt + beatSec * 4;
    transportStartTimeRef.current = transportStartAt;
    nextScheduledStepRef.current = startStep;
    nextScheduledStepTimeRef.current = transportStartAt;
    const nextTimeouts: number[] = [];
    setCountInActive(true);
    setRunning(true);
    for (let beat = 0; beat < 4; beat += 1) {
      triggerCountInClick(beat === 0, countInStartAt + beatSec * beat, true);
    }
    const startTimeoutId = window.setTimeout(() => {
      countInTimerRef.current = [];
      setCountInActive(false);
    }, Math.max(0, Math.round((transportStartAt - ctx.currentTime) * 1000)));
    nextTimeouts.push(startTimeoutId);
    countInTimerRef.current = nextTimeouts;
  }

  function movePlaybackCursorToStart(): void {
    stopPlaybackTransport();
    setPlaybackCursorStep(0);
    if (trackGridScrollRef.current) {
      trackGridScrollRef.current.scrollLeft = 0;
    }
    if (scoreNotationWrapRef.current) {
      scoreNotationWrapRef.current.scrollLeft = 0;
    }
  }

  function cycleNoteDuration(voicePart: VoicePart, step: number): void {
    if (!editorSheet) {
      return;
    }
    const trackIds = voicePart === "hand" ? HAND_TRACKS : FOOT_TRACKS;
    if (!trackIds.some((trackId) => editorSheet.pattern[trackId][step])) {
      return;
    }
    const barStartStep = Math.floor(step / editorSheet.stepsPerBar) * editorSheet.stepsPerBar;
    const barEndStep = barStartStep + editorSheet.stepsPerBar;
    const key = buildDurationKey(voicePart, step);
    const currentRequested = noteLengthOverrides[key] ?? inferAutoLength(editorSheet, trackIds, voicePart, step, barEndStep, noteLengthOverrides);
    const currentLength = resolveLengthForStep(editorSheet, trackIds, voicePart, step, barEndStep, currentRequested, noteLengthOverrides);
    const cycle: NoteLengthSteps[] = [STEPS_PER_QUARTER, STEPS_PER_8TH, STEPS_PER_16TH, STEPS_PER_32ND];
    const index = cycle.indexOf(currentLength);
    const startIndex = index >= 0 ? index : cycle.length - 1;
    let nextLength = currentLength;
    for (let i = 1; i <= cycle.length; i += 1) {
      const candidate = cycle[(startIndex + i) % cycle.length];
      if (step + candidate <= barEndStep) {
        nextLength = candidate;
        break;
      }
    }
    if (nextLength === currentLength) {
      return;
    }

    setEditorSheet((prev) => {
      if (!prev) {
        return prev;
      }
      const next = cloneSheet(prev);
      for (let s = step + 1; s < Math.min(step + nextLength, barEndStep); s += 1) {
        for (const trackId of trackIds) {
          next.pattern[trackId][s] = false;
        }
      }
      return next;
    });
    setNoteLengthOverrides((prev) => {
      const next = { ...prev, [key]: nextLength };
      for (let s = step + 1; s < Math.min(step + nextLength, barEndStep); s += 1) {
        delete next[buildDurationKey(voicePart, s)];
      }
      return next;
    });
  }

  const totalSteps = editorSheet ? editorSheet.stepsPerBar * editorSheet.totalBars : 0;
  const availableInputNoteLengths = INPUT_NOTE_LENGTH_OPTIONS.filter(
    (option) => !editorSheet || editorSheet.stepsPerBar % option.value === 0
  );
  const playbackActive = running || countInActive;
  const normalizedBeatSelection = beatSelection ? normalizeSelectionRange(beatSelection) : null;
  const gridStyle = { ["--sheet-step-count" as string]: totalSteps } as CSSProperties;
  const notationWidth = Math.max(notationGridRight, notationGridStart + totalSteps * notationStepWidth) + NOTATION_RIGHT_PADDING;
  const notationPlayheadX = stepCenters[currentStep] ?? notationGridStart + currentStep * notationStepWidth + notationStepWidth * 0.5;
  const scoreCurrentStepPoint = scoreStepPoints[currentStep] ?? null;
  const currentBarIndex = editorSheet ? Math.max(0, Math.min(editorSheet.totalBars - 1, Math.floor(currentStep / editorSheet.stepsPerBar))) : -1;
  const scoreCurrentBarRect = currentBarIndex >= 0 ? scoreBarRects[currentBarIndex] ?? null : null;

  const handleStepHeadMouseDown = useCallback((step: number, event: ReactMouseEvent<HTMLSpanElement>): void => {
    if (event.button !== 0 || playbackActive) {
      return;
    }
    event.preventDefault();
    setPlaybackCursorStep(step);
  }, [playbackActive, setPlaybackCursorStep]);

  const handleNotationPlayheadMouseDown = useCallback((event: ReactMouseEvent<HTMLSpanElement>): void => {
    if (event.button !== 0 || playbackActive) {
      return;
    }
    event.preventDefault();
    playheadDragActiveRef.current = true;
    const step = resolveNotationStepFromClientX(event.clientX);
    if (step != null) {
      setPlaybackCursorStep(step);
    }
  }, [playbackActive, resolveNotationStepFromClientX, setPlaybackCursorStep]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent): void => {
      if (!playheadDragActiveRef.current || playbackActive) {
        return;
      }
      const step = resolveNotationStepFromClientX(event.clientX);
      if (step != null) {
        setPlaybackCursorStep(step);
      }
    };

    const handleMouseUp = (): void => {
      playheadDragActiveRef.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [playbackActive, resolveNotationStepFromClientX, setPlaybackCursorStep]);

  const clampedVisibleStepStart = totalSteps > 0 ? Math.max(0, Math.min(visibleStepRange.start, totalSteps - 1)) : 0;
  const clampedVisibleStepEnd = totalSteps > 0 ? Math.max(clampedVisibleStepStart, Math.min(visibleStepRange.end, totalSteps - 1)) : 0;

  useEffect(() => {
    if (!editorSheet || totalSteps < 1 || !showTrackGrid) {
      setVisibleStepRange({ start: 0, end: Math.max(0, totalSteps - 1) });
      return;
    }
    const viewport = trackGridScrollRef.current;
    if (!viewport) {
      setVisibleStepRange({ start: 0, end: Math.max(0, totalSteps - 1) });
      return;
    }

    let rafId = 0;
    const updateRange = (): void => {
      const stepWidth = Math.max(8, notationStepWidth || DEFAULT_NOTATION_STEP_WIDTH);
      const scrollLeft = viewport.scrollLeft;
      const visibleWidth = Math.max(0, viewport.clientWidth - GRID_TRACK_COLUMN_WIDTH);
      const visibleStart = Math.floor(scrollLeft / stepWidth);
      const visibleEnd = Math.ceil((scrollLeft + visibleWidth) / stepWidth);
      const start = Math.max(0, visibleStart - GRID_VIRTUAL_OVERSCAN_STEPS);
      const end = Math.min(totalSteps - 1, Math.max(0, visibleEnd + GRID_VIRTUAL_OVERSCAN_STEPS));
      setVisibleStepRange((prev) => {
        if (prev.start === start && prev.end === end) {
          return prev;
        }
        return { start, end };
      });
    };
    const handleViewportChange = (): void => {
      if (rafId !== 0) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateRange();
      });
    };

    updateRange();
    viewport.addEventListener("scroll", handleViewportChange, { passive: true });
    window.addEventListener("resize", handleViewportChange);
    return () => {
      viewport.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("resize", handleViewportChange);
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [editorSheet, totalSteps, notationStepWidth, showTrackGrid]);

  useEffect(() => {
    if (availableInputNoteLengths.length === 0) {
      return;
    }
    if (availableInputNoteLengths.some((option) => option.value === inputNoteLength)) {
      return;
    }
    setInputNoteLength(availableInputNoteLengths[0].value);
  }, [inputNoteLength, availableInputNoteLengths]);

  useEffect(() => {
    const surface = notationSurfaceRef.current;
    if (!surface) {
      return;
    }
    if (!editorSheet || totalSteps < 1) {
      surface.replaceChildren();
      setNotationDebugPoints([]);
      return;
    }
    let rafId = 0;
    const renderDelayMs = 60;
    const timeoutId = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(() => {
      try {
      const collectDebugPointsFromRenderedSvg = (maxStepExclusive?: number): NotationDebugPoint[] => {
        const groups = Array.from(surface.querySelectorAll<SVGGElement>('g[id^="vf-note-edit-"]'));
        const byStep = new Map<number, NotationDebugPoint>();
        for (const group of groups) {
          const match = /^vf-note-edit-(?:hand|foot)-(\d+)$/.exec(group.id);
          if (!match) {
            continue;
          }
          const step = Number.parseInt(match[1], 10);
          if (!Number.isFinite(step)) {
            continue;
          }
          if (maxStepExclusive != null && step >= maxStepExclusive) {
            continue;
          }
          const targetX = stepCenters[step] ?? notationGridStart + step * notationStepWidth + notationStepWidth * 0.5;
          if (!Number.isFinite(targetX)) {
            continue;
          }

          const noteHeadCenters: number[] = [];
          const noteHeads = Array.from(group.querySelectorAll<SVGGraphicsElement>(".vf-notehead"));
          for (const noteHead of noteHeads) {
            try {
              const box = noteHead.getBBox();
              if (box.width > 0) {
                noteHeadCenters.push(box.x + box.width * 0.5);
              }
            } catch {
              // Ignore malformed SVG nodes and keep fallback logic.
            }
          }

          let actualX: number | null = null;
          if (noteHeadCenters.length > 0) {
            actualX = noteHeadCenters.reduce((sum, value) => sum + value, 0) / noteHeadCenters.length;
          } else {
            try {
              const groupBox = group.getBBox();
              if (groupBox.width > 0) {
                actualX = groupBox.x + groupBox.width * 0.5;
              }
            } catch {
              actualX = null;
            }
          }

          if (!Number.isFinite(actualX)) {
            continue;
          }

          const candidate = { step, targetX, actualX: actualX as number };
          const existing = byStep.get(step);
          if (!existing) {
            byStep.set(step, candidate);
            continue;
          }
          const existingDelta = Math.abs(existing.actualX - existing.targetX);
          const nextDelta = Math.abs(candidate.actualX - candidate.targetX);
          if (nextDelta < existingDelta) {
            byStep.set(step, candidate);
          }
        }
        return Array.from(byStep.values()).sort((a, b) => a.step - b.step);
      };
      const renderPass = (stepOffsetMap?: Map<number, number>): void => {
        surface.replaceChildren();
        const renderer = new Renderer(surface, Renderer.Backends.SVG);
        renderer.resize(notationWidth, NOTATION_HEIGHT);
        const context = renderer.getContext();
        context.setFillStyle(NOTATION_NOTE_FILL);
        context.setStrokeStyle(NOTATION_NOTE_STROKE);
        context.setLineWidth(1.1);
        const timeSignature = editorSheet.timeSignature;

        const firstBarStartX = stepCenters[0] ?? notationGridStart + notationStepWidth * 0.5;
        const symbolWidth = Math.max(44, Math.min(86, firstBarStartX - 6));
        const symbolX = Math.max(0, firstBarStartX - symbolWidth - 2);
        const symbolStave = new Stave(symbolX, NOTATION_STAFF_TOP, symbolWidth);
        symbolStave.addClef("percussion");
        symbolStave.addTimeSignature(timeSignature, -4);
        symbolStave.setEndBarType(BarlineType.NONE);
        symbolStave.setContext(context).draw();

        for (let bar = 0; bar < editorSheet.totalBars; bar += 1) {
          const barStartStep = bar * editorSheet.stepsPerBar;
          const barEndStep = barStartStep + editorSheet.stepsPerBar;
          const startX = stepCenters[barStartStep] ?? notationGridStart + barStartStep * notationStepWidth + notationStepWidth * 0.5;
          const fallbackEndX = notationGridStart + barEndStep * notationStepWidth + notationStepWidth * 0.5;
          const endX = stepCenters[barEndStep] ?? fallbackEndX;
          const barWidth = Math.max(notationStepWidth * editorSheet.stepsPerBar, endX - startX, notationStepWidth * 2);
          const stave = new Stave(startX, NOTATION_STAFF_TOP, barWidth);
          const setWidthKeepingStartX = (width: number, desiredStartX: number): void => {
            stave.setWidth(width);
            stave.setNoteStartX(desiredStartX);
          };
          stave.setNoteStartX(startX);
          const currentNoteEndX = stave.getNoteEndX();
          const widthAdjust = endX - currentNoteEndX;
          if (Number.isFinite(widthAdjust) && Math.abs(widthAdjust) > 0.25) {
            setWidthKeepingStartX(Math.max(notationStepWidth * 2, barWidth + widthAdjust), startX);
          }
          stave.setBegBarType(BarlineType.NONE);
          stave.setMeasure(bar + 1);
          stave.setContext(context);

          const mergedFootStartSteps = buildMergedFootStartSteps(editorSheet, barStartStep, noteLengthOverrides);
          const handTickables = buildVoiceTickables(
            editorSheet,
            HAND_TRACKS,
            barStartStep,
            Stem.UP,
            "hand",
            noteLengthOverrides,
            mergedFootStartSteps
          );
          const footTickables = buildVoiceTickables(
            editorSheet,
            FOOT_TRACKS,
            barStartStep,
            Stem.DOWN,
            "foot",
            noteLengthOverrides,
            mergedFootStartSteps
          );
          const handVoice = new Voice({ numBeats: editorSheet.stepsPerBar, beatValue: 32 }).setMode(Voice.Mode.STRICT);
          handVoice.addTickables(handTickables);
          const footVoice = new Voice({ numBeats: editorSheet.stepsPerBar, beatValue: 32 }).setMode(Voice.Mode.STRICT);
          footVoice.addTickables(footTickables);
          const snapFormatter = new Formatter();
          snapFormatter.joinVoices([handVoice, footVoice]).formatToStave([handVoice, footVoice], stave);
          const beams = [
            ...createGroupedBeams(handTickables, editorSheet.timeSignature),
            ...createGroupedBeams(footTickables, editorSheet.timeSignature)
          ];
          stave.draw();
          lockTickContextsToStepGrid(
            snapFormatter,
            barStartStep,
            barEndStep,
            stepCenters,
            notationGridStart,
            notationStepWidth,
            stepOffsetMap
          );
          context.setFillStyle(NOTATION_NOTE_FILL);
          context.setStrokeStyle(NOTATION_NOTE_STROKE);
          handVoice.draw(context, stave);
          footVoice.draw(context, stave);
          beams.forEach((beam) => {
            beam.setContext(context).draw();
          });
        }
      };

      renderPass();
      if (showNotationDebug) {
        const firstPass = collectDebugPointsFromRenderedSvg();
        const correctionMap = new Map<number, number>();
        for (const point of firstPass) {
          const delta = point.targetX - point.actualX;
          if (Math.abs(delta) > 0.25) {
            correctionMap.set(point.step, delta);
          }
        }
        if (correctionMap.size > 0) {
          renderPass(correctionMap);
        }
        setNotationDebugPoints(collectDebugPointsFromRenderedSvg());
      } else {
        const firstPass = collectDebugPointsFromRenderedSvg();
        const byBarOffset = new Map<number, number>();
        const firstPointByBar = new Map<number, NotationDebugPoint>();
        for (const point of firstPass) {
          const bar = Math.floor(point.step / editorSheet.stepsPerBar);
          if (!firstPointByBar.has(bar)) {
            firstPointByBar.set(bar, point);
          }
        }
        for (const [bar, point] of firstPointByBar.entries()) {
          const delta = point.targetX - point.actualX;
          if (Math.abs(delta) > 0.25) {
            byBarOffset.set(bar, delta);
          }
        }
        if (byBarOffset.size > 0) {
          const stepOffsetMap = new Map<number, number>();
          for (const [bar, delta] of byBarOffset.entries()) {
            const barStartStep = bar * editorSheet.stepsPerBar;
            const barEndStep = barStartStep + editorSheet.stepsPerBar;
            for (let step = barStartStep; step < barEndStep; step += 1) {
              stepOffsetMap.set(step, delta);
            }
          }
          renderPass(stepOffsetMap);
        }
        setNotationDebugPoints([]);
      }
      } catch (error) {
        setNotationDebugPoints([]);
        console.error("VexFlow render failed", error);
      }
      });
    }, renderDelayMs);
    return () => {
      window.clearTimeout(timeoutId);
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [sheetViewMode, editorSheet, totalSteps, notationWidth, notationGridStart, notationStepWidth, stepCenters, noteLengthOverrides, showNotationDebug]);

  useEffect(() => {
    if (sheetViewMode !== "score") {
      return;
    }
    const paper = scorePaperRef.current;
    if (!paper) {
      return;
    }
    const updateWidth = (): void => {
      const style = window.getComputedStyle(paper);
      const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(style.paddingRight) || 0;
      const contentWidth = Math.max(240, paper.clientWidth - paddingLeft - paddingRight);
      setScorePaperWidth(contentWidth);
    };
    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateWidth();
      });
      observer.observe(paper);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", updateWidth);
    return () => {
      window.removeEventListener("resize", updateWidth);
    };
  }, [sheetViewMode, editorSheet]);

  useEffect(() => {
    const surface = scoreNotationSurfaceRef.current;
    if (!surface) {
      return;
    }
    if (sheetViewMode !== "score" || !editorSheet || totalSteps < 1) {
      surface.replaceChildren();
      setScoreStepPoints([]);
      setScoreBarRects([]);
      return;
    }

    let rafId = 0;
    const renderDelayMs = 40;
    const timeoutId = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(() => {
        try {
          surface.replaceChildren();
          const paperWidth = Math.max(isMobileViewport ? 280 : 360, scorePaperWidth || 0);
          const notationWidth = Math.max(
            isMobileViewport ? 300 : SCORE_NOTATION_MIN_WIDTH,
            paperWidth
          );
          const barsPerLine = resolveScoreBarsPerLine(editorSheet, paperWidth);
          const rowBarPlan = buildScoreRowBarPlan(editorSheet.totalBars, barsPerLine);
          const rowCount = rowBarPlan.length;
          const notationHeight = Math.max(160, rowCount * SCORE_NOTATION_ROW_HEIGHT);
          const nextStepPoints: ScoreStepPoint[] = Array.from({ length: totalSteps }, () => ({
            x: 0,
            top: 0,
            height: 0
          }));
          const nextBarRects: ScoreBarRect[] = Array.from({ length: editorSheet.totalBars }, () => ({
            x: 0,
            top: 0,
            width: 0,
            height: 0
          }));
          const renderer = new Renderer(surface, Renderer.Backends.SVG);
          renderer.resize(notationWidth, notationHeight);
          const context = renderer.getContext();
          context.setFillStyle(SCORE_NOTE_FILL);
          context.setStrokeStyle(SCORE_NOTE_STROKE);
          context.setLineWidth(1.15);

          let rowBarStart = 0;
          for (let row = 0; row < rowCount; row += 1) {
            const barsInRow = rowBarPlan[row] ?? 1;
            const rowBarEnd = Math.min(editorSheet.totalBars, rowBarStart + barsInRow);
            const rowTop = SCORE_STAFF_TOP_OFFSET + row * SCORE_NOTATION_ROW_HEIGHT;
            const rowLeft = 6;
            const rowRight = Math.max(rowLeft + 220, notationWidth - 6 - SCORE_RIGHT_SAFE_GUTTER);
            const hasLeadingSymbols = row === 0;
            const leadingSymbolWidth = hasLeadingSymbols ? SCORE_FIRST_ROW_SYMBOL_WIDTH : 0;
            if (hasLeadingSymbols) {
              const symbolStave = new Stave(rowLeft, rowTop, leadingSymbolWidth);
              symbolStave.addClef("percussion");
              symbolStave.addTimeSignature(editorSheet.timeSignature, -4);
              symbolStave.setBegBarType(BarlineType.NONE);
              symbolStave.setEndBarType(BarlineType.NONE);
              symbolStave.setContext(context).draw();
            }
            const rowMusicLeft = rowLeft + leadingSymbolWidth;
            const rowMusicWidth = Math.max(180, rowRight - rowMusicLeft);
            const barWidth = rowMusicWidth / barsInRow;

            for (let rowBarOffset = 0; rowBarOffset < barsInRow; rowBarOffset += 1) {
              const bar = rowBarStart + rowBarOffset;
              const barStartStep = bar * editorSheet.stepsPerBar;
              const staveX = rowMusicLeft + rowBarOffset * barWidth;
              const stave = new Stave(staveX, rowTop, Math.max(120, barWidth));
              nextBarRects[bar] = {
                x: staveX,
                top: rowTop - 4,
                width: Math.max(40, barWidth),
                height: 108
              };
              if (bar === 0 || rowBarOffset === 0) {
                stave.setBegBarType(BarlineType.NONE);
              }
              if (bar === editorSheet.totalBars - 1) {
                stave.setEndBarType(BarlineType.END);
              }
              stave.setMeasure(bar + 1);
              stave.setContext(context);

              const mergedFootStartSteps = buildMergedFootStartSteps(editorSheet, barStartStep, noteLengthOverrides);
              const handTickables = buildVoiceTickables(
                editorSheet,
                HAND_TRACKS,
                barStartStep,
                Stem.UP,
                "hand",
                noteLengthOverrides,
                mergedFootStartSteps
              );
              const footTickables = buildVoiceTickables(
                editorSheet,
                FOOT_TRACKS,
                barStartStep,
                Stem.DOWN,
                "foot",
                noteLengthOverrides,
                mergedFootStartSteps
              );
              applyNotationStyleToTickables(handTickables, SCORE_NOTE_FILL, SCORE_NOTE_STROKE);
              applyNotationStyleToTickables(footTickables, SCORE_NOTE_FILL, SCORE_NOTE_STROKE);

              const desiredNoteStartX = staveX + 8;
              stave.setNoteStartX(desiredNoteStartX);
              const noteStartX = stave.getNoteStartX();
              const noteEndX = Math.max(noteStartX + 1, stave.getNoteEndX());
              const scoreStepWidth = Math.max(1, (noteEndX - noteStartX) / editorSheet.stepsPerBar);
              for (let localStep = 0; localStep < editorSheet.stepsPerBar; localStep += 1) {
                const step = barStartStep + localStep;
                const x = noteStartX + scoreStepWidth * (localStep + 0.5);
                nextStepPoints[step] = {
                  x,
                  top: rowTop + 2,
                  height: 98
                };
              }

              const handVoice = new Voice({ numBeats: editorSheet.stepsPerBar, beatValue: 32 }).setMode(Voice.Mode.STRICT);
              handVoice.addTickables(handTickables);
              const footVoice = new Voice({ numBeats: editorSheet.stepsPerBar, beatValue: 32 }).setMode(Voice.Mode.STRICT);
              footVoice.addTickables(footTickables);
              const formatter = new Formatter();
              formatter.joinVoices([handVoice, footVoice]).formatToStave([handVoice, footVoice], stave);
              const beams = [
                ...createGroupedBeams(handTickables, editorSheet.timeSignature),
                ...createGroupedBeams(footTickables, editorSheet.timeSignature)
              ];
              stave.draw();
              handVoice.draw(context, stave);
              footVoice.draw(context, stave);
              beams.forEach((beam) => {
                beam.setContext(context).draw();
              });
              const syncStepPointFromTickables = (tickables: NotationTickable[]): void => {
                for (const tickable of tickables) {
                  if (!(tickable instanceof StaveNote) || tickable.isRest()) {
                    continue;
                  }
                  const rawId = tickable.getAttribute("id");
                  if (typeof rawId !== "string") {
                    continue;
                  }
                  const match = /^note-edit-(?:hand|foot)-(\d+)$/.exec(rawId);
                  if (!match) {
                    continue;
                  }
                  const step = Number.parseInt(match[1], 10);
                  if (!Number.isFinite(step) || step < 0 || step >= totalSteps) {
                    continue;
                  }
                  const noteHeadBegin = tickable.getNoteHeadBeginX();
                  const glyphWidth = tickable.getGlyphWidth();
                  if (!Number.isFinite(noteHeadBegin) || !Number.isFinite(glyphWidth) || glyphWidth <= 0) {
                    continue;
                  }
                  const centerX = noteHeadBegin + glyphWidth * 0.5;
                  const current = nextStepPoints[step];
                  nextStepPoints[step] = {
                    x: current.x > 0 ? (current.x + centerX) * 0.5 : centerX,
                    top: rowTop + 2,
                    height: 98
                  };
                }
              };
              syncStepPointFromTickables(handTickables);
              syncStepPointFromTickables(footTickables);
            }
            rowBarStart = rowBarEnd;
          }
          setScoreStepPoints(nextStepPoints);
          setScoreBarRects(nextBarRects);
        } catch (error) {
          setScoreStepPoints([]);
          setScoreBarRects([]);
          console.error("VexFlow score render failed", error);
        }
      });
    }, renderDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [sheetViewMode, editorSheet, totalSteps, scorePaperWidth, noteLengthOverrides, isMobileViewport]);

  useEffect(() => {
    const surface = notationSurfaceRef.current;
    if (!surface || !editorSheet) {
      return;
    }
    const handleDoubleClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const group = target.closest('g[id^="vf-note-edit-"]');
      if (!(group instanceof SVGGElement)) {
        return;
      }
      const matched = /^vf-note-edit-(hand|foot)-(\d+)$/.exec(group.id);
      if (!matched) {
        return;
      }
      const voicePart = matched[1] as VoicePart;
      const step = Number.parseInt(matched[2], 10);
      if (!Number.isFinite(step)) {
        return;
      }
      event.preventDefault();
      cycleNoteDuration(voicePart, step);
    };
    surface.addEventListener("dblclick", handleDoubleClick);
    return () => {
      surface.removeEventListener("dblclick", handleDoubleClick);
    };
  }, [sheetViewMode, editorSheet, noteLengthOverrides]);

  useEffect(() => {
    if (sheetViewMode !== "edit" || !editorSheet || totalSteps < 1) {
      setNotationStepWidth(DEFAULT_NOTATION_STEP_WIDTH);
      setNotationGridStart(DEFAULT_NOTATION_GRID_START);
      setNotationGridRight(DEFAULT_NOTATION_GRID_START + DEFAULT_NOTATION_STEP_WIDTH * 32);
      setStepCenters([]);
      setNotationSurfaceOffsetX(0);
      return;
    }
    const viewport = trackGridScrollRef.current;
    if (!viewport) {
      return;
    }

    const updateGeometry = (): void => {
      const notationSurface = notationSurfaceRef.current;
      if (notationSurface) {
        setNotationSurfaceOffsetX(notationSurface.offsetLeft);
      } else {
        setNotationSurfaceOffsetX(0);
      }
      const heads = Array.from(viewport.querySelectorAll<HTMLElement>(".sheet-maker-head[data-step]"));
      if (heads.length === 0) {
        return;
      }
      heads.sort((a, b) => {
        const aStep = Number.parseInt(a.dataset.step ?? "0", 10);
        const bStep = Number.parseInt(b.dataset.step ?? "0", 10);
        return aStep - bStep;
      });

      if (notationSurface) {
        const notationRect = notationSurface.getBoundingClientRect();
        const firstRect = heads[0].getBoundingClientRect();
        const secondRect = heads[1]?.getBoundingClientRect();
        const lastRect = heads[heads.length - 1].getBoundingClientRect();
        const starts = heads.map((head) => head.getBoundingClientRect().left - notationRect.left);
        const centers = heads.map((head) => {
          const rect = head.getBoundingClientRect();
          return rect.left - notationRect.left + rect.width * 0.5;
        });
        const measured = secondRect ? Math.abs(secondRect.left - firstRect.left) : firstRect.width;
        if (Number.isFinite(measured) && measured > 0) {
          setNotationStepWidth(measured);
        }
        if (Number.isFinite(starts[0]) && starts[0] > 0) {
          setNotationGridStart(starts[0]);
        }
        setNotationGridRight(lastRect.right - notationRect.left);
        setStepCenters(centers);
        setNotationSurfaceOffsetX(notationSurface.offsetLeft);
        return;
      }

      const first = heads[0];
      const second = heads[1];
      const last = heads[heads.length - 1];
      const centers = heads.map((head) => head.offsetLeft + head.offsetWidth * 0.5);
      const measured = second ? Math.abs(second.offsetLeft - first.offsetLeft) : first.getBoundingClientRect().width;
      if (Number.isFinite(measured) && measured > 0) {
        setNotationStepWidth(measured);
      }
      if (Number.isFinite(first.offsetLeft) && first.offsetLeft > 0) {
        setNotationGridStart(first.offsetLeft);
      }
      setNotationGridRight(last.offsetLeft + last.offsetWidth);
      setStepCenters(centers);
      setNotationSurfaceOffsetX(0);
    };

    updateGeometry();
    const raf = window.requestAnimationFrame(updateGeometry);
    const handleResize = (): void => updateGeometry();
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
    };
  }, [sheetViewMode, editorSheet, totalSteps, showTrackGrid]);

  useEffect(() => {
    if (!running || !editorSheet || totalSteps < 1) {
      return;
    }
    if (currentStep !== 0 && currentStep % editorSheet.stepsPerBar !== 0) {
      return;
    }

    const barStartStep = Math.floor(currentStep / editorSheet.stepsPerBar) * editorSheet.stepsPerBar;

    const trackViewport = trackGridScrollRef.current;
    if (trackViewport) {
      const targetCell = trackViewport.querySelector<HTMLElement>(`.sheet-maker-head[data-step="${barStartStep}"]`);
      if (targetCell) {
        const centered = targetCell.offsetLeft + targetCell.offsetWidth * 0.5;
        const desired = centered - trackViewport.clientWidth * 0.35;
        const maxScroll = Math.max(0, trackViewport.scrollWidth - trackViewport.clientWidth);
        trackViewport.scrollTo({
          left: Math.max(0, Math.min(maxScroll, desired)),
          behavior: "smooth"
        });
        return;
      }

      // Fallback for "track hidden" mode: use rendered notation x-position as the scroll anchor.
      const notationSurface = notationSurfaceRef.current;
      if (notationSurface) {
        const markerX = stepCenters[barStartStep] ?? notationGridStart + barStartStep * notationStepWidth + notationStepWidth * 0.5;
        const viewportRect = trackViewport.getBoundingClientRect();
        const notationRect = notationSurface.getBoundingClientRect();
        const centered = markerX + (notationRect.left - viewportRect.left) + trackViewport.scrollLeft;
        const desired = centered - trackViewport.clientWidth * 0.35;
        const maxScroll = Math.max(0, trackViewport.scrollWidth - trackViewport.clientWidth);
        trackViewport.scrollTo({
          left: Math.max(0, Math.min(maxScroll, desired)),
          behavior: "smooth"
        });
      }
    }
  }, [running, currentStep, editorSheet, totalSteps, notationStepWidth, notationGridStart, stepCenters]);

  useEffect(() => {
    if (!dragAnchor) {
      return;
    }
    const handleMouseUp = (): void => {
      dragAnchorRef.current = null;
      setDragAnchor(null);
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragAnchor]);

  useEffect(() => {
    if (!editorSheet || !beatSelection) {
      return;
    }
    const selection = normalizeSelectionRange(beatSelection);
    const clampedTrackStart = Math.max(0, Math.min(selection.trackStart, TRACKS.length - 1));
    const clampedTrackEnd = Math.max(0, Math.min(selection.trackEnd, TRACKS.length - 1));
    const clampedStepStart = Math.max(0, Math.min(selection.stepStart, totalSteps - 1));
    const clampedStepEnd = Math.max(0, Math.min(selection.stepEnd, totalSteps - 1));
    if (clampedStepStart > clampedStepEnd || clampedTrackStart > clampedTrackEnd) {
      setBeatSelection(null);
      return;
    }
    if (
      selection.trackStart === clampedTrackStart &&
      selection.trackEnd === clampedTrackEnd &&
      selection.stepStart === clampedStepStart &&
      selection.stepEnd === clampedStepEnd
    ) {
      return;
    }
    setBeatSelection({
      trackStart: clampedTrackStart,
      trackEnd: clampedTrackEnd,
      stepStart: clampedStepStart,
      stepEnd: clampedStepEnd
    });
  }, [editorSheet, beatSelection, totalSteps]);

  useEffect(() => {
    if (!editorSheet) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }

      const isDelete = event.key === "Delete" || event.key === "Backspace";
      if (isDelete && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (!deleteSelectedBeatBlock()) {
          setToastMessage("먼저 비트 구간을 드래그로 선택해 주세요.");
        }
        return;
      }

      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      const isCopy = event.code === "KeyC" || event.key.toLowerCase() === "c";
      const isPaste = event.code === "KeyV" || event.key.toLowerCase() === "v";
      if (!isCopy && !isPaste) {
        return;
      }
      event.preventDefault();
      if (isCopy) {
        if (!copySelectedBeatBlock()) {
          setToastMessage("먼저 비트 구간을 드래그로 선택해 주세요.");
        }
        return;
      }
      if (!pasteSelectedBeatBlock()) {
        setToastMessage("붙여넣기할 비트 데이터가 없습니다.");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editorSheet, beatSelection]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToastMessage("");
    }, 1400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toastMessage]);

  return (
    <section className={`card sheet-play-card ${isScoreFullscreen ? "score-fullscreen" : ""}`.trim()}>
      <h2>악보 만들기</h2>

      {sheetViewMode === "edit" ? (
        <div className="row sheet-actions-row">
          <label className="practice-field sheet-saved-sheet-field">
            저장된 악보
            <select value={selectedSheetId} onChange={(e) => setSelectedSheetId(e.target.value)} disabled={savedSheets.length === 0}>
              {savedSheets.length === 0 ? (
                <option value="">저장된 악보 없음</option>
              ) : (
                savedSheets.map((sheet) => (
                  <option key={sheet.id} value={sheet.id}>
                    {sheet.title}
                  </option>
                ))
              )}
            </select>
          </label>
          <button type="button" onClick={loadSheet} disabled={savedSheets.length === 0}>
            불러오기
          </button>
          <button type="button" onClick={openEditModal} disabled={!editorSheet}>
            수정
          </button>
          <button type="button" onClick={() => setShowCreateModal(true)}>
            만들기
          </button>
          <button type="button" onClick={openGpImportPicker}>
            GP 불러오기
          </button>
          <input
            ref={gpFileInputRef}
            type="file"
            accept={GP_FILE_ACCEPT}
            onChange={handleGpFileInputChange}
            hidden
          />
        </div>
      ) : null}

      {editorSheet ? (
        <div className="sheet-status-row">
          <div className={`sheet-status-controls ${sheetViewMode === "edit" ? "edit-mode" : "score-mode"}`.trim()}>
            {sheetViewMode === "edit" ? (
              <>
                <button
                  type="button"
                  className={`practice-run-btn sheet-edit-play-btn ${playbackActive ? "practice-stop" : ""}`.trim()}
                  onClick={togglePlayback}
                  aria-label={playbackActive ? "재생 정지" : "재생 시작"}
                >
                  {playbackActive ? <span className="practice-stop-icon" aria-hidden="true">■</span> : <span className="practice-run-icon" aria-hidden="true">▶</span>}
                </button>
                <button type="button" className="sheet-edit-start-btn" onClick={movePlaybackCursorToStart}>
                  처음으로
                </button>
                <label className="sheet-track-toggle">
                  <span className="sheet-track-toggle-text">메트로놈 연동</span>
                  <input
                    type="checkbox"
                    className="sheet-track-toggle-input"
                    checked={metronomeSyncEnabled}
                    onChange={(event) => setMetronomeSyncEnabled(event.target.checked)}
                  />
                  <span className="sheet-track-toggle-slider" aria-hidden="true" />
                </label>
                <label className="sheet-track-toggle">
                  <span className="sheet-track-toggle-text">트랙 표시</span>
                  <input
                    type="checkbox"
                    className="sheet-track-toggle-input"
                    checked={showTrackGrid}
                    onChange={(event) => setShowTrackGrid(event.target.checked)}
                  />
                  <span className="sheet-track-toggle-slider" aria-hidden="true" />
                </label>
                <label className="sheet-track-toggle">
                  <span className="sheet-track-toggle-text">예비박</span>
                  <input
                    type="checkbox"
                    className="sheet-track-toggle-input"
                    checked={countInEnabled}
                    onChange={(event) => setCountInEnabled(event.target.checked)}
                  />
                  <span className="sheet-track-toggle-slider" aria-hidden="true" />
                </label>
                <div className="sheet-note-length-wrap" role="group" aria-label="입력 음표 길이">
                  <span className="sheet-note-length-label">입력 음표</span>
                  <div className="sheet-note-length-buttons">
                    {availableInputNoteLengths.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`sheet-note-length-btn ${inputNoteLength === option.value ? "active" : ""}`.trim()}
                        onClick={() => applyInputNoteLengthToSelection(option.value)}
                        aria-pressed={inputNoteLength === option.value}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" className="sheet-edit-save-btn" onClick={saveSheet} disabled={!canSaveSheet}>
                  악보 저장
                </button>
                <button type="button" className="sheet-edit-score-btn" onClick={() => setSheetViewMode("score")}>
                  악보 보기
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSheetViewMode("edit")}>
                  편집으로
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {sampleLoadError ? <p className="error">{sampleLoadError}</p> : null}

      {editorSheet ? (
        sheetViewMode === "score" ? (
          <div className="sheet-score-view">
            <div ref={scorePaperRef} className="sheet-score-paper">
              <div ref={scoreNotationWrapRef} className="sheet-score-notation-wrap">
                <div
                  ref={scoreNotationSurfaceRef}
                  className="sheet-score-notation-vexflow"
                  role="img"
                  aria-label="A4 drum score notation"
                />
                {running && scoreCurrentBarRect ? (
                  <span
                    className="sheet-score-bar-highlight"
                    style={{
                      left: scoreCurrentBarRect.x,
                      top: scoreCurrentBarRect.top,
                      width: scoreCurrentBarRect.width,
                      height: scoreCurrentBarRect.height
                    }}
                    aria-hidden="true"
                  />
                ) : null}
                {running && totalSteps > 0 && scoreCurrentStepPoint ? (
                  <span
                    className="sheet-score-playhead"
                    style={{
                      left: scoreCurrentStepPoint.x,
                      top: scoreCurrentStepPoint.top,
                      height: scoreCurrentStepPoint.height
                    }}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div ref={trackGridScrollRef} className="sheet-maker-scroll">
            {showTrackGrid ? (
              <div className="sheet-maker-grid">
                <div className="sheet-maker-row sheet-maker-bar-header" style={gridStyle}>
                  <span className="sheet-maker-track-head sheet-maker-track-head-empty" aria-hidden="true" />
                  {Array.from({ length: editorSheet.totalBars }, (_, bar) => (
                    <span key={`bar-head-${bar}`} className="sheet-maker-bar-head" style={{ gridColumn: `span ${editorSheet.stepsPerBar}` }}>
                      {bar + 1}
                    </span>
                  ))}
                </div>
                <div className="sheet-maker-row sheet-maker-header" style={gridStyle}>
                  <span className="sheet-maker-track-head">트랙</span>
                  {Array.from({ length: totalSteps }, (_, step) => {
                    const barStart = step > 0 && step % editorSheet.stepsPerBar === 0;
                    const stepLabel = (step % editorSheet.stepsPerBar) + 1;
                    return (
                      <span
                        key={`head-${step}`}
                        className={`sheet-maker-head ${barStart ? "bar-start" : ""}`.trim()}
                        data-step={step}
                        onMouseDown={(event) => handleStepHeadMouseDown(step, event)}
                      >
                        {stepLabel}
                      </span>
                    );
                  })}
                </div>

                {TRACKS.map((track, trackIndex) => (
                  <SheetTrackRow
                    key={track.id}
                    track={track}
                    trackIndex={trackIndex}
                    stepCount={totalSteps}
                    visibleStepStart={clampedVisibleStepStart}
                    visibleStepEnd={clampedVisibleStepEnd}
                    stepsPerBar={editorSheet.stepsPerBar}
                    patternRow={editorSheet.pattern[track.id]}
                    hasSelection={normalizedBeatSelection != null}
                    selectedTrackStart={normalizedBeatSelection?.trackStart ?? -1}
                    selectedTrackEnd={normalizedBeatSelection?.trackEnd ?? -1}
                    selectedStepStart={normalizedBeatSelection?.stepStart ?? -1}
                    selectedStepEnd={normalizedBeatSelection?.stepEnd ?? -1}
                    inputNoteLength={inputNoteLength}
                    onGridMouseDown={handleGridCellMouseDown}
                    onGridMouseEnter={handleGridCellMouseEnter}
                    onGridClick={handleGridCellClick}
                  />
                ))}
              </div>
            ) : null}
            <div className="sheet-notation-wrap">
              <div
                ref={notationSurfaceRef}
                className="sheet-notation-vexflow"
                style={{ width: notationWidth, height: NOTATION_HEIGHT }}
                role="img"
                aria-label="Drum notation"
              />
              {showNotationDebug && totalSteps > 0 ? (
                <div className="sheet-notation-debug-layer" aria-hidden="true">
                  {stepCenters.slice(0, totalSteps).map((centerX, step) => (
                    <span
                      key={`debug-target-grid-${step}`}
                      className="sheet-notation-debug-line target-grid"
                      style={{ left: notationSurfaceOffsetX + centerX }}
                    />
                  ))}
                  {notationDebugPoints.map((point) => {
                    const delta = point.actualX - point.targetX;
                    return (
                      <div key={`debug-note-${point.step}`} className="sheet-notation-debug-point">
                        <span className="sheet-notation-debug-line target-note" style={{ left: notationSurfaceOffsetX + point.targetX }} />
                        <span className="sheet-notation-debug-line actual" style={{ left: notationSurfaceOffsetX + point.actualX }} />
                        {Math.abs(delta) >= 1 ? (
                          <span className="sheet-notation-debug-delta" style={{ left: notationSurfaceOffsetX + point.actualX }}>
                            {delta > 0 ? "+" : ""}
                            {delta.toFixed(1)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {totalSteps > 0 ? (
                <>
                  <span className="sheet-notation-playhead" style={{ left: notationPlayheadX }} aria-hidden="true" />
                  {!playbackActive ? (
                    <span
                      className="sheet-notation-playhead-handle"
                      style={{ left: notationPlayheadX }}
                      onMouseDown={handleNotationPlayheadMouseDown}
                      aria-hidden="true"
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        )
      ) : (
        <p className="muted">만들기 또는 불러오기를 누르면 악보 편집 그리드가 표시됩니다.</p>
      )}

      {showCreateModal ? (
        <div className="sheet-create-modal-overlay" role="presentation" onClick={() => setShowCreateModal(false)}>
          <div
            className="sheet-create-modal"
            role="dialog"
            aria-modal="true"
            aria-label="악보 만들기"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="sheet-create-modal-title">악보 만들기</h3>
            <div className="sheet-builder-form">
              <label className="practice-field">
                제목
                <input value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="악보 제목" />
              </label>
              <label className="practice-field">
                BPM
                <input
                  type="number"
                  min={40}
                  max={240}
                  value={bpmInput}
                  onChange={(e) => setBpmInput(Number.parseInt(e.target.value, 10) || 90)}
                />
              </label>
              <label className="practice-field">
                박자표
                <select value={timeSignatureInput} onChange={(e) => setTimeSignatureInput((e.target.value as TimeSignatureValue) || "4/4")}>
                  {TIME_SIGNATURE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="practice-field">
                총 마디
                <input
                  type="number"
                  min={1}
                  max={256}
                  value={totalBarsInput}
                  onChange={(e) => setTotalBarsInput(Number.parseInt(e.target.value, 10) || 1)}
                />
              </label>
            </div>
            <div className="sheet-create-modal-actions">
              <button type="button" onClick={() => setShowCreateModal(false)}>
                취소
              </button>
              <button type="button" onClick={createSheetFromModal}>
                만들기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showEditModal ? (
        <div className="sheet-create-modal-overlay" role="presentation" onClick={() => setShowEditModal(false)}>
          <div
            className="sheet-create-modal"
            role="dialog"
            aria-modal="true"
            aria-label="악보 수정"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="sheet-create-modal-title">악보 수정</h3>
            <div className="sheet-builder-form">
              <label className="practice-field">
                제목
                <input value={editTitleInput} onChange={(e) => setEditTitleInput(e.target.value)} placeholder="악보 제목" />
              </label>
              <label className="practice-field">
                BPM
                <input type="number" value={editorSheet?.bpm ?? bpmInput} disabled />
              </label>
              <label className="practice-field">
                박자표
                <select value={editTimeSignatureInput} onChange={(e) => setEditTimeSignatureInput((e.target.value as TimeSignatureValue) || "4/4")}>
                  {TIME_SIGNATURE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="practice-field">
                총 마디
                <input
                  type="number"
                  min={1}
                  max={256}
                  value={editTotalBarsInput}
                  onChange={(e) => setEditTotalBarsInput(Number.parseInt(e.target.value, 10) || 1)}
                />
              </label>
            </div>
            <div className="sheet-create-modal-actions">
              <button type="button" onClick={() => setShowEditModal(false)}>
                취소
              </button>
              <button type="button" onClick={applyEditFromModal}>
                적용
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {toastMessage ? (
        <div className="sheet-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
    </section>
  );
}
