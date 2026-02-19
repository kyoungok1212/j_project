import { useEffect, useMemo, useRef, useState } from "react";
import { getScaleManualState, upsertScaleManualState } from "../api";
import { STANDARD_TUNING, buildHighlightSet, noteAt, normalizeScaleNote } from "../service";
import type { ScalePatternResponse } from "../types";
import { MetronomeEngine } from "../../metronome/service";
import {
  emitMetronomeVisualState,
  METRONOME_FORCE_STOP_EVENT,
  METRONOME_SUBDIVISION_STEPS,
  METRONOME_SETTINGS_EVENT,
  readMetronomeSettings,
  type MetronomeSettings,
  type MetronomeSubdivision
} from "../../metronome/shared";

type ScaleFamily = "diatonic" | "pentatonic" | "blues";
type Tonality = "major" | "minor";
type DiatonicMinorType = "natural_minor" | "harmonic_minor" | "melodic_minor";
type PositionNo = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type PositionChoice = PositionNo | "all";
type StringNo = 1 | 2 | 3 | 4 | 5 | 6;
type PatternSystem = "caged" | "3nps";
type NoteDisplayMode = "note" | "degree";

type ManualScaleStore = Record<string, Partial<Record<PositionNo, Partial<Record<StringNo, number[]>>>>>;
type ManualPositions = Partial<Record<PositionNo, Partial<Record<StringNo, number[]>>>>;

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BASE_ROOT = "C";
const BASE_DIATONIC_MODE = "major";
const BASE_PENTATONIC_MODE = "major_pentatonic";
const FRET_MIN = 0;
const FRET_MAX = 17;
const POSITIONS_BY_SYSTEM: Record<PatternSystem, PositionNo[]> = {
  caged: [1, 2, 3, 4, 5],
  "3nps": [1, 2, 3, 4, 5, 6, 7]
};
const STRINGS: StringNo[] = [1, 2, 3, 4, 5, 6];
const PRACTICE_DOWNWARD_ORDER: StringNo[] = [6, 5, 4, 3, 2, 1];
const PRACTICE_UPWARD_ORDER: StringNo[] = [1, 2, 3, 4, 5, 6];
const SYSTEMS: PatternSystem[] = ["caged", "3nps"];
const DEFAULT_MODES = [
  "major",
  "natural_minor",
  "harmonic_minor",
  "melodic_minor",
  "major_pentatonic",
  "minor_pentatonic",
  "major_blues",
  "minor_blues"
] as const;
const FRETS = Array.from({ length: 18 }, (_, i) => i);
const MANUAL_SCALE_STORE_KEY = "guitar_manual_scale_patterns_v1";
const CHROMATIC_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const MODE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  major_blues: [0, 2, 3, 4, 7, 9],
  minor_blues: [0, 3, 5, 6, 7, 10]
};
const MODE_DEGREE_LABELS: Record<string, string[]> = {
  major: ["1", "2", "3", "4", "5", "6", "7"],
  natural_minor: ["1", "2", "b3", "4", "5", "b6", "b7"],
  harmonic_minor: ["1", "2", "b3", "4", "5", "b6", "7"],
  melodic_minor: ["1", "2", "b3", "4", "5", "6", "7"],
  major_pentatonic: ["1", "2", "3", "5", "6"],
  minor_pentatonic: ["1", "b3", "4", "5", "b7"],
  major_blues: ["1", "2", "b3", "3", "5", "6"],
  minor_blues: ["1", "b3", "4", "b5", "5", "b7"]
};
const METRONOME_SUBDIVISION_LABELS: Record<MetronomeSubdivision, string> = {
  quarter: "4분음표",
  eighth: "8분음표",
  sixteenth: "16분음표",
  triplet: "3연음",
  sextuplet: "6연음"
};

function resolveMode(family: ScaleFamily, tonality: Tonality, diatonicMinorType: DiatonicMinorType): string {
  if (family === "diatonic") {
    return tonality === "major" ? "major" : diatonicMinorType;
  }
  if (family === "pentatonic") {
    return tonality === "major" ? "major_pentatonic" : "minor_pentatonic";
  }
  return tonality === "major" ? "major_blues" : "minor_blues";
}

function positionRangeLabel(system: PatternSystem): string {
  return system === "3nps" ? "1~7" : "1~5";
}

function buildDegreeMap(root: string, mode: string): Map<string, string> {
  const rootIndex = CHROMATIC_NOTES.indexOf(normalizeScaleNote(root) as (typeof CHROMATIC_NOTES)[number]);
  if (rootIndex < 0) return new Map();

  const intervals = MODE_INTERVALS[mode] ?? [];
  const labels = MODE_DEGREE_LABELS[mode] ?? [];
  return new Map(
    intervals.map((interval, idx) => [
      CHROMATIC_NOTES[(rootIndex + interval) % CHROMATIC_NOTES.length],
      labels[idx] ?? String(idx + 1)
    ])
  );
}

function readManualStore(): ManualScaleStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MANUAL_SCALE_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ManualScaleStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeManualStore(store: ManualScaleStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MANUAL_SCALE_STORE_KEY, JSON.stringify(store));
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asManualScaleStore(value: unknown): ManualScaleStore {
  return asObjectRecord(value) as ManualScaleStore;
}

function buildManualKey(root: string, mode: string, system: PatternSystem): string {
  return `${root}|${mode}|${system}`;
}

function normalizeFrets(frets: number[]): number[] {
  return [...new Set(frets.filter((fret) => Number.isInteger(fret) && fret >= 0 && fret <= 17))].sort((a, b) => a - b);
}

function modeSystems(mode: string): PatternSystem[] {
  if (mode === "major_pentatonic" || mode === "minor_pentatonic") {
    return ["caged"];
  }
  return SYSTEMS;
}

function referenceModesByMode(mode: string, system: PatternSystem): string[] {
  if (system === "caged" && (mode.includes("pentatonic") || mode.includes("blues"))) {
    return [BASE_PENTATONIC_MODE, BASE_DIATONIC_MODE];
  }
  return [BASE_DIATONIC_MODE];
}

function hasAnyFretDataAtPosition(byPosition: ManualPositions | undefined, position: PositionNo): boolean {
  const byString = byPosition?.[position];
  if (!byString) return false;
  return STRINGS.some((stringNo) => normalizeFrets(byString[stringNo] ?? []).length > 0);
}

function hasAnyManualData(byPosition: ManualPositions | undefined): boolean {
  const allPositions: PositionNo[] = [1, 2, 3, 4, 5, 6, 7];
  return allPositions.some((positionNo) => hasAnyFretDataAtPosition(byPosition, positionNo));
}

function rootSemitoneShiftFromC(root: string): number {
  const cIndex = CHROMATIC_NOTES.indexOf("C");
  const rootIndex = CHROMATIC_NOTES.indexOf(normalizeScaleNote(root) as (typeof CHROMATIC_NOTES)[number]);
  if (rootIndex < 0) return 0;
  return (rootIndex - cIndex + CHROMATIC_NOTES.length) % CHROMATIC_NOTES.length;
}

function buildScaleNoteSet(root: string, mode: string): Set<string> {
  const rootIndex = CHROMATIC_NOTES.indexOf(normalizeScaleNote(root) as (typeof CHROMATIC_NOTES)[number]);
  const intervals = MODE_INTERVALS[mode] ?? [];
  if (rootIndex < 0 || intervals.length === 0) return new Set();

  return new Set(
    intervals.map((interval) => CHROMATIC_NOTES[(rootIndex + interval) % CHROMATIC_NOTES.length])
  );
}

function fitWindowToFretboard(min: number, max: number): { min: number; max: number } | null {
  const shiftedCandidates = [-24, -12, 0, 12, 24]
    .map((shift) => ({ min: min + shift, max: max + shift, shift }))
    .filter((candidate) => candidate.min >= FRET_MIN && candidate.max <= FRET_MAX);

  if (shiftedCandidates.length > 0) {
    shiftedCandidates.sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift));
    return { min: shiftedCandidates[0].min, max: shiftedCandidates[0].max };
  }

  if (max > FRET_MAX) {
    const overflow = max - FRET_MAX;
    min -= overflow;
    max -= overflow;
  }
  if (min < FRET_MIN) {
    const underflow = FRET_MIN - min;
    min += underflow;
    max += underflow;
  }

  min = Math.max(min, FRET_MIN);
  max = Math.min(max, FRET_MAX);
  if (min > max) return null;
  return { min, max };
}

function readPositionWindow(byString: Partial<Record<StringNo, number[]>> | undefined): { min: number; max: number } | null {
  if (!byString) return null;
  const allFrets = STRINGS.flatMap((stringNo) => normalizeFrets(byString[stringNo] ?? []));
  if (allFrets.length === 0) return null;
  return {
    min: Math.min(...allFrets),
    max: Math.max(...allFrets)
  };
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

function buildGeneratedPosition(
  referenceByString: Partial<Record<StringNo, number[]>> | undefined,
  shift: number,
  targetNotes: Set<string>,
  system: PatternSystem
): Partial<Record<StringNo, number[]>> | null {
  const window = readPositionWindow(referenceByString);
  if (!window) return null;

  const shiftedWindow = fitWindowToFretboard(window.min + shift, window.max + shift);
  if (!shiftedWindow) return null;

  const byString: Partial<Record<StringNo, number[]>> = {};
  for (const stringNo of STRINGS) {
    const frets: number[] = [];
    for (let fret = shiftedWindow.min; fret <= shiftedWindow.max; fret += 1) {
      if (targetNotes.has(noteAt(stringNo, fret))) {
        frets.push(fret);
      }
    }

    const normalized = system === "3nps" ? trimToThreeNps(frets, shiftedWindow.min, shiftedWindow.max) : frets;
    if (normalized.length > 0) {
      byString[stringNo] = normalized;
    }
  }

  return Object.keys(byString).length > 0 ? byString : null;
}

function buildGeneratedPositions(
  store: ManualScaleStore,
  root: string,
  mode: string,
  system: PatternSystem
): ManualPositions {
  let referenceByPosition: ManualPositions | undefined;
  for (const referenceMode of referenceModesByMode(mode, system)) {
    const candidate = store[buildManualKey(BASE_ROOT, referenceMode, system)];
    if (hasAnyManualData(candidate)) {
      referenceByPosition = candidate;
      break;
    }
  }
  if (!referenceByPosition) return {};

  const positions = POSITIONS_BY_SYSTEM[system];
  const shift = rootSemitoneShiftFromC(root);
  const targetNotes = buildScaleNoteSet(root, mode);
  if (targetNotes.size === 0) return {};

  const generated: ManualPositions = {};
  for (const positionNo of positions) {
    const byString = buildGeneratedPosition(referenceByPosition[positionNo], shift, targetNotes, system);
    if (byString) {
      generated[positionNo] = byString;
    }
  }
  return generated;
}

function buildPatternFromManual(
  store: ManualScaleStore,
  root: string,
  mode: string,
  system: PatternSystem,
  position: PositionNo
): ScalePatternResponse {
  const key = buildManualKey(root, mode, system);
  const byPosition = store[key]?.[position] ?? {};

  const fretPositions = STRINGS.map((stringNumber) => {
    const frets = normalizeFrets(byPosition[stringNumber] ?? []);
    return { string: stringNumber, frets };
  }).filter((row) => row.frets.length > 0);

  const notes = [...new Set(fretPositions.flatMap((row) => row.frets.map((fret) => noteAt(row.string, fret))))];

  return {
    root,
    mode,
    system,
    position,
    notes,
    tuning: [...STANDARD_TUNING],
    fretPositions
  };
}

function buildPracticeSequence(
  store: ManualScaleStore,
  root: string,
  mode: string,
  system: PatternSystem,
  positions: PositionNo[]
): string[] {
  const key = buildManualKey(root, mode, system);
  const sequence: string[] = [];
  for (const pos of positions) {
    const byPosition = store[key]?.[pos] ?? {};

    // Traverse within each position first, then move to the next position.
    for (const stringNumber of PRACTICE_DOWNWARD_ORDER) {
      const frets = normalizeFrets(byPosition[stringNumber] ?? []);
      for (const fret of frets) {
        sequence.push(`${stringNumber}:${fret}`);
      }
    }

    for (const stringNumber of PRACTICE_UPWARD_ORDER) {
      const frets = normalizeFrets(byPosition[stringNumber] ?? []);
      for (const fret of [...frets].reverse()) {
        sequence.push(`${stringNumber}:${fret}`);
      }
    }
  }

  return sequence;
}

export function ScalesView({ supervisorUnlocked = false }: { supervisorUnlocked?: boolean }) {
  const [root, setRoot] = useState("C");
  const [family, setFamily] = useState<ScaleFamily>("diatonic");
  const [tonality, setTonality] = useState<Tonality>("major");
  const [diatonicMinorType, setDiatonicMinorType] = useState<DiatonicMinorType>("natural_minor");
  const [system, setSystem] = useState<PatternSystem>("caged");
  const [position, setPosition] = useState<PositionChoice>("all");
  const [manualStore, setManualStore] = useState<ManualScaleStore>(() => readManualStore());
  const [editMode, setEditMode] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [manualStatus, setManualStatus] = useState("");
  const [stateLoaded, setStateLoaded] = useState(false);

  const [metronomeSettings, setMetronomeSettings] = useState<MetronomeSettings>(() => readMetronomeSettings());
  const [practiceRunning, setPracticeRunning] = useState(false);
  const [practiceCurrentKey, setPracticeCurrentKey] = useState("");
  const [noteDisplayMode, setNoteDisplayMode] = useState<NoteDisplayMode>("note");

  const autoSeedTriedRef = useRef(false);
  const practiceBeatTimerRef = useRef<number | null>(null);
  const practiceOffbeatTimersRef = useRef<number[]>([]);
  const practiceStepRef = useRef(0);
  const practiceSequenceRef = useRef<string[]>([]);
  const practiceOwnMetronomeRef = useRef(false);
  const saveDebounceRef = useRef<number | null>(null);
  const practiceMetronomeEngine = useMemo(() => new MetronomeEngine(), []);

  const [patterns, setPatterns] = useState<ScalePatternResponse[]>([]);
  const [error, setError] = useState("");

  const mode = useMemo(
    () => resolveMode(family, tonality, diatonicMinorType),
    [family, tonality, diatonicMinorType]
  );

  const highlights = useMemo(() => {
    const merged = new Set<string>();
    for (const item of patterns) {
      for (const key of buildHighlightSet(item)) {
        merged.add(key);
      }
    }
    return merged;
  }, [patterns]);

  const tuning = useMemo(() => {
    const fromPattern = patterns[0]?.tuning;
    if (fromPattern && fromPattern.length > 0) {
      return fromPattern;
    }
    return [...STANDARD_TUNING];
  }, [patterns]);

  const displayTuning = useMemo(() => {
    return [...tuning].sort((a, b) => a.string - b.string);
  }, [tuning]);

  const degreeByNote = useMemo(() => buildDegreeMap(root, mode), [root, mode]);
  const systemPositions = useMemo(() => POSITIONS_BY_SYSTEM[system], [system]);
  const manualKey = useMemo(() => buildManualKey(root, mode, system), [root, mode, system]);
  const selectedPosition = position === "all" ? null : position;
  const visibleSystems = useMemo<PatternSystem[]>(
    () => (family === "pentatonic" ? ["caged"] : SYSTEMS),
    [family]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadManualStateFromDb(): Promise<void> {
      const localPatterns = readManualStore();

      try {
        const remote = await getScaleManualState();
        const remotePatterns = asManualScaleStore(remote.patterns);
        const hasRemote = Object.keys(remotePatterns).length > 0;

        if (!cancelled && hasRemote) {
          setManualStore(remotePatterns);
          setManualStatus("DB에서 스케일 편집 데이터를 불러왔습니다.");
          return;
        }

        const hasLocal = Object.keys(localPatterns).length > 0;
        if (!cancelled && hasLocal) {
          setManualStore(localPatterns);
          setManualStatus("로컬 스케일 데이터를 DB로 옮겼습니다.");
        }

        if (hasLocal) {
          await upsertScaleManualState({ patterns: localPatterns });
        }
      } catch {
        if (cancelled) return;
        setManualStore(localPatterns);
        if (Object.keys(localPatterns).length > 0) {
          setManualStatus("DB 연결 실패로 로컬 스케일 데이터를 사용합니다.");
        }
      } finally {
        if (!cancelled) {
          setStateLoaded(true);
        }
      }
    }

    void loadManualStateFromDb();

    return () => {
      cancelled = true;
      if (saveDebounceRef.current != null) {
        window.clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!stateLoaded) {
      return;
    }

    if (saveDebounceRef.current != null) {
      window.clearTimeout(saveDebounceRef.current);
    }

    saveDebounceRef.current = window.setTimeout(() => {
      void upsertScaleManualState({ patterns: manualStore }).catch(() => {
        // Local cache remains as fallback if remote save fails.
      });
    }, 250);

    return () => {
      if (saveDebounceRef.current != null) {
        window.clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
    };
  }, [manualStore, stateLoaded]);

  useEffect(() => {
    const targets = position === "all" ? systemPositions : [position];
    const result = targets.map((pos) => buildPatternFromManual(manualStore, root, mode, system, pos));
    setPatterns(result);
    const hasData = result.some((item) => item.fretPositions.length > 0);
    setError(hasData ? "" : "선택한 스케일 데이터가 없습니다. 편집 모드에서 지판 좌클릭으로 입력하세요.");
  }, [root, family, tonality, diatonicMinorType, system, systemPositions, position, manualStore]);

  useEffect(() => {
    if (position === "all") return;
    if (systemPositions.includes(position)) return;
    setPosition("all");
    setManualStatus(`${system.toUpperCase()}는 포지션 ${positionRangeLabel(system)}만 지원합니다.`);
  }, [position, system, systemPositions]);

  useEffect(() => {
    if (family !== "pentatonic" || system !== "3nps") return;
    setSystem("caged");
    setManualStatus("펜타토닉은 CAGED만 지원합니다.");
  }, [family, system]);

  useEffect(() => {
    if (editMode && selectedPosition == null) {
      setEditMode(false);
      setManualStatus(`편집 종료 - ${positionRangeLabel(system)} 범위의 포지션을 선택하세요.`);
    }
  }, [editMode, selectedPosition, system]);

  useEffect(() => {
    if (!supervisorUnlocked && editMode) {
      setEditMode(false);
    }
  }, [supervisorUnlocked, editMode]);

  useEffect(() => {
    if (!stateLoaded) return;
    if (autoSeedTriedRef.current) return;
    if (Object.keys(manualStore).length > 0) return;
    autoSeedTriedRef.current = true;
    void handleFillDefaultData();
  }, [manualStore, stateLoaded]);

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
    return () => {
      if (practiceBeatTimerRef.current != null) {
        window.clearInterval(practiceBeatTimerRef.current);
        practiceBeatTimerRef.current = null;
      }
      for (const timerId of practiceOffbeatTimersRef.current) {
        window.clearTimeout(timerId);
      }
      practiceOffbeatTimersRef.current = [];
      practiceMetronomeEngine.stop();
      practiceOwnMetronomeRef.current = false;
      emitMetronomeVisualState({ ...metronomeSettings, running: false });
    };
  }, [practiceMetronomeEngine, metronomeSettings]);

  useEffect(() => {
    if (metronomeSettings.running && practiceOwnMetronomeRef.current) {
      practiceMetronomeEngine.stop();
      practiceOwnMetronomeRef.current = false;
    }
  }, [metronomeSettings.running, practiceMetronomeEngine]);

  useEffect(() => {
    if (!practiceRunning) return;
    emitMetronomeVisualState({ ...metronomeSettings, running: true });
  }, [practiceRunning, metronomeSettings]);

  function stopPracticeMetronomeSound(): void {
    if (!practiceOwnMetronomeRef.current) return;
    practiceMetronomeEngine.stop();
    practiceOwnMetronomeRef.current = false;
  }

  async function ensurePracticeMetronomeSound(): Promise<void> {
    const bpm = Math.max(40, Math.min(240, metronomeSettings.bpm || 90));
    const beatsPerBarRaw = Number.parseInt(metronomeSettings.timeSignature.split("/")[0], 10);
    const beatsPerBar = Number.isFinite(beatsPerBarRaw) && beatsPerBarRaw > 0 ? beatsPerBarRaw : 4;
    const subdivisionsPerBeat = METRONOME_SUBDIVISION_STEPS[metronomeSettings.subdivision ?? "quarter"];
    practiceMetronomeEngine.stop();
    await practiceMetronomeEngine.start(bpm, beatsPerBar, subdivisionsPerBeat, undefined, metronomeSettings.volume);
    practiceOwnMetronomeRef.current = true;
  }

  function stopPractice(nextStatus?: string): void {
    if (practiceBeatTimerRef.current != null) {
      window.clearInterval(practiceBeatTimerRef.current);
      practiceBeatTimerRef.current = null;
    }
    for (const timerId of practiceOffbeatTimersRef.current) {
      window.clearTimeout(timerId);
    }
    practiceOffbeatTimersRef.current = [];
    stopPracticeMetronomeSound();
    setPracticeRunning(false);
    setPracticeCurrentKey("");
    emitMetronomeVisualState({ ...metronomeSettings, running: false });
    if (nextStatus) setManualStatus(nextStatus);
  }

  function advancePracticeStep(): void {
    const seq = practiceSequenceRef.current;
    if (seq.length === 0) {
      stopPractice(`연습 데이터가 없습니다. 포지션 ${positionRangeLabel(system)} 데이터를 먼저 입력하세요.`);
      return;
    }
    practiceStepRef.current = (practiceStepRef.current + 1) % seq.length;
    setPracticeCurrentKey(seq[practiceStepRef.current]);
  }

  function scheduleSubdivisionSteps(beatMs: number, stepsPerBeat: number): void {
    if (stepsPerBeat <= 1) return;
    for (let step = 1; step < stepsPerBeat; step += 1) {
      const timerId = window.setTimeout(() => {
        practiceOffbeatTimersRef.current = practiceOffbeatTimersRef.current.filter((id) => id !== timerId);
        advancePracticeStep();
      }, (beatMs * step) / stepsPerBeat);
      practiceOffbeatTimersRef.current.push(timerId);
    }
  }

  async function handleTogglePractice(): Promise<void> {
    if (practiceRunning) {
      stopPractice();
      return;
    }

    const practicePositions = position === "all" ? systemPositions : [position];
    const sequence = buildPracticeSequence(manualStore, root, mode, system, practicePositions);
    if (sequence.length === 0) {
      setManualStatus(`연습 데이터가 없습니다. 포지션 ${positionRangeLabel(system)} 데이터를 먼저 입력하세요.`);
      return;
    }

    const bpm = Math.max(40, Math.min(240, metronomeSettings.bpm || 90));
    const beatsPerBarRaw = Number.parseInt(metronomeSettings.timeSignature.split("/")[0], 10);
    const beatsPerBar = Number.isFinite(beatsPerBarRaw) && beatsPerBarRaw > 0 ? beatsPerBarRaw : 4;
    const subdivision = metronomeSettings.subdivision ?? "quarter";
    const stepsPerBeat = METRONOME_SUBDIVISION_STEPS[subdivision];
    const beatMs = 60000 / bpm;
    const notesPerBar = beatsPerBar * stepsPerBeat;
    const subdivisionLabel = METRONOME_SUBDIVISION_LABELS[subdivision];

    practiceSequenceRef.current = sequence;
    practiceStepRef.current = 0;
    setPracticeCurrentKey(sequence[0]);
    setPracticeRunning(true);
    emitMetronomeVisualState({ ...metronomeSettings, running: true });
    setManualStatus(
      `연습 시작 - ${bpm} BPM, ${beatsPerBar}비트, ${subdivisionLabel} (마디당 ${notesPerBar}스텝)`
    );

    try {
      window.dispatchEvent(new Event(METRONOME_FORCE_STOP_EVENT));
      await ensurePracticeMetronomeSound();
    } catch {
      setManualStatus("연습은 시작됐지만 메트로놈 소리 재생에 실패했습니다. 브라우저 오디오 권한을 확인하세요.");
    }

    scheduleSubdivisionSteps(beatMs, stepsPerBeat);

    practiceBeatTimerRef.current = window.setInterval(() => {
      advancePracticeStep();
      scheduleSubdivisionSteps(beatMs, stepsPerBeat);
    }, beatMs);
  }

  function handleToggleEditMode(): void {
    if (editMode) {
      setEditMode(false);
      setManualStatus("편집 종료");
      return;
    }
    if (selectedPosition == null) {
      setManualStatus(`${positionRangeLabel(system)} 범위의 포지션을 선택하면 편집할 수 있습니다.`);
      return;
    }
    setEditMode(true);
    setManualStatus(`편집 시작 - 포지션 ${selectedPosition}에서 좌클릭으로 추가/삭제`);
  }

  function handleClearManualPosition(): void {
    if (selectedPosition == null) {
      setManualStatus("삭제할 포지션을 선택하세요.");
      return;
    }
    setManualStore((prev) => {
      const next: ManualScaleStore = { ...prev };
      const current = { ...(next[manualKey] ?? {}) };
      delete current[selectedPosition];
      if (Object.keys(current).length === 0) {
        delete next[manualKey];
      } else {
        next[manualKey] = current;
      }
      writeManualStore(next);
      return next;
    });
    setManualStatus(`삭제 완료 - 포지션 ${selectedPosition}`);
  }

  function toggleFretAt(positionNo: PositionNo, stringNumber: StringNo, fret: number): void {
    const before = normalizeFrets(manualStore[manualKey]?.[positionNo]?.[stringNumber] ?? []);
    const exists = before.includes(fret);

    setManualStore((prev) => {
      const next: ManualScaleStore = { ...prev };
      const currentByKey = { ...(next[manualKey] ?? {}) };
      const currentByPosition = { ...(currentByKey[positionNo] ?? {}) };
      const prevFrets = normalizeFrets(currentByPosition[stringNumber] ?? []);

      const after = exists ? prevFrets.filter((item) => item !== fret) : normalizeFrets([...prevFrets, fret]);

      currentByPosition[stringNumber] = after;
      currentByKey[positionNo] = currentByPosition;
      next[manualKey] = currentByKey;
      writeManualStore(next);
      return next;
    });
    setManualStatus(`${positionNo}포지션 ${stringNumber}번줄 ${fret}프렛 ${exists ? "삭제" : "추가"}`);
  }

  function handleFretClick(stringNumber: number, fret: number): void {
    if (!editMode || selectedPosition == null) return;
    const castString = stringNumber as StringNo;
    toggleFretAt(selectedPosition, castString, fret);
  }

  async function handleFillDefaultData(): Promise<void> {
    if (seeding) return;
    setSeeding(true);
    setManualStatus("C 메이저 기준 데이터로 누락 패턴을 채우는 중...");

    try {
      const next: ManualScaleStore = { ...manualStore };
      let addedCount = 0;
      let keptCount = 0;
      let missingCount = 0;

      for (const modeName of DEFAULT_MODES) {
        for (const systemName of modeSystems(modeName)) {
          for (const rootName of ROOTS) {
            const key = buildManualKey(rootName, modeName, systemName);
            const positionsForSystem = POSITIONS_BY_SYSTEM[systemName];
            const currentByPosition: ManualPositions = { ...(next[key] ?? {}) };
            const generatedByPosition = buildGeneratedPositions(next, rootName, modeName, systemName);

            for (const positionNo of positionsForSystem) {
              if (hasAnyFretDataAtPosition(currentByPosition, positionNo)) {
                keptCount += 1;
                continue;
              }

              const generatedByString = generatedByPosition[positionNo];
              if (!generatedByString) {
                missingCount += 1;
                continue;
              }

              currentByPosition[positionNo] = generatedByString;
              addedCount += 1;
            }

            if (Object.keys(currentByPosition).length > 0) {
              next[key] = currentByPosition;
            }
          }
        }
      }

      writeManualStore(next);
      setManualStore(next);
      setManualStatus(`채우기 완료: 추가 ${addedCount}, 유지 ${keptCount}, 누락 ${missingCount}`);
    } catch (err) {
      setManualStatus(err instanceof Error ? `채우기 실패: ${err.message}` : "채우기 실패");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <section className="card">
      <h2>스케일</h2>

      <div className="filter-stack">
        <div className="filter-row">
          <span className="filter-label">루트</span>
          <div className="root-controls">
            <div className="option-strip" role="group" aria-label="루트 선택">
              {ROOTS.map((note) => (
                <button
                  key={note}
                  type="button"
                  className={`option-btn ${root === note ? "active" : ""}`}
                  aria-pressed={root === note}
                  onClick={() => setRoot(note)}
                >
                  {note}
                </button>
              ))}
            </div>
            <div className="display-toggle" role="group" aria-label="표시 방식">
              <button
                type="button"
                className={`option-btn ${noteDisplayMode === "note" ? "active" : ""}`}
                aria-pressed={noteDisplayMode === "note"}
                onClick={() => setNoteDisplayMode("note")}
              >
                음계 보기
              </button>
              <button
                type="button"
                className={`option-btn ${noteDisplayMode === "degree" ? "active" : ""}`}
                aria-pressed={noteDisplayMode === "degree"}
                onClick={() => setNoteDisplayMode("degree")}
              >
                도수 보기
              </button>
            </div>
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label">스케일 타입</span>
          <div className="scale-controls">
            <div className="option-cluster">
              <div className="option-strip" role="group" aria-label="스케일 타입 선택">
                <button
                  type="button"
                  className={`option-btn ${family === "diatonic" ? "active" : ""}`}
                  aria-pressed={family === "diatonic"}
                  onClick={() => setFamily("diatonic")}
                >
                  다이아토닉
                </button>
                <button
                  type="button"
                  className={`option-btn ${family === "pentatonic" ? "active" : ""}`}
                  aria-pressed={family === "pentatonic"}
                  onClick={() => setFamily("pentatonic")}
                >
                  펜타토닉
                </button>
                <button
                  type="button"
                  className={`option-btn ${family === "blues" ? "active" : ""}`}
                  aria-pressed={family === "blues"}
                  onClick={() => setFamily("blues")}
                >
                  블루스
                </button>
              </div>
            </div>

            <div className="option-cluster">
              <span className="cluster-label">장/단</span>
              <div className="option-strip" role="group" aria-label="장단 선택">
                <button
                  type="button"
                  className={`option-btn ${tonality === "major" ? "active" : ""}`}
                  aria-pressed={tonality === "major"}
                  onClick={() => setTonality("major")}
                >
                  메이저
                </button>
                <button
                  type="button"
                  className={`option-btn ${tonality === "minor" ? "active" : ""}`}
                  aria-pressed={tonality === "minor"}
                  onClick={() => setTonality("minor")}
                >
                  마이너
                </button>
              </div>
            </div>

            {family === "diatonic" && tonality === "minor" ? (
              <div className="option-cluster minor-type-cluster">
                <span className="cluster-label">마이너 종류</span>
                <select
                  className="minor-type-select"
                  aria-label="마이너 종류"
                  value={diatonicMinorType}
                  onChange={(e) => setDiatonicMinorType(e.target.value as DiatonicMinorType)}
                >
                  <option value="natural_minor">내추럴 마이너</option>
                  <option value="harmonic_minor">하모닉 마이너</option>
                  <option value="melodic_minor">멜로딕 마이너</option>
                </select>
              </div>
            ) : null}

            <div className="option-cluster">
              <span className="cluster-label">패턴 방식</span>
              <div className="option-strip" role="group" aria-label="패턴 방식 선택">
                {visibleSystems.map((systemName) => (
                  <button
                    key={systemName}
                    type="button"
                    className={`option-btn ${system === systemName ? "active" : ""}`}
                    aria-pressed={system === systemName}
                    onClick={() => setSystem(systemName)}
                  >
                    {systemName === "caged" ? "CAGED" : "3NPS"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="position-row">
        <span className="position-label">포지션</span>
        <div className="position-controls">
          <div className="position-group">
            <button
              type="button"
              className={`position-btn ${position === "all" ? "active" : ""}`}
              onClick={() => setPosition("all")}
            >
              전체
            </button>
            {systemPositions.map((pos) => (
              <button
                key={pos}
                type="button"
                className={`position-btn ${position === pos ? "active" : ""}`}
                onClick={() => setPosition(pos)}
              >
                {pos}
              </button>
            ))}
          </div>
          {supervisorUnlocked ? (
            <div className="position-actions">
              <button type="button" onClick={handleToggleEditMode} disabled={selectedPosition == null}>
                {editMode ? "포지션 패턴 수정 종료" : "포지션 패턴 수정"}
              </button>
              <button type="button" onClick={() => void handleFillDefaultData()} disabled={seeding}>
                {seeding ? "채우는 중..." : "기준 데이터 채우기"}
              </button>
              <button type="button" onClick={handleClearManualPosition} disabled={selectedPosition == null}>
                현재 포지션 삭제
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="practice-controls-row">
        <div className="practice-controls">
          <span className="practice-row-label">연습</span>
          <div className="practice-control-group">
            <button
              type="button"
              onClick={() => void handleTogglePractice()}
              className={`practice-run-btn ${practiceRunning ? "practice-stop" : ""}`}
            >
              {practiceRunning ? "연습 정지" : "연습 시작"}
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {manualStatus ? <p className="ok">{manualStatus}</p> : null}

      <div className="fretboard-wrap">
        <table className="fretboard">
          <thead>
            <tr>
              <th>줄/프렛</th>
              {FRETS.map((fret) => (
                <th key={fret}>{fret}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayTuning.map(({ string: stringNumber }) => (
              <tr key={stringNumber}>
                <td className="string-label">{stringNumber}</td>
                {FRETS.map((fret) => {
                  const key = `${stringNumber}:${fret}`;
                  const isOpenFret = fret === 0;
                  const active = highlights.has(key);
                  const isPracticeCurrent = practiceRunning && practiceCurrentKey === key;
                  const note = noteAt(stringNumber, fret);
                  const isRoot = !isOpenFret && active && note === normalizeScaleNote(root);
                  const showNote = isOpenFret || active || isPracticeCurrent;
                  const marker = isOpenFret
                    ? note
                    : noteDisplayMode === "note"
                      ? note
                      : (degreeByNote.get(note) ?? note);
                  return (
                    <td
                      key={key}
                      className={`${editMode ? "editable-cell" : ""} ${isOpenFret ? "open-fret-cell" : ""}`.trim()}
                      onClick={() => handleFretClick(stringNumber, fret)}
                    >
                      <span
                        className={`note-dot ${isOpenFret ? "open" : ""} ${active && !isOpenFret ? "active" : ""} ${
                          isRoot ? "root" : ""
                        } ${
                          isPracticeCurrent ? "practice-current" : ""
                        }`}
                      >
                        {showNote ? marker : ""}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
