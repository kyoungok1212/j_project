import type { Chord } from "./types";

export function chordSummary(chord: Chord): string {
  const typeLabel: Record<string, string> = {
    major: "메이저",
    minor: "마이너"
  };
  return `${chord.root} ${typeLabel[chord.type] ?? chord.type} (${chord.tones.join("-")})`;
}
