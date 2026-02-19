export type DrumTrackId =
  | "kick"
  | "snare"
  | "rimshot"
  | "sidestick"
  | "high_tom"
  | "mid_tom"
  | "floor_tom"
  | "hi_hat_open"
  | "hi_hat_close"
  | "foot_hi_hat"
  | "ride_cymbal"
  | "crash_cymbal";

export type SupportedTimeSignature = "1/4" | "2/4" | "3/4" | "6/8" | "4/4" | "6/4" | "12/8";
export type ImportedNoteLengthSteps = 1 | 2 | 4 | 8;
type ImportedVoicePart = "hand" | "foot";

export interface ImportedDrumSheet {
  title: string;
  bpm: number;
  timeSignature: SupportedTimeSignature;
  stepsPerBar: number;
  totalBars: number;
  pattern: Record<DrumTrackId, boolean[]>;
  noteLengthOverrides: Record<string, ImportedNoteLengthSteps>;
  mappedNoteCount: number;
  ignoredNoteCount: number;
}

export type GpImportErrorCode =
  | "FILE_TOO_LARGE"
  | "PARSE_FAILED"
  | "NO_DRUM_TRACK"
  | "UNSUPPORTED_TIME_SIGNATURE"
  | "EMPTY_TRACK";

export class GpImportError extends Error {
  readonly code: GpImportErrorCode;

  constructor(code: GpImportErrorCode, message: string) {
    super(message);
    this.name = "GpImportError";
    this.code = code;
  }
}

type AlphaTabScore = import("@coderline/alphatab").model.Score;
type AlphaTabTrack = import("@coderline/alphatab").model.Track;
type AlphaTabStaff = import("@coderline/alphatab").model.Staff;
type AlphaTabNote = import("@coderline/alphatab").model.Note;
type AlphaTabInstrumentArticulation = import("@coderline/alphatab").model.InstrumentArticulation;

interface TrackSelection {
  track: AlphaTabTrack;
  staff: AlphaTabStaff;
  noteCount: number;
  percussionLikeNoteCount: number;
  score: number;
}

interface TimelineBarInfo {
  startStep: number;
  steps: number;
}

interface ImportTimeline {
  timeSignature: SupportedTimeSignature;
  stepsPerBar: number;
  totalBars: number;
  totalSteps: number;
  bars: TimelineBarInfo[];
}

const DRUM_TRACK_IDS: DrumTrackId[] = [
  "kick",
  "snare",
  "rimshot",
  "sidestick",
  "high_tom",
  "mid_tom",
  "floor_tom",
  "hi_hat_open",
  "hi_hat_close",
  "foot_hi_hat",
  "ride_cymbal",
  "crash_cymbal"
];
const FOOT_TRACK_IDS = new Set<DrumTrackId>(["kick", "foot_hi_hat"]);
const NOTE_LENGTH_STEP_CANDIDATES: ImportedNoteLengthSteps[] = [1, 2, 4, 8];

const GP_FILE_EXTENSIONS = new Set([".gp", ".gp3", ".gp4", ".gp5", ".gpx"]);

const TIME_SIGNATURE_STEPS: Record<SupportedTimeSignature, number> = {
  "1/4": 8,
  "2/4": 16,
  "3/4": 24,
  "6/8": 24,
  "4/4": 32,
  "6/4": 48,
  "12/8": 48
};
const STEPS_PER_QUARTER = 8;

const TRACK_NAME_REGEX = /(drum|drums|dr\.|perc|percussion|kit)/i;

const MIDI_TO_TRACK: Partial<Record<number, DrumTrackId>> = {
  29: "ride_cymbal",
  30: "crash_cymbal",
  31: "sidestick",
  33: "sidestick",
  34: "snare",
  35: "kick",
  36: "kick",
  37: "sidestick",
  38: "snare",
  39: "rimshot",
  40: "snare",
  41: "floor_tom",
  42: "hi_hat_close",
  43: "floor_tom",
  44: "foot_hi_hat",
  45: "mid_tom",
  46: "hi_hat_open",
  47: "mid_tom",
  48: "high_tom",
  49: "crash_cymbal",
  50: "high_tom",
  51: "ride_cymbal",
  52: "crash_cymbal",
  53: "ride_cymbal",
  55: "crash_cymbal",
  57: "crash_cymbal",
  59: "ride_cymbal",
  91: "rimshot",
  92: "hi_hat_open",
  93: "ride_cymbal",
  94: "ride_cymbal",
  95: "crash_cymbal",
  96: "crash_cymbal",
  97: "crash_cymbal",
  98: "crash_cymbal",
  126: "ride_cymbal",
  127: "ride_cymbal"
};

export const GP_FILE_ACCEPT = ".gp,.gp3,.gp4,.gp5,.gpx";
export const GP_IMPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stripExtension(filename: string): string {
  const trimmed = filename.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, dotIndex);
}

function createEmptyPattern(totalSteps: number): Record<DrumTrackId, boolean[]> {
  return DRUM_TRACK_IDS.reduce((acc, trackId) => {
    acc[trackId] = Array.from({ length: totalSteps }, () => false);
    return acc;
  }, {} as Record<DrumTrackId, boolean[]>);
}

function buildDurationKey(voicePart: ImportedVoicePart, step: number): string {
  return `${voicePart}:${step}`;
}

function resolveVoicePart(trackId: DrumTrackId): ImportedVoicePart {
  return FOOT_TRACK_IDS.has(trackId) ? "foot" : "hand";
}

function quantizeNoteLengthSteps(rawLengthSteps: number, maxLengthInBar: number): ImportedNoteLengthSteps {
  const clampedRaw = clamp(rawLengthSteps, 1, Math.max(1, maxLengthInBar));
  const candidates = NOTE_LENGTH_STEP_CANDIDATES.filter((candidate) => candidate <= maxLengthInBar) as ImportedNoteLengthSteps[];
  const usable: ImportedNoteLengthSteps[] = candidates.length > 0 ? candidates : [1];

  let best = usable[0];
  let bestDistance = Math.abs(best - clampedRaw);
  for (let index = 1; index < usable.length; index += 1) {
    const candidate = usable[index];
    const distance = Math.abs(candidate - clampedRaw);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function toMidiInRange(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const midi = Math.round(value);
  if (midi < 0 || midi > 127) {
    return null;
  }
  return midi;
}

function resolveArticulationMidi(articulation: AlphaTabInstrumentArticulation | undefined): number | null {
  if (!articulation) {
    return null;
  }
  return toMidiInRange(articulation.outputMidiNumber);
}

function resolvePercussionArticulationMidi(track: AlphaTabTrack, articulationRef: number): number | null {
  if (!Number.isFinite(articulationRef) || articulationRef < 0) {
    return null;
  }

  const roundedRef = Math.round(articulationRef);
  const articulations = track.percussionArticulations ?? [];

  // alphaTab docs describe this value as an index, but some sources expose id-like values.
  const byDirectIndex = resolveArticulationMidi(articulations[roundedRef]);
  if (byDirectIndex != null) {
    return byDirectIndex;
  }

  const byOneBasedIndex = roundedRef > 0 ? resolveArticulationMidi(articulations[roundedRef - 1]) : null;
  if (byOneBasedIndex != null) {
    return byOneBasedIndex;
  }

  const byId = articulations.find((candidate) => Number.isFinite(candidate.id) && Math.round(candidate.id) === roundedRef);
  const byIdMidi = resolveArticulationMidi(byId);
  if (byIdMidi != null) {
    return byIdMidi;
  }

  // Fallback list in alphaTab docs follows GP7 articulation values.
  return toMidiInRange(roundedRef);
}

function hasPercussionContext(track: AlphaTabTrack, staff: AlphaTabStaff): boolean {
  return (
    track.isPercussion ||
    staff.isPercussion ||
    isPercussionChannel(track.playbackInfo.primaryChannel) ||
    isPercussionChannel(track.playbackInfo.secondaryChannel)
  );
}

function extractMidiNote(track: AlphaTabTrack, staff: AlphaTabStaff, note: AlphaTabNote): number | null {
  const articulationMidi = resolvePercussionArticulationMidi(track, note.percussionArticulation);
  if (articulationMidi != null) {
    return articulationMidi;
  }

  // Only trust note.realValue in percussion context to avoid mapping pitched guitar notes as drums.
  if (note.isPercussion || hasPercussionContext(track, staff)) {
    return toMidiInRange(note.realValue);
  }

  return null;
}

function mapMidiToTrack(midi: number | null): DrumTrackId | null {
  if (midi == null) {
    return null;
  }
  return MIDI_TO_TRACK[midi] ?? null;
}

function countStaffNotes(track: AlphaTabTrack, staff: AlphaTabStaff): { noteCount: number; percussionLikeNoteCount: number } {
  let noteCount = 0;
  let percussionLikeNoteCount = 0;
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          noteCount += 1;
          if (note.isPercussion || mapMidiToTrack(extractMidiNote(track, staff, note)) != null) {
            percussionLikeNoteCount += 1;
          }
        }
      }
    }
  }
  return { noteCount, percussionLikeNoteCount };
}

function isPercussionChannel(channel: number): boolean {
  return channel === 9 || channel === 10;
}

function chooseDrumTrack(score: AlphaTabScore): TrackSelection | null {
  let best: TrackSelection | null = null;

  for (const track of score.tracks) {
    if (track.staves.length === 0) {
      continue;
    }

    let bestStaff: TrackSelection | null = null;
    for (const staff of track.staves) {
      const stats = countStaffNotes(track, staff);
      if (stats.noteCount === 0) {
        continue;
      }
      const stubSelection: TrackSelection = {
        track,
        staff,
        noteCount: stats.noteCount,
        percussionLikeNoteCount: stats.percussionLikeNoteCount,
        score: 0
      };
      if (
        !bestStaff ||
        stubSelection.percussionLikeNoteCount > bestStaff.percussionLikeNoteCount ||
        (stubSelection.percussionLikeNoteCount === bestStaff.percussionLikeNoteCount && stubSelection.noteCount > bestStaff.noteCount)
      ) {
        bestStaff = stubSelection;
      }
    }

    if (!bestStaff) {
      continue;
    }

    const hasTrackPercussion = track.isPercussion || track.staves.some((staff) => staff.isPercussion);
    const hasPercussionChannel =
      isPercussionChannel(track.playbackInfo.primaryChannel) || isPercussionChannel(track.playbackInfo.secondaryChannel);
    const hasPercussionName = TRACK_NAME_REGEX.test(track.name ?? "") || TRACK_NAME_REGEX.test(track.shortName ?? "");
    const hasPercussionNotes = bestStaff.percussionLikeNoteCount > 0;

    if (!hasTrackPercussion && !hasPercussionChannel && !hasPercussionName && !hasPercussionNotes) {
      continue;
    }

    const scoreValue =
      (hasTrackPercussion ? 40 : 0) +
      (hasPercussionChannel ? 24 : 0) +
      (hasPercussionName ? 8 : 0) +
      bestStaff.percussionLikeNoteCount * 2 +
      bestStaff.noteCount;

    const candidate: TrackSelection = {
      ...bestStaff,
      score: scoreValue
    };

    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.percussionLikeNoteCount > best.percussionLikeNoteCount) ||
      (candidate.score === best.score &&
        candidate.percussionLikeNoteCount === best.percussionLikeNoteCount &&
        candidate.noteCount > best.noteCount)
    ) {
      best = candidate;
    }
  }

  return best;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const rest = x % y;
    x = y;
    y = rest;
  }
  return x || 1;
}

function normalizeSignaturePart(value: number, fallback: number): number {
  if (Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return fallback;
}

function resolveImportTimeline(score: AlphaTabScore, totalSourceBars: number): ImportTimeline {
  const defaultSignature: SupportedTimeSignature = "4/4";
  const normalizedBarCount = Math.max(1, totalSourceBars);

  if (score.masterBars.length === 0) {
    const stepsPerBar = TIME_SIGNATURE_STEPS[defaultSignature];
    const bars = Array.from({ length: normalizedBarCount }, (_, index) => ({
      startStep: index * stepsPerBar,
      steps: stepsPerBar
    }));
    const totalSteps = stepsPerBar * normalizedBarCount;
    return {
      timeSignature: defaultSignature,
      stepsPerBar,
      totalBars: normalizedBarCount,
      totalSteps,
      bars
    };
  }

  const barSignatures: Array<{
    signature: SupportedTimeSignature;
    quarterUnits: number;
    barSteps: number;
  }> = [];
  const uniqueSignatures = new Set<SupportedTimeSignature>();

  let lastNumerator = 4;
  let lastDenominator = 4;
  for (let barIndex = 0; barIndex < normalizedBarCount; barIndex += 1) {
    const masterBar = score.masterBars[barIndex];
    const numerator = normalizeSignaturePart(masterBar?.timeSignatureNumerator ?? 0, lastNumerator);
    const denominator = normalizeSignaturePart(masterBar?.timeSignatureDenominator ?? 0, lastDenominator);
    lastNumerator = numerator;
    lastDenominator = denominator;

    const signatureText = `${numerator}/${denominator}`;
    if (!(signatureText in TIME_SIGNATURE_STEPS)) {
      throw new GpImportError("UNSUPPORTED_TIME_SIGNATURE", "Unsupported time signature.");
    }
    const signature = signatureText as SupportedTimeSignature;
    uniqueSignatures.add(signature);

    const quarterUnitsRaw = (numerator * 4) / denominator;
    const quarterUnits = Math.round(quarterUnitsRaw);
    if (!Number.isFinite(quarterUnitsRaw) || quarterUnitsRaw <= 0 || Math.abs(quarterUnitsRaw - quarterUnits) > 1e-6) {
      throw new GpImportError("UNSUPPORTED_TIME_SIGNATURE", "Unsupported time signature.");
    }

    barSignatures.push({
      signature,
      quarterUnits,
      barSteps: quarterUnits * STEPS_PER_QUARTER
    });
  }

  let timeSignature: SupportedTimeSignature;
  let stepsPerBar: number;
  if (uniqueSignatures.size === 1) {
    timeSignature = barSignatures[0].signature;
    stepsPerBar = TIME_SIGNATURE_STEPS[timeSignature];
  } else {
    const baseByQuarterUnits: Partial<Record<number, SupportedTimeSignature>> = {
      1: "1/4",
      2: "2/4",
      3: "3/4",
      4: "4/4",
      6: "6/4"
    };
    const baseQuarterUnits = barSignatures
      .map((bar) => bar.quarterUnits)
      .reduce((acc, value) => gcd(acc, value));
    const mappedBaseSignature = baseByQuarterUnits[baseQuarterUnits];
    if (!mappedBaseSignature) {
      throw new GpImportError("UNSUPPORTED_TIME_SIGNATURE", "Unsupported time signature.");
    }
    timeSignature = mappedBaseSignature;
    stepsPerBar = TIME_SIGNATURE_STEPS[timeSignature];
  }

  const bars: TimelineBarInfo[] = [];
  let totalSteps = 0;
  for (const bar of barSignatures) {
    bars.push({
      startStep: totalSteps,
      steps: bar.barSteps
    });
    totalSteps += bar.barSteps;
  }

  if (totalSteps < 1 || totalSteps % stepsPerBar !== 0) {
    throw new GpImportError("UNSUPPORTED_TIME_SIGNATURE", "Unsupported time signature.");
  }

  return {
    timeSignature,
    stepsPerBar,
    totalBars: totalSteps / stepsPerBar,
    totalSteps,
    bars
  };
}

export async function importDrumSheetFromGpFile(file: File): Promise<ImportedDrumSheet> {
  if (file.size > GP_IMPORT_MAX_FILE_SIZE_BYTES) {
    throw new GpImportError("FILE_TOO_LARGE", "File is too large. Maximum is 10MB.");
  }

  const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  if (!GP_FILE_EXTENSIONS.has(extension)) {
    throw new GpImportError("PARSE_FAILED", "Failed to parse GP file.");
  }

  let score: AlphaTabScore;
  try {
    const alphaTab = await import("@coderline/alphatab");
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(fileBytes);
  } catch {
    throw new GpImportError("PARSE_FAILED", "Failed to parse GP file.");
  }

  const selected = chooseDrumTrack(score);
  if (!selected) {
    throw new GpImportError("NO_DRUM_TRACK", "No drum track found.");
  }

  const totalSourceBars = Math.max(1, selected.staff.bars.length, score.masterBars.length);
  const timeline = resolveImportTimeline(score, totalSourceBars);
  const { timeSignature, stepsPerBar, totalBars, totalSteps } = timeline;
  const pattern = createEmptyPattern(totalSteps);
  const noteLengthOverrides: Record<string, ImportedNoteLengthSteps> = {};

  let mappedNoteCount = 0;
  let ignoredNoteCount = 0;

  for (let barIndex = 0; barIndex < totalSourceBars; barIndex += 1) {
    const timelineBar = timeline.bars[barIndex];
    if (!timelineBar || timelineBar.steps < 1) {
      continue;
    }

    const bar = selected.staff.bars[barIndex];
    if (!bar) {
      continue;
    }
    const masterBar = score.masterBars[barIndex] ?? bar.masterBar;
    const barDuration = Math.max(1, masterBar.calculateDuration());
    const barStartStep = timelineBar.startStep;
    const barSteps = timelineBar.steps;

    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.isRest) {
          continue;
        }

        const rawStart = Number.isFinite(beat.playbackStart) ? beat.playbackStart : beat.displayStart;
        if (!Number.isFinite(rawStart)) {
          continue;
        }

        const stepInBar = clamp(Math.round((Math.max(0, rawStart) / barDuration) * barSteps), 0, barSteps - 1);
        const absoluteStep = barStartStep + stepInBar;
        if (absoluteStep < 0 || absoluteStep >= totalSteps) {
          continue;
        }

        const rawDuration = Number.isFinite(beat.playbackDuration) && beat.playbackDuration > 0 ? beat.playbackDuration : beat.displayDuration;
        const rawLengthSteps = (Math.max(1, rawDuration) / barDuration) * barSteps;
        const maxLengthInBar = Math.max(1, barSteps - stepInBar);
        const noteLength = quantizeNoteLengthSteps(rawLengthSteps, maxLengthInBar);

        for (const note of beat.notes) {
          const trackId = mapMidiToTrack(extractMidiNote(selected.track, selected.staff, note));
          if (!trackId) {
            ignoredNoteCount += 1;
            continue;
          }
          pattern[trackId][absoluteStep] = true;
          const voicePart = resolveVoicePart(trackId);
          const key = buildDurationKey(voicePart, absoluteStep);
          const currentLength = noteLengthOverrides[key];
          if (!currentLength || noteLength > currentLength) {
            noteLengthOverrides[key] = noteLength;
          }
          mappedNoteCount += 1;
        }
      }
    }
  }

  if (mappedNoteCount === 0) {
    throw new GpImportError("EMPTY_TRACK", "No mappable drum notes found.");
  }

  const titleFromScore = stripExtension(file.name) || score.title?.trim() || "Imported GP Drum Sheet";
  const rawBpm = Number.isFinite(score.tempo) ? Math.round(score.tempo) : 90;
  const bpm = clamp(rawBpm, 40, 240);

  return {
    title: titleFromScore,
    bpm,
    timeSignature,
    stepsPerBar,
    totalBars,
    pattern,
    noteLengthOverrides,
    mappedNoteCount,
    ignoredNoteCount
  };
}

