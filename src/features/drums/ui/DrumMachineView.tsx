import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  METRONOME_SUBDIVISION_STEPS,
  METRONOME_SETTINGS_EVENT,
  readMetronomeSettings,
  type MetronomeSettings,
  type MetronomeSubdivision
} from "../../metronome/shared";
import { DRUM_SAMPLE_SETTINGS_EVENT, readDrumSampleSettings } from "../sampleSettings";

const BASE_PATTERN_STEPS = 16;
const TRACKS = [
  { id: "kick", label: "킥" },
  { id: "snare", label: "스네어" },
  { id: "rimshot", label: "림샷" },
  { id: "sidestick", label: "사이드스틱" },
  { id: "high_tom", label: "하이탐" },
  { id: "mid_tom", label: "미드탐" },
  { id: "floor_tom", label: "플로어탐" },
  { id: "hi_hat_open", label: "하이햇 오픈" },
  { id: "hi_hat_close", label: "하이햇 클로즈" },
  { id: "foot_hi_hat", label: "풋 하이햇" },
  { id: "ride_cymbal", label: "라이드심벌" },
  { id: "crash_cymbal", label: "크래시심벌" }
] as const;

type DrumTrackId = (typeof TRACKS)[number]["id"];
type DrumPattern = Record<DrumTrackId, boolean[]>;
type DrumTrackSampleMap = Partial<Record<DrumTrackId, string>>;
type DrumPresetPatternMap = Record<MetronomeSubdivision, DrumPattern>;

interface DrumPresetOverrideEntry {
  patterns?: Partial<Record<MetronomeSubdivision, DrumPattern>>;
  samples?: DrumTrackSampleMap;
}

type DrumPresetOverrides = Record<string, DrumPresetOverrideEntry>;

interface DrumSampleManifest {
  version?: number;
  source?: string;
  tracks?: Partial<Record<DrumTrackId, DrumSampleOption[]>>;
}

interface DrumSampleOption {
  value: string;
  label: string;
}

interface DrumPreset {
  id: string;
  label: string;
  patterns: DrumPresetPatternMap;
}

const DRUM_PRESET_STORAGE_KEY = "jguitar_drum_preset_overrides_v3";
const SUBDIVISIONS: readonly MetronomeSubdivision[] = ["quarter", "eighth", "sixteenth", "triplet", "sextuplet"];

function getBeatsPerBar(timeSignature: string): number {
  const beatsPerBarRaw = Number.parseInt(timeSignature.split("/")[0], 10);
  return Number.isFinite(beatsPerBarRaw) && beatsPerBarRaw > 0 ? beatsPerBarRaw : 4;
}

function getSubdivisionBaseSteps(subdivision: MetronomeSubdivision): number {
  return 4 * METRONOME_SUBDIVISION_STEPS[subdivision];
}

function getTotalSteps(settings: MetronomeSettings): number {
  const beatsPerBar = getBeatsPerBar(settings.timeSignature);
  const stepsPerBeat = METRONOME_SUBDIVISION_STEPS[settings.subdivision ?? "quarter"];
  return Math.max(1, beatsPerBar * stepsPerBeat);
}

function buildStepRow(activeSteps: number[], steps = BASE_PATTERN_STEPS): boolean[] {
  const row = Array.from({ length: steps }, () => false);
  for (const step of activeSteps) {
    if (Number.isInteger(step) && step >= 0 && step < steps) {
      row[step] = true;
    }
  }
  return row;
}

function buildPattern(steps: number, active: Partial<Record<DrumTrackId, number[]>>): DrumPattern {
  return TRACKS.reduce((acc, track) => {
    acc[track.id] = buildStepRow(active[track.id] ?? [], steps);
    return acc;
  }, {} as DrumPattern);
}

function stepSeries(limit: number, interval: number, start = 0): number[] {
  const values: number[] = [];
  for (let index = start; index < limit; index += interval) {
    values.push(index);
  }
  return values;
}

function clonePattern(pattern: DrumPattern): DrumPattern {
  return TRACKS.reduce((acc, track) => {
    acc[track.id] = [...pattern[track.id]];
    return acc;
  }, {} as DrumPattern);
}

function resizePattern(pattern: DrumPattern, steps: number): DrumPattern {
  return TRACKS.reduce((acc, track) => {
    const source = pattern[track.id];
    if (!source || source.length === steps) {
      acc[track.id] = source ? [...source] : Array.from({ length: steps }, () => false);
      return acc;
    }
    const row = Array.from({ length: steps }, (_, index) => source[index % source.length]);
    if (steps < source.length) {
      return { ...acc, [track.id]: row };
    }
    acc[track.id] = row;
    return acc;
  }, {} as DrumPattern);
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

function cloneSamples(samples: DrumTrackSampleMap): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const value = samples[track.id];
    if (typeof value === "string" && value) {
      acc[track.id] = value;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

function isSameSamples(a: DrumTrackSampleMap, b: DrumTrackSampleMap): boolean {
  for (const track of TRACKS) {
    if ((a[track.id] ?? "") !== (b[track.id] ?? "")) {
      return false;
    }
  }
  return true;
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

function normalizeSamplesForOptions(
  samples: DrumTrackSampleMap,
  options: Record<DrumTrackId, DrumSampleOption[]>,
  fallbacks: DrumTrackSampleMap
): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const choices = options[track.id] ?? [];
    const value = samples[track.id];
    if (typeof value === "string" && value && choices.some((item) => item.value === value)) {
      acc[track.id] = value;
      return acc;
    }
    const fallback = fallbacks[track.id];
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

function parseBooleanStepRow(value: unknown, steps: number): boolean[] | null {
  if (!Array.isArray(value) || value.length !== steps || value.some((step) => typeof step !== "boolean")) {
    return null;
  }
  return [...value];
}

function parsePattern(value: unknown, steps: number): DrumPattern | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const next = {} as DrumPattern;
  let hasValidRow = false;
  for (const track of TRACKS) {
    const keys = [track.id, ...(LEGACY_PATTERN_FALLBACKS[track.id] ?? [])];
    let resolved: boolean[] | null = null;
    for (const key of keys) {
      const parsed = parseBooleanStepRow(record[key], steps);
      if (parsed) {
        resolved = parsed;
        break;
      }
    }
    if (resolved) {
      next[track.id] = resolved;
      hasValidRow = true;
      continue;
    }
    next[track.id] = Array.from({ length: steps }, () => false);
  }
  return hasValidRow ? next : null;
}

function parseSampleMap(value: unknown): DrumTrackSampleMap | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const next: DrumTrackSampleMap = {};
  let hasValue = false;
  for (const track of TRACKS) {
    const keys = [track.id, ...(LEGACY_SAMPLE_FALLBACKS[track.id] ?? [])];
    for (const key of keys) {
      const sample = record[key];
      if (typeof sample === "string" && sample) {
        next[track.id] = sample;
        hasValue = true;
        break;
      }
    }
  }
  return hasValue ? next : null;
}

function readPresetOverrides(): DrumPresetOverrides {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(DRUM_PRESET_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const next: DrumPresetOverrides = {};
    for (const [presetId, value] of Object.entries(parsed)) {
      const perSubdivision: Partial<Record<MetronomeSubdivision, DrumPattern>> = {};
      let samples: DrumTrackSampleMap | null = null;
      const legacyPattern = parsePattern(value, BASE_PATTERN_STEPS);
      if (legacyPattern) {
        perSubdivision.sixteenth = legacyPattern;
      } else if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const patternsSource =
          record.patterns && typeof record.patterns === "object" ? (record.patterns as Record<string, unknown>) : record;
        for (const subdivision of SUBDIVISIONS) {
          const candidate = parsePattern(patternsSource[subdivision], getSubdivisionBaseSteps(subdivision));
          if (candidate) {
            perSubdivision[subdivision] = candidate;
          }
        }
        samples = parseSampleMap(record.samples ?? record.selectedSamples);
      }
      if (Object.keys(perSubdivision).length > 0 || samples) {
        next[presetId] = {
          patterns: Object.keys(perSubdivision).length > 0 ? perSubdivision : undefined,
          samples: samples ? cloneSamples(samples) : undefined
        };
      }
    }
    return next;
  } catch {
    return {};
  }
}

function writePresetOverrides(overrides: DrumPresetOverrides): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(DRUM_PRESET_STORAGE_KEY, JSON.stringify(overrides));
}

function resolvePresetPattern(
  preset: DrumPreset,
  overrides: DrumPresetOverrides,
  subdivision: MetronomeSubdivision
): DrumPattern {
  return overrides[preset.id]?.patterns?.[subdivision] ?? preset.patterns[subdivision];
}

const DRUM_PRESETS: DrumPreset[] = [
  {
    id: "hard-rock",
    label: "하드락",
    patterns: {
      quarter: buildPattern(4, { kick: [0, 2], snare: [1, 3], hi_hat_close: [0, 1, 2, 3], foot_hi_hat: [1, 3], crash_cymbal: [0] }),
      eighth: buildPattern(8, { kick: [0, 3, 4, 6], snare: [2, 6], hi_hat_close: stepSeries(8, 1), hi_hat_open: [7], foot_hi_hat: [3], crash_cymbal: [0, 4], floor_tom: [7] }),
      sixteenth: buildPattern(16, { kick: [0, 3, 8, 10, 11, 14], snare: [4, 12], rimshot: [15], floor_tom: [14, 15], hi_hat_close: stepSeries(16, 2), hi_hat_open: [7, 15], crash_cymbal: [0, 8] }),
      triplet: buildPattern(12, { kick: [0, 4, 6, 8, 10], snare: [3, 9], hi_hat_close: [0, 2, 3, 5, 6, 8, 9, 11], hi_hat_open: [11], crash_cymbal: [0], floor_tom: [10, 11] }),
      sextuplet: buildPattern(24, { kick: [0, 4, 6, 10, 12, 16, 20, 22], snare: [6, 18], hi_hat_close: stepSeries(24, 3), hi_hat_open: [11, 23], crash_cymbal: [0, 12], mid_tom: [21], floor_tom: [22, 23] })
    }
  },
  {
    id: "modern-rock",
    label: "모던락",
    patterns: {
      quarter: buildPattern(4, { kick: [0, 2], snare: [1, 3], hi_hat_close: [0, 1, 2, 3], foot_hi_hat: [1, 3] }),
      eighth: buildPattern(8, { kick: [0, 3, 4, 7], snare: [2, 6], rimshot: [6], hi_hat_close: [0, 1, 2, 3, 4, 6, 7], hi_hat_open: [7], crash_cymbal: [0] }),
      sixteenth: buildPattern(16, { kick: [0, 5, 8, 11, 14], snare: [4, 12], rimshot: [10], hi_hat_close: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 15], hi_hat_open: [15], crash_cymbal: [0] }),
      triplet: buildPattern(12, { kick: [0, 2, 6, 8, 10], snare: [3, 9], hi_hat_close: [0, 1, 2, 3, 5, 6, 7, 8, 9, 11], hi_hat_open: [11], crash_cymbal: [0], floor_tom: [11] }),
      sextuplet: buildPattern(24, { kick: [0, 5, 6, 11, 12, 17, 20], snare: [6, 18], rimshot: [18], hi_hat_close: stepSeries(24, 2), hi_hat_open: [23], crash_cymbal: [0] })
    }
  },
  {
    id: "hiphop",
    label: "힙합",
    patterns: {
      quarter: buildPattern(4, { kick: [0, 2], sidestick: [1, 3], hi_hat_close: [0, 2], foot_hi_hat: [1, 3] }),
      eighth: buildPattern(8, { kick: [0, 3, 6], sidestick: [2, 6], hi_hat_close: [0, 2, 3, 4, 6, 7], hi_hat_open: [7] }),
      sixteenth: buildPattern(16, { kick: [0, 3, 7, 10, 14], sidestick: [4, 12], hi_hat_close: [0, 2, 3, 5, 6, 8, 10, 11, 13, 14], hi_hat_open: [15] }),
      triplet: buildPattern(12, { kick: [0, 2, 5, 8, 10], sidestick: [3, 9], hi_hat_close: [0, 2, 4, 5, 6, 8, 10, 11], foot_hi_hat: [6] }),
      sextuplet: buildPattern(24, { kick: [0, 5, 10, 12, 17, 22], sidestick: [6, 18], hi_hat_close: [0, 2, 4, 6, 9, 11, 12, 14, 16, 18, 21, 23], hi_hat_open: [23], high_tom: [23] })
    }
  },
  {
    id: "jazz",
    label: "재즈",
    patterns: {
      quarter: buildPattern(4, { kick: [0, 2], snare: [3], foot_hi_hat: [1, 3], hi_hat_close: [0, 2], hi_hat_open: [1], ride_cymbal: [0, 1, 2, 3], crash_cymbal: [0] }),
      eighth: buildPattern(8, { kick: [0, 4], snare: [5, 7], foot_hi_hat: [2, 6], hi_hat_close: [0, 2, 4, 6], ride_cymbal: [0, 2, 3, 4, 6, 7], crash_cymbal: [0] }),
      sixteenth: buildPattern(16, { kick: [0, 8], snare: [10, 15], sidestick: [15], foot_hi_hat: [4, 12], hi_hat_close: [0, 4, 8, 12], ride_cymbal: [0, 3, 4, 7, 8, 11, 12, 15], crash_cymbal: [0] }),
      triplet: buildPattern(12, { kick: [0, 6], snare: [8, 11], foot_hi_hat: [3, 9], hi_hat_close: [0, 3, 6, 9], ride_cymbal: [0, 2, 3, 5, 6, 8, 9, 11], crash_cymbal: [0] }),
      sextuplet: buildPattern(24, { kick: [0, 12], snare: [16, 22], foot_hi_hat: [6, 18], hi_hat_close: [0, 6, 12, 18], ride_cymbal: [0, 4, 6, 10, 12, 16, 18, 22], crash_cymbal: [0] })
    }
  },
  {
    id: "blues",
    label: "블루스",
    patterns: {
      quarter: buildPattern(4, { kick: [0, 2], snare: [1, 3], hi_hat_close: [1, 3], foot_hi_hat: [1, 3], ride_cymbal: [0, 1, 2, 3] }),
      eighth: buildPattern(8, { kick: [0, 4, 6], snare: [2, 6], sidestick: [6], hi_hat_close: [2, 6], ride_cymbal: [0, 2, 3, 4, 6, 7], crash_cymbal: [0] }),
      sixteenth: buildPattern(16, { kick: [0, 6, 8, 14], snare: [4, 12], hi_hat_close: [2, 6, 10, 14], ride_cymbal: [0, 3, 6, 8, 11, 14] }),
      triplet: buildPattern(12, { kick: [0, 5, 6, 10], snare: [3, 9], hi_hat_close: [3, 9], ride_cymbal: [0, 2, 3, 5, 6, 8, 9, 11], floor_tom: [11] }),
      sextuplet: buildPattern(24, { kick: [0, 6, 12, 16, 20], snare: [6, 18], sidestick: [18], hi_hat_close: [6, 18], ride_cymbal: [0, 4, 6, 10, 12, 16, 18, 22], floor_tom: [22, 23] })
    }
  },
  {
    id: "metal",
    label: "메탈",
    patterns: {
      quarter: buildPattern(4, { kick: [0, 1, 2, 3], snare: [1, 3], hi_hat_close: [0, 1, 2, 3], foot_hi_hat: [1, 3], crash_cymbal: [0, 2] }),
      eighth: buildPattern(8, { kick: stepSeries(8, 1), snare: [2, 6], ride_cymbal: [1, 3, 5, 7], hi_hat_open: [7], crash_cymbal: [0, 4] }),
      sixteenth: buildPattern(16, { kick: stepSeries(16, 1), snare: [4, 12], ride_cymbal: [1, 3, 5, 7, 9, 11, 13, 15], hi_hat_open: [15], crash_cymbal: [0, 8] }),
      triplet: buildPattern(12, { kick: stepSeries(12, 1), snare: [3, 9], ride_cymbal: [0, 2, 4, 6, 8, 10], crash_cymbal: [0, 6], floor_tom: [11] }),
      sextuplet: buildPattern(24, { kick: stepSeries(24, 1), snare: [6, 18], ride_cymbal: stepSeries(24, 2), crash_cymbal: [0, 12], high_tom: [21], mid_tom: [23], floor_tom: [22, 23] })
    }
  },
  {
    id: "ballad",
    label: "발라드",
    patterns: {
      quarter: buildPattern(4, { kick: [0], sidestick: [3], hi_hat_close: [0, 2], foot_hi_hat: [1, 3], ride_cymbal: [1, 3], crash_cymbal: [0] }),
      eighth: buildPattern(8, { kick: [0, 4], sidestick: [6], hi_hat_close: [0, 2, 4, 6], hi_hat_open: [7], foot_hi_hat: [2, 6], ride_cymbal: [1, 3, 5, 7] }),
      sixteenth: buildPattern(16, { kick: [0, 8], sidestick: [12], hi_hat_close: stepSeries(16, 2), hi_hat_open: [15], foot_hi_hat: [4, 12], ride_cymbal: [2, 6, 10, 14] }),
      triplet: buildPattern(12, { kick: [0, 6], sidestick: [9], hi_hat_close: [0, 3, 6, 9], hi_hat_open: [11], foot_hi_hat: [3, 9], ride_cymbal: [1, 4, 7, 10] }),
      sextuplet: buildPattern(24, { kick: [0, 12], sidestick: [18], hi_hat_close: stepSeries(24, 3), hi_hat_open: [23], ride_cymbal: [2, 8, 14, 20], crash_cymbal: [0], floor_tom: [22] })
    }
  }
];

export function DrumMachineView() {
  const [metronomeSettings, setMetronomeSettings] = useState<MetronomeSettings>(() => readMetronomeSettings());
  const currentSubdivision = metronomeSettings.subdivision ?? "quarter";
  const totalSteps = getTotalSteps(metronomeSettings);
  const stepsPerBeat = METRONOME_SUBDIVISION_STEPS[currentSubdivision];
  const beatsPerBar = getBeatsPerBar(metronomeSettings.timeSignature);
  const [presetOverrides, setPresetOverrides] = useState<DrumPresetOverrides>(() => readPresetOverrides());
  const [selectedPresetId, setSelectedPresetId] = useState<string>(DRUM_PRESETS[0].id);
  const [pattern, setPattern] = useState<DrumPattern>(() => {
    const overrides = readPresetOverrides();
    const initialSettings = readMetronomeSettings();
    const initialSubdivision = initialSettings.subdivision ?? "quarter";
    const basePattern = resolvePresetPattern(DRUM_PRESETS[0], overrides, initialSubdivision);
    return resizePattern(basePattern, getTotalSteps(initialSettings));
  });
  const [presetSaveMessage, setPresetSaveMessage] = useState("");
  const [sampleOptions, setSampleOptions] = useState<Record<DrumTrackId, DrumSampleOption[]>>(() => emptySampleOptions());
  const [selectedSamples, setSelectedSamples] = useState<DrumTrackSampleMap>({});
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [sampleLoadedCount, setSampleLoadedCount] = useState(0);
  const [sampleLoadError, setSampleLoadError] = useState("");
  const timerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const patternRef = useRef(pattern);
  const sampleBufferRef = useRef<Partial<Record<DrumTrackId, AudioBuffer>>>({});
  const previousGridRef = useRef({ stepsPerBeat, totalSteps });
  const selectedPreset = DRUM_PRESETS.find((preset) => preset.id === selectedPresetId) ?? DRUM_PRESETS[0];
  const selectedPresetPattern = resizePattern(resolvePresetPattern(selectedPreset, presetOverrides, currentSubdivision), totalSteps);
  const canSavePreset = !isSamePattern(pattern, selectedPresetPattern);
  const drumStepRowStyle = { ["--drum-step-count" as string]: totalSteps } as CSSProperties;

  useEffect(() => {
    patternRef.current = pattern;
  }, [pattern]);

  useEffect(() => {
    const previousGrid = previousGridRef.current;
    const subdivisionChanged = previousGrid.stepsPerBeat !== stepsPerBeat;

    if (subdivisionChanged) {
      const basePattern = resolvePresetPattern(selectedPreset, presetOverrides, currentSubdivision);
      setPattern(resizePattern(basePattern, totalSteps));
      setCurrentStep(0);
      setPresetSaveMessage("");
    } else if (previousGrid.totalSteps !== totalSteps) {
      setPattern((prev) => resizePattern(prev, totalSteps));
      setCurrentStep((prev) => prev % totalSteps);
    }

    previousGridRef.current = { stepsPerBeat, totalSteps };
  }, [stepsPerBeat, totalSteps, currentSubdivision, selectedPresetId, presetOverrides, selectedPreset]);

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
    let cancelled = false;

    async function loadManifest(): Promise<void> {
      try {
        const response = await fetch("/real-drum/manifest.json");
        if (!response.ok) {
          throw new Error(`샘플 목록 로드 실패 (${response.status})`);
        }
        const parsed = (await response.json()) as DrumSampleManifest;
        if (!parsed || typeof parsed !== "object" || !parsed.tracks || typeof parsed.tracks !== "object") {
          throw new Error("샘플 목록 형식이 올바르지 않습니다.");
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
          throw new Error("사용 가능한 트랙 샘플이 없습니다.");
        }

        const defaults = buildDefaultSamples(nextOptions);
        const savedGlobalSamples = mapStorageSamplesToTracks(readDrumSampleSettings());
        const normalizedGlobalSamples = normalizeSamplesForOptions(savedGlobalSamples, nextOptions, defaults);

        setSampleOptions(nextOptions);
        setSelectedSamples(normalizedGlobalSamples);
      } catch (err) {
        if (!cancelled) {
          setSampleLoadError(err instanceof Error ? err.message : "샘플 목록 로드 실패");
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
    const defaults = buildDefaultSamples(sampleOptions);
    const syncFromSettings = (): void => {
      const savedGlobalSamples = mapStorageSamplesToTracks(readDrumSampleSettings());
      const normalizedGlobalSamples = normalizeSamplesForOptions(savedGlobalSamples, sampleOptions, defaults);
      setSelectedSamples((prev) => {
        const prevNormalized = normalizeSamplesForOptions(prev, sampleOptions, defaults);
        if (isSameSamples(prevNormalized, normalizedGlobalSamples)) {
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
  }, [sampleOptions]);

  useEffect(() => {
    const selectedCount = TRACKS.reduce((acc, track) => (selectedSamples[track.id] ? acc + 1 : acc), 0);
    if (selectedCount === 0) return;
    let cancelled = false;

    async function loadSamplesForTracks(): Promise<void> {
      setSampleLoadError("");
      setSampleLoadedCount(0);
      sampleBufferRef.current = {};

      const ctx = getAudioContext();
      const loaded: Partial<Record<DrumTrackId, AudioBuffer>> = {};
      let loadedCount = 0;

      for (const track of TRACKS) {
        const sampleUrl = selectedSamples[track.id];
        if (!sampleUrl) {
          continue;
        }
        try {
          const response = await fetch(sampleUrl);
          if (!response.ok) {
            throw new Error(`${track.label} 샘플 로드 실패 (${response.status})`);
          }
          const arrayBuffer = await response.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
          loaded[track.id] = decoded;
          loadedCount += 1;
          if (!cancelled) {
            sampleBufferRef.current = { ...loaded };
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
  }, [selectedSamples]);

  useEffect(() => {
    if (!running) return;
    const bpm = Math.max(40, Math.min(240, metronomeSettings.bpm || 90));
    const stepMs = 60000 / bpm / stepsPerBeat;
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
    }
    timerRef.current = window.setInterval(() => {
      setCurrentStep((prev) => {
        const next = (prev + 1) % totalSteps;
        playStep(next);
        return next;
      });
    }, stepMs);

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [running, metronomeSettings.bpm, stepsPerBeat, totalSteps]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
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

  function triggerTrack(trackId: DrumTrackId): void {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const sample = sampleBufferRef.current[trackId];
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
      source.start(now);
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
        peak = 0.28;
        release = 0.12;
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(62, now + release);
        break;
      case "snare":
        frequency = 220;
        wave = "triangle";
        peak = 0.2;
        release = 0.08;
        osc.frequency.setValueAtTime(frequency, now);
        break;
      case "rimshot":
        frequency = 340;
        wave = "square";
        peak = 0.18;
        release = 0.06;
        osc.frequency.setValueAtTime(frequency, now);
        break;
      case "sidestick":
        frequency = 420;
        wave = "triangle";
        peak = 0.13;
        release = 0.05;
        osc.frequency.setValueAtTime(frequency, now);
        break;
      case "high_tom":
        frequency = 210;
        wave = "sine";
        peak = 0.2;
        release = 0.09;
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(190, now + release);
        break;
      case "mid_tom":
        frequency = 160;
        wave = "sine";
        peak = 0.21;
        release = 0.1;
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(130, now + release);
        break;
      case "floor_tom":
        frequency = 126;
        wave = "sine";
        peak = 0.23;
        release = 0.12;
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(96, now + release);
        break;
      case "ride_cymbal":
        frequency = 980;
        wave = "triangle";
        peak = 0.1;
        release = 0.09;
        osc.frequency.setValueAtTime(frequency, now);
        break;
      case "hi_hat_open":
        frequency = 760;
        wave = "square";
        peak = 0.11;
        release = 0.12;
        osc.frequency.setValueAtTime(frequency, now);
        break;
      case "hi_hat_close":
        frequency = 920;
        wave = "square";
        peak = 0.1;
        release = 0.045;
        osc.frequency.setValueAtTime(frequency, now);
        break;
      case "foot_hi_hat":
        frequency = 640;
        wave = "square";
        peak = 0.08;
        release = 0.035;
        osc.frequency.setValueAtTime(frequency, now);
        break;
      case "crash_cymbal":
        frequency = 740;
        wave = "square";
        peak = 0.12;
        release = 0.13;
        osc.frequency.setValueAtTime(frequency, now);
        break;
      default:
        osc.frequency.setValueAtTime(frequency, now);
        break;
    }

    osc.type = wave;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.0025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + release);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + release + 0.01);
  }

  function playStep(step: number): void {
    const current = patternRef.current;
    for (const track of TRACKS) {
      if (current[track.id][step]) {
        triggerTrack(track.id);
      }
    }
  }

  function togglePlayback(): void {
    if (running) {
      setRunning(false);
      return;
    }
    setCurrentStep(0);
    playStep(0);
    setRunning(true);
  }

  function toggleCell(trackId: DrumTrackId, step: number): void {
    setPattern((prev) => {
      const next = clonePattern(prev);
      next[trackId][step] = !next[trackId][step];
      return next;
    });
    setPresetSaveMessage("");
  }

  function applyPreset(preset: DrumPreset): void {
    const resolvedPattern = resizePattern(resolvePresetPattern(preset, presetOverrides, currentSubdivision), totalSteps);
    setSelectedPresetId(preset.id);
    setPattern(clonePattern(resolvedPattern));
    setCurrentStep(0);
    setPresetSaveMessage("");
  }

  function savePreset(): void {
    if (!canSavePreset) {
      return;
    }
    const targetPreset = DRUM_PRESETS.find((preset) => preset.id === selectedPresetId);
    if (!targetPreset) {
      return;
    }
    const snapshot = resizePattern(patternRef.current, getSubdivisionBaseSteps(currentSubdivision));
    setPresetOverrides((prev) => {
      const next = {
        ...prev,
        [targetPreset.id]: {
          ...(prev[targetPreset.id] ?? {}),
          patterns: {
            ...(prev[targetPreset.id]?.patterns ?? {}),
            [currentSubdivision]: snapshot
          }
        }
      };
      writePresetOverrides(next);
      return next;
    });
    setPresetSaveMessage(`${targetPreset.label} 패턴 저장됨`);
  }

  return (
    <section className="card">
      <h2>드럼 머신</h2>
      <div className="row">
        <span className="muted">메트로놈 BPM 연동: {metronomeSettings.bpm}</span>
        <span className="muted">
          {beatsPerBar}비트 / {stepsPerBeat}분할 / 총 {totalSteps}스텝
        </span>
        <span className="muted">샘플 로드: {sampleLoadedCount}/{TRACKS.length}</span>
        <button
          type="button"
          className={`practice-run-btn ${running ? "practice-stop" : ""}`}
          onClick={togglePlayback}
          aria-label={running ? "재생 정지" : "재생 시작"}
        >
          {running ? <span className="practice-stop-icon" aria-hidden="true">■</span> : <span className="practice-run-icon" aria-hidden="true">▶</span>}
        </button>
      </div>
      {presetSaveMessage ? <p className="muted">{presetSaveMessage}</p> : null}
      {sampleLoadError ? <p className="error">{sampleLoadError}</p> : null}

      <div className="drum-preset-row">
        <div className="option-strip" role="group" aria-label="드럼 프리셋 선택">
          {DRUM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`option-btn ${selectedPresetId === preset.id ? "active" : ""}`.trim()}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <button type="button" className="drum-preset-save-btn" onClick={savePreset} disabled={!canSavePreset}>
          저장
        </button>
      </div>

      <div className="drum-grid-scroll">
        <div className="drum-machine-grid">
          <div className="drum-step-row drum-step-header" style={drumStepRowStyle}>
            <span className="drum-track-head">트랙</span>
            {Array.from({ length: totalSteps }, (_, step) => (
              <span
                key={step}
                className={`drum-step-head ${step > 0 && step % stepsPerBeat === 0 ? "beat-start" : ""} ${running && currentStep === step ? "current" : ""}`.trim()}
              >
                {step + 1}
              </span>
            ))}
          </div>

          {TRACKS.map((track) => (
            <div key={track.id} className="drum-step-row" style={drumStepRowStyle}>
              <div className="drum-track-control">
                <span className="drum-track-label">{track.label}</span>
              </div>
              {Array.from({ length: totalSteps }, (_, step) => {
                const active = pattern[track.id][step];
                const beatStart = step > 0 && step % stepsPerBeat === 0;
                return (
                  <button
                    key={`${track.id}:${step}`}
                    type="button"
                    className={`drum-step-btn ${beatStart ? "beat-start" : ""} ${active ? "active" : ""} ${running && currentStep === step ? "current" : ""}`.trim()}
                    onClick={() => toggleCell(track.id, step)}
                    aria-label={`${track.label} ${step + 1}스텝 ${active ? "해제" : "선택"}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
