export interface MetronomeSettings {
  bpm: number;
  timeSignature: string;
  subdivision: MetronomeSubdivision;
  volume: number;
  running: boolean;
}

export type MetronomeSubdivision = "quarter" | "eighth" | "sixteenth" | "triplet" | "sextuplet";

export const METRONOME_SUBDIVISION_STEPS: Record<MetronomeSubdivision, number> = {
  quarter: 1,
  eighth: 2,
  sixteenth: 4,
  triplet: 3,
  sextuplet: 6
};

export const METRONOME_SETTINGS_KEY = "guitar_metronome_settings_v1";
export const METRONOME_SETTINGS_EVENT = "guitar-metronome-settings";
export const METRONOME_FORCE_STOP_EVENT = "guitar-metronome-force-stop";
export const METRONOME_VISUAL_EVENT = "guitar-metronome-visual";

const DEFAULT_SETTINGS: MetronomeSettings = {
  bpm: 90,
  timeSignature: "4/4",
  subdivision: "quarter",
  volume: 1,
  running: false
};

function normalizeTimeSignature(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.timeSignature;
  const match = value.match(/^(\d{1,2})\/(4|8)$/);
  if (!match) return DEFAULT_SETTINGS.timeSignature;
  const beats = Number.parseInt(match[1], 10);
  if (!Number.isFinite(beats) || beats < 1 || beats > 12) {
    return DEFAULT_SETTINGS.timeSignature;
  }
  return `${beats}/${match[2]}`;
}

function normalizeSubdivision(value: unknown): MetronomeSubdivision {
  if (
    value === "quarter" ||
    value === "eighth" ||
    value === "sixteenth" ||
    value === "triplet" ||
    value === "sextuplet"
  ) {
    return value;
  }
  return DEFAULT_SETTINGS.subdivision;
}

function normalizeVolume(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.volume;
  }
  return Math.max(0, Math.min(1, parsed));
}

export function readMetronomeSettings(): MetronomeSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(METRONOME_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<MetronomeSettings>;
    const bpm = Number.isFinite(parsed.bpm) ? Math.min(240, Math.max(40, Number(parsed.bpm))) : DEFAULT_SETTINGS.bpm;
    const timeSignature = normalizeTimeSignature(parsed.timeSignature);
    const subdivision = normalizeSubdivision(parsed.subdivision);
    const volume = normalizeVolume(parsed.volume);
    const running = typeof parsed.running === "boolean" ? parsed.running : DEFAULT_SETTINGS.running;
    return { bpm, timeSignature, subdivision, volume, running };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeMetronomeSettings(settings: MetronomeSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(METRONOME_SETTINGS_KEY, JSON.stringify(settings));
}

export function emitMetronomeSettings(settings: MetronomeSettings): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MetronomeSettings>(METRONOME_SETTINGS_EVENT, { detail: settings }));
}

export function emitMetronomeVisualState(settings: MetronomeSettings): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MetronomeSettings>(METRONOME_VISUAL_EVENT, { detail: settings }));
}
