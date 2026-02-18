import type { ScalePatternResponse } from "./types";

const CHROMATIC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const STANDARD_TUNING = [
  { string: 6, openNote: "E" },
  { string: 5, openNote: "A" },
  { string: 4, openNote: "D" },
  { string: 3, openNote: "G" },
  { string: 2, openNote: "B" },
  { string: 1, openNote: "E" }
] as const;
const OPEN_NOTE_BY_STRING = new Map<number, string>(STANDARD_TUNING.map((item) => [item.string, item.openNote]));
const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#"
};

export function toModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    major: "메이저",
    natural_minor: "내추럴 마이너",
    harmonic_minor: "하모닉 마이너",
    melodic_minor: "멜로딕 마이너",
    major_pentatonic: "메이저 펜타토닉",
    minor_pentatonic: "마이너 펜타토닉",
    major_blues: "메이저 블루스",
    minor_blues: "마이너 블루스",
    blues: "블루스"
  };
  return labels[mode] ?? mode;
}

export function buildHighlightSet(pattern: ScalePatternResponse | null): Set<string> {
  if (!pattern) return new Set();
  const result = new Set<string>();
  for (const row of pattern.fretPositions) {
    for (const fret of row.frets) {
      result.add(`${row.string}:${fret}`);
    }
  }
  return result;
}

function normalizeNote(note: string): string {
  return FLAT_TO_SHARP[note] ?? note;
}

export function noteAt(stringNumber: number, fret: number): string {
  const open = OPEN_NOTE_BY_STRING.get(stringNumber);
  if (!open) {
    throw new Error(`unsupported string number: ${stringNumber}`);
  }
  const startIndex = CHROMATIC.indexOf(normalizeNote(open));
  const noteIndex = (startIndex + fret) % CHROMATIC.length;
  return CHROMATIC[noteIndex];
}

export function normalizeScaleNote(note: string): string {
  return normalizeNote(note);
}
