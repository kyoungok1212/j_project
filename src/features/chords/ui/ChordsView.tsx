import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

type ChordType =
  | "major"
  | "minor"
  | "7"
  | "5"
  | "dim"
  | "dim7"
  | "aug"
  | "sus2"
  | "sus4"
  | "maj7"
  | "m7"
  | "7sus4";

type StringNo = 1 | 2 | 3 | 4 | 5 | 6;
type PositionNo = 1 | 2 | 3 | 4 | 5 | 6;
type PositionChoice = "all" | PositionNo;
type ManualFretValue = number | number[];
type ManualPositionData = Partial<Record<StringNo, ManualFretValue>>;
type ManualChordStore = Record<string, Partial<Record<PositionNo, ManualPositionData>>>;
type ManualMutePositionData = Partial<Record<StringNo, number[]>>;
type ManualMuteStore = Record<string, Partial<Record<PositionNo, ManualMutePositionData>>>;

interface FretCandidate {
  fret: number;
  interval: number;
}

interface BarreSegment {
  fret: number;
  fromString: StringNo;
  toString: StringNo;
}

type ManualBarreStore = Record<string, Partial<Record<PositionNo, BarreSegment[]>>>;
type BarreRole = "start" | "middle" | "end";

interface BarreDragState {
  fret: number;
  startString: StringNo;
  currentString: StringNo;
}

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const CHROMATIC = [...ROOTS] as const;
const FRETS = Array.from({ length: 18 }, (_, i) => i);
const STRING_ORDER_LOW_TO_HIGH: StringNo[] = [6, 5, 4, 3, 2, 1];

const STANDARD_TUNING: Array<{ string: StringNo; openNote: (typeof CHROMATIC)[number] }> = [
  { string: 6, openNote: "E" },
  { string: 5, openNote: "A" },
  { string: 4, openNote: "D" },
  { string: 3, openNote: "G" },
  { string: 2, openNote: "B" },
  { string: 1, openNote: "E" }
];
const DISPLAY_TUNING = [...STANDARD_TUNING].sort((a, b) => a.string - b.string);
const OPEN_NOTE_BY_STRING = new Map<StringNo, (typeof CHROMATIC)[number]>(
  STANDARD_TUNING.map((item) => [item.string, item.openNote])
);

const CHORD_TYPE_DEFS: Array<{ id: ChordType; label: string; intervals: number[] }> = [
  { id: "major", label: "메이저", intervals: [0, 4, 7] },
  { id: "minor", label: "마이너", intervals: [0, 3, 7] },
  { id: "7", label: "7", intervals: [0, 4, 7, 10] },
  { id: "5", label: "5", intervals: [0, 7] },
  { id: "dim", label: "dim", intervals: [0, 3, 6] },
  { id: "dim7", label: "dim7", intervals: [0, 3, 6, 9] },
  { id: "aug", label: "aug", intervals: [0, 4, 8] },
  { id: "sus2", label: "sus2", intervals: [0, 2, 7] },
  { id: "sus4", label: "sus4", intervals: [0, 5, 7] },
  { id: "maj7", label: "maj7", intervals: [0, 4, 7, 11] },
  { id: "m7", label: "m7", intervals: [0, 3, 7, 10] },
  { id: "7sus4", label: "7sus4", intervals: [0, 5, 7, 10] }
];

const POSITION_OPTIONS: PositionChoice[] = ["all", 1, 2, 3, 4, 5, 6];
const POSITION_ORDER: PositionNo[] = [1, 2, 3, 4, 5, 6];
const POSITION_WINDOWS: Record<PositionNo, { min: number; max: number }> = {
  1: { min: 0, max: 4 },
  2: { min: 3, max: 7 },
  3: { min: 5, max: 9 },
  4: { min: 7, max: 11 },
  5: { min: 9, max: 13 },
  6: { min: 12, max: 17 }
};
const MANUAL_CHORD_STORE_KEY = "guitar_manual_chord_voicings_v1";
const MANUAL_CHORD_MUTE_STORE_KEY = "guitar_manual_chord_mutes_v1";
const MANUAL_CHORD_BARRE_STORE_KEY = "guitar_manual_chord_barres_v1";

function noteAt(stringNumber: StringNo, fret: number): (typeof CHROMATIC)[number] {
  const open = OPEN_NOTE_BY_STRING.get(stringNumber);
  if (!open) {
    throw new Error(`unsupported string number: ${stringNumber}`);
  }
  const startIndex = CHROMATIC.indexOf(open);
  return CHROMATIC[(startIndex + fret) % CHROMATIC.length];
}

function intervalFromRoot(root: (typeof CHROMATIC)[number], note: (typeof CHROMATIC)[number]): number {
  const rootIndex = CHROMATIC.indexOf(root);
  const noteIndex = CHROMATIC.indexOf(note);
  return (noteIndex - rootIndex + CHROMATIC.length) % CHROMATIC.length;
}

function buildManualKey(root: (typeof ROOTS)[number], chordType: ChordType): string {
  return `${root}|${chordType}`;
}

function readManualStore(): ManualChordStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MANUAL_CHORD_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ManualChordStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeManualStore(store: ManualChordStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MANUAL_CHORD_STORE_KEY, JSON.stringify(store));
}

function readMuteStore(): ManualMuteStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MANUAL_CHORD_MUTE_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ManualMuteStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMuteStore(store: ManualMuteStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MANUAL_CHORD_MUTE_STORE_KEY, JSON.stringify(store));
}

function readBarreStore(): ManualBarreStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MANUAL_CHORD_BARRE_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ManualBarreStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBarreStore(store: ManualBarreStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MANUAL_CHORD_BARRE_STORE_KEY, JSON.stringify(store));
}

function isStringNo(value: number): value is StringNo {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

function normalizeManualFrets(value: ManualFretValue | undefined): number[] {
  const source = Array.isArray(value) ? value : typeof value === "number" ? [value] : [];
  return [...new Set(source.filter((fret) => Number.isInteger(fret) && fret >= 0 && fret <= 17))].sort((a, b) => a - b);
}

function normalizeBarreSegments(segments: BarreSegment[] | undefined): BarreSegment[] {
  if (!Array.isArray(segments)) return [];

  const unique = new Set<string>();
  const normalized: BarreSegment[] = [];

  for (const segment of segments) {
    const fret = Number(segment?.fret);
    const from = Number(segment?.fromString);
    const to = Number(segment?.toString);
    if (!Number.isInteger(fret) || fret < 0 || fret > 17) continue;
    if (!isStringNo(from) || !isStringNo(to)) continue;

    const minString = Math.min(from, to) as StringNo;
    const maxString = Math.max(from, to) as StringNo;
    if (minString === maxString) continue;

    const key = `${fret}:${minString}:${maxString}`;
    if (unique.has(key)) continue;
    unique.add(key);
    normalized.push({ fret, fromString: minString, toString: maxString });
  }

  return normalized;
}

function hasManualPositionData(byString: ManualPositionData | undefined): boolean {
  return STRING_ORDER_LOW_TO_HIGH.some((stringNo) => normalizeManualFrets(byString?.[stringNo]).length > 0);
}
function buildCandidatesByString(
  root: (typeof CHROMATIC)[number],
  chordIntervalSet: Set<number>,
  window: { min: number; max: number }
): Record<StringNo, FretCandidate[]> {
  const center = (window.min + window.max) / 2;
  const map = {} as Record<StringNo, FretCandidate[]>;

  for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
    const list: FretCandidate[] = [];
    for (let fret = window.min; fret <= window.max; fret += 1) {
      const interval = intervalFromRoot(root, noteAt(stringNo, fret));
      if (!chordIntervalSet.has(interval)) continue;
      list.push({ fret, interval });
    }

    list.sort((a, b) => {
      const dist = Math.abs(a.fret - center) - Math.abs(b.fret - center);
      if (dist !== 0) return dist;
      return a.fret - b.fret;
    });
    map[stringNo] = list;
  }

  return map;
}

function pruneVoicing(voicing: Partial<Record<StringNo, FretCandidate>>): Partial<Record<StringNo, FretCandidate>> {
  const next = { ...voicing };

  function playedStrings(): StringNo[] {
    return STRING_ORDER_LOW_TO_HIGH.filter((stringNo) => next[stringNo] != null);
  }

  function frettedValues(): number[] {
    return playedStrings()
      .map((stringNo) => next[stringNo]?.fret ?? 0)
      .filter((fret) => fret > 0);
  }

  function intervalCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const stringNo of playedStrings()) {
      const interval = next[stringNo]?.interval;
      if (interval == null) continue;
      counts.set(interval, (counts.get(interval) ?? 0) + 1);
    }
    return counts;
  }

  while (playedStrings().length > 5) {
    const counts = intervalCounts();
    const removable = playedStrings().filter((stringNo) => {
      const interval = next[stringNo]?.interval;
      if (interval == null) return false;
      return (counts.get(interval) ?? 0) > 1;
    });
    const target = removable.at(-1) ?? playedStrings().at(-1);
    if (!target) break;
    delete next[target];
  }

  for (;;) {
    const fretted = frettedValues();
    if (fretted.length <= 1) break;
    const minFret = Math.min(...fretted);
    const maxFret = Math.max(...fretted);
    if (maxFret - minFret <= 4) break;

    const strings = playedStrings();
    const target = strings
      .filter((stringNo) => (next[stringNo]?.fret ?? 0) > 0)
      .sort((a, b) => (next[b]?.fret ?? 0) - (next[a]?.fret ?? 0))[0];
    if (!target) break;
    delete next[target];
    if (playedStrings().length < 3) break;
  }

  return next;
}

function buildPositionVoicing(
  root: (typeof CHROMATIC)[number],
  chordIntervals: number[],
  window: { min: number; max: number },
  positionNo?: PositionNo
): Partial<Record<StringNo, number>> {
  const chordIntervalSet = new Set(chordIntervals);
  const candidatesByString = buildCandidatesByString(root, chordIntervalSet, window);
  const voicing: Partial<Record<StringNo, FretCandidate>> = {};

  for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
    const first = candidatesByString[stringNo][0];
    if (first) voicing[stringNo] = first;
  }

  const requiredIntervals = [...new Set(chordIntervals)];
  const selectedIntervals = () =>
    new Set(
      STRING_ORDER_LOW_TO_HIGH
        .map((stringNo) => voicing[stringNo]?.interval)
        .filter((value): value is number => value != null)
    );

  for (const required of requiredIntervals) {
    if (selectedIntervals().has(required)) continue;

    let bestString: StringNo | null = null;
    let bestCandidate: FretCandidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const center = (window.min + window.max) / 2;

    for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
      const current = voicing[stringNo];
      for (const candidate of candidatesByString[stringNo]) {
        if (candidate.interval !== required) continue;
        const changePenalty = current ? Math.abs(current.fret - candidate.fret) * 1.1 : 0;
        const centerPenalty = Math.abs(candidate.fret - center) * 0.45;
        const score = changePenalty + centerPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestString = stringNo;
          bestCandidate = candidate;
        }
      }
    }

    if (bestString != null && bestCandidate) {
      voicing[bestString] = bestCandidate;
    }
  }

  const pruned = pruneVoicing(voicing);
  const result: Partial<Record<StringNo, number>> = {};
  for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
    const fret = pruned[stringNo]?.fret;
    if (fret != null) result[stringNo] = fret;
  }

  if (positionNo === 1) {
    const hasFirstFret = STRING_ORDER_LOW_TO_HIGH.some((stringNo) => result[stringNo] === 1);
    const hasOpenFret = STRING_ORDER_LOW_TO_HIGH.some((stringNo) => result[stringNo] === 0);

    if (!hasFirstFret && !hasOpenFret) {
      const intervalSet = new Set(chordIntervals);
      const openCandidates = STRING_ORDER_LOW_TO_HIGH.filter((stringNo) => {
        const interval = intervalFromRoot(root, noteAt(stringNo, 0));
        return intervalSet.has(interval);
      });

      if (openCandidates.length > 0) {
        const next = { ...result };
        const targetString = openCandidates.find((stringNo) => next[stringNo] == null) ?? openCandidates[0];
        const playedCount = STRING_ORDER_LOW_TO_HIGH.filter((stringNo) => next[stringNo] != null).length;
        if (playedCount >= 5 && next[targetString] == null) {
          const removeTarget = STRING_ORDER_LOW_TO_HIGH
            .filter((stringNo) => next[stringNo] != null)
            .sort((a, b) => (next[b] ?? 0) - (next[a] ?? 0))[0];
          if (removeTarget != null) {
            delete next[removeTarget];
          }
        }
        next[targetString] = 0;
        return next;
      }
    }
  }

  return result;
}

function mergePositionKeys(voicing: ManualPositionData | Partial<Record<StringNo, number>> | undefined, keys: Set<string>): void {
  if (!voicing) return;
  for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
    const frets = normalizeManualFrets(voicing[stringNo]);
    for (const fret of frets) {
      keys.add(`${stringNo}:${fret}`);
    }
  }
}

function mergeMutedStrings(voicing: ManualMutePositionData | undefined, strings: Set<StringNo>): void {
  if (!voicing) return;
  for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
    const frets = normalizeManualFrets(voicing[stringNo]);
    if (frets.includes(0)) strings.add(stringNo);
  }
}

function buildBarreRoleMap(segments: BarreSegment[]): Map<string, BarreRole> {
  const map = new Map<string, BarreRole>();

  for (const segment of segments) {
    const minString = Math.min(segment.fromString, segment.toString);
    const maxString = Math.max(segment.fromString, segment.toString);

    for (let stringValue = minString; stringValue <= maxString; stringValue += 1) {
      const stringNo = stringValue as StringNo;
      const role: BarreRole =
        stringValue === minString ? "start" : stringValue === maxString ? "end" : "middle";
      map.set(`${stringNo}:${segment.fret}`, role);
    }
  }

  return map;
}

function draftRoleForCell(drag: BarreDragState | null, stringNo: StringNo, fret: number): BarreRole | null {
  if (!drag) return null;
  if (fret !== drag.fret) return null;
  if (drag.startString === drag.currentString) return null;

  const minString = Math.min(drag.startString, drag.currentString);
  const maxString = Math.max(drag.startString, drag.currentString);
  if (stringNo < minString || stringNo > maxString) return null;

  if (stringNo === minString) return "start";
  if (stringNo === maxString) return "end";
  return "middle";
}

function ensureFirstPositionOpenTone(
  positionNo: PositionNo,
  voicing: ManualPositionData | Partial<Record<StringNo, number>> | undefined,
  root: (typeof CHROMATIC)[number],
  chordIntervals: number[]
): ManualPositionData {
  const normalized: ManualPositionData = {};
  for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
    const frets = normalizeManualFrets(voicing?.[stringNo]);
    if (frets.length > 0) {
      normalized[stringNo] = frets;
    }
  }

  if (positionNo !== 1) {
    return normalized;
  }

  const intervalSet = new Set(chordIntervals);
  const openCandidates = STRING_ORDER_LOW_TO_HIGH.filter((stringNo) => {
    const interval = intervalFromRoot(root, noteAt(stringNo, 0));
    return intervalSet.has(interval);
  });
  if (openCandidates.length === 0) {
    return normalized;
  }

  for (const targetString of openCandidates) {
    const targetFrets = normalizeManualFrets(normalized[targetString]);
    const hasFirstOnThisString = targetFrets.includes(1);
    if (!hasFirstOnThisString && !targetFrets.includes(0)) {
      normalized[targetString] = normalizeManualFrets([...targetFrets, 0]);
    }
  }
  return normalized;
}

export function ChordsView() {
  const [root, setRoot] = useState<(typeof ROOTS)[number]>("C");
  const [chordType, setChordType] = useState<ChordType>("major");
  const [position, setPosition] = useState<PositionChoice>("all");
  const [manualStore, setManualStore] = useState<ManualChordStore>(() => readManualStore());
  const [manualMuteStore, setManualMuteStore] = useState<ManualMuteStore>(() => readMuteStore());
  const [manualBarreStore, setManualBarreStore] = useState<ManualBarreStore>(() => readBarreStore());
  const [barreDrag, setBarreDrag] = useState<BarreDragState | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editStatus, setEditStatus] = useState("");

  const barreSuppressClickRef = useRef(false);
  const selectedPosition = position === "all" ? null : position;

  const selectedType = useMemo(
    () => CHORD_TYPE_DEFS.find((item) => item.id === chordType) ?? CHORD_TYPE_DEFS[0],
    [chordType]
  );

  const chordNotes = useMemo(() => {
    const rootIndex = CHROMATIC.indexOf(root);
    return selectedType.intervals.map((interval) => CHROMATIC[(rootIndex + interval) % CHROMATIC.length]);
  }, [root, selectedType]);

  const activeKeys = useMemo(() => {
    const keys = new Set<string>();
    const manualKey = buildManualKey(root, chordType);
    const manualByPosition = manualStore[manualKey] ?? {};
    const positions = position === "all" ? POSITION_ORDER : [position];

    for (const pos of positions) {
      const manualVoicing = manualByPosition[pos];
      if (hasManualPositionData(manualVoicing)) {
        const displayVoicing = ensureFirstPositionOpenTone(pos, manualVoicing, root, selectedType.intervals);
        mergePositionKeys(displayVoicing, keys);
        continue;
      }

      const autoVoicing = buildPositionVoicing(root, selectedType.intervals, POSITION_WINDOWS[pos], pos);
      const displayVoicing = ensureFirstPositionOpenTone(pos, autoVoicing, root, selectedType.intervals);
      mergePositionKeys(displayVoicing, keys);
    }

    return keys;
  }, [position, root, chordType, selectedType, manualStore]);

  const mutedStrings = useMemo(() => {
    const strings = new Set<StringNo>();
    const manualKey = buildManualKey(root, chordType);
    const muteByPosition = manualMuteStore[manualKey] ?? {};
    const positions = position === "all" ? POSITION_ORDER : [position];

    if (position === "all") {
      for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
        const mutedInAllPositions = positions.every((pos) => {
          const frets = normalizeManualFrets(muteByPosition[pos]?.[stringNo]);
          return frets.includes(0);
        });
        if (mutedInAllPositions) {
          strings.add(stringNo);
        }
      }
      return strings;
    }

    for (const pos of positions) {
      mergeMutedStrings(muteByPosition[pos], strings);
    }

    return strings;
  }, [position, root, chordType, manualMuteStore]);

  const barreRoleByKey = useMemo(() => {
    const manualKey = buildManualKey(root, chordType);
    const byPosition = manualBarreStore[manualKey] ?? {};
    const positions = position === "all" ? POSITION_ORDER : [position];

    const segments: BarreSegment[] = [];
    for (const pos of positions) {
      segments.push(...normalizeBarreSegments(byPosition[pos]));
    }

    return buildBarreRoleMap(segments);
  }, [position, root, chordType, manualBarreStore]);

  function isPlayableCell(stringNo: StringNo, fret: number): boolean {
    return activeKeys.has(`${stringNo}:${fret}`) && !mutedStrings.has(stringNo);
  }

  function applyBarreFromDrag(drag: BarreDragState): void {
    setBarreDrag(null);
    if (selectedPosition == null) return;
    if (drag.startString === drag.currentString) return;
    if (!isPlayableCell(drag.startString, drag.fret)) return;
    if (!isPlayableCell(drag.currentString, drag.fret)) return;

    const fromString = Math.min(drag.startString, drag.currentString) as StringNo;
    const toString = Math.max(drag.startString, drag.currentString) as StringNo;
    const key = buildManualKey(root, chordType);
    let added = false;

    setManualBarreStore((prev) => {
      const next: ManualBarreStore = { ...prev };
      const byPosition = { ...(next[key] ?? {}) };
      const current = normalizeBarreSegments(byPosition[selectedPosition]);

      const hitIndex = current.findIndex(
        (segment) =>
          segment.fret === drag.fret &&
          segment.fromString === fromString &&
          segment.toString === toString
      );

      if (hitIndex >= 0) {
        current.splice(hitIndex, 1);
        added = false;
      } else {
        current.push({ fret: drag.fret, fromString, toString });
        added = true;
      }

      if (current.length === 0) {
        delete byPosition[selectedPosition];
      } else {
        byPosition[selectedPosition] = current;
      }

      if (Object.keys(byPosition).length === 0) {
        delete next[key];
      } else {
        next[key] = byPosition;
      }

      writeBarreStore(next);
      return next;
    });

    barreSuppressClickRef.current = true;
    setEditStatus(
      `${selectedPosition}번 포지션 ${drag.fret}프렛 바레 ${added ? "설정" : "해제"} (${fromString}-${toString}번줄)`
    );
  }

  useEffect(() => {
    if (!barreDrag) return;
    const dragSnapshot = barreDrag;

    function handleWindowMouseUp(): void {
      applyBarreFromDrag(dragSnapshot);
    }

    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => window.removeEventListener("mouseup", handleWindowMouseUp);
  }, [barreDrag, selectedPosition, root, chordType, activeKeys, mutedStrings]);

  function handlePositionSelect(next: PositionChoice): void {
    setPosition(next);

    if (next === "all" && editMode) {
      setEditMode(false);
      setBarreDrag(null);
      setEditStatus("포지션 수정 모드 종료 - 1~6 포지션을 선택하면 다시 수정할 수 있습니다.");
      return;
    }

    if (editMode && next !== "all") {
      setEditStatus(`${next}번 포지션 수정 모드`);
    }
  }

  function handleToggleEditMode(): void {
    if (selectedPosition == null) {
      setEditStatus("포지션 수정은 전체가 아닌 1~6 포지션을 선택한 뒤 가능합니다.");
      return;
    }

    setEditMode((prev) => {
      const next = !prev;
      if (!next) {
        setBarreDrag(null);
      }
      setEditStatus(
        next
          ? `${selectedPosition}번 포지션 수정 모드 (좌클릭: 음, 우클릭: 뮤트 X, 드래그: 바레)`
          : "포지션 수정 모드 종료"
      );
      return next;
    });
  }

  function handleClearSelectedPosition(): void {
    if (selectedPosition == null) {
      setEditStatus("초기화할 포지션을 먼저 선택해 주세요.");
      return;
    }

    const key = buildManualKey(root, chordType);
    const targetPosition = selectedPosition;

    setManualStore((prev) => {
      const next: ManualChordStore = { ...prev };
      const byPosition = { ...(next[key] ?? {}) };
      delete byPosition[targetPosition];
      if (Object.keys(byPosition).length === 0) {
        delete next[key];
      } else {
        next[key] = byPosition;
      }
      writeManualStore(next);
      return next;
    });

    setManualMuteStore((prev) => {
      const next: ManualMuteStore = { ...prev };
      const byPosition = { ...(next[key] ?? {}) };
      delete byPosition[targetPosition];
      if (Object.keys(byPosition).length === 0) {
        delete next[key];
      } else {
        next[key] = byPosition;
      }
      writeMuteStore(next);
      return next;
    });

    setManualBarreStore((prev) => {
      const next: ManualBarreStore = { ...prev };
      const byPosition = { ...(next[key] ?? {}) };
      delete byPosition[targetPosition];
      if (Object.keys(byPosition).length === 0) {
        delete next[key];
      } else {
        next[key] = byPosition;
      }
      writeBarreStore(next);
      return next;
    });

    setEditStatus(`${targetPosition}번 포지션 수정 데이터를 초기화했습니다.`);
  }

  function handleFretClick(stringNumber: StringNo, fret: number): void {
    if (!editMode || selectedPosition == null) return;

    if (barreSuppressClickRef.current) {
      barreSuppressClickRef.current = false;
      return;
    }

    const key = buildManualKey(root, chordType);
    const targetPosition = selectedPosition;
    let removed = false;

    setManualStore((prev) => {
      const next: ManualChordStore = { ...prev };
      const byPosition = { ...(next[key] ?? {}) };
      const previousByString = byPosition[targetPosition];
      const byString: ManualPositionData = {};

      if (hasManualPositionData(previousByString)) {
        for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
          const frets = normalizeManualFrets(previousByString?.[stringNo]);
          if (frets.length > 0) {
            byString[stringNo] = frets;
          }
        }
      } else {
        const autoVoicing = buildPositionVoicing(
          root,
          selectedType.intervals,
          POSITION_WINDOWS[targetPosition],
          targetPosition
        );
        for (const stringNo of STRING_ORDER_LOW_TO_HIGH) {
          const autoFret = autoVoicing[stringNo];
          if (autoFret != null) {
            byString[stringNo] = [autoFret];
          }
        }
      }

      const currentFrets = normalizeManualFrets(byString[stringNumber]);
      removed = currentFrets.includes(fret);
      const nextFrets = removed
        ? currentFrets.filter((value) => value !== fret)
        : [...currentFrets, fret].sort((a, b) => a - b);

      if (nextFrets.length === 0) {
        delete byString[stringNumber];
      } else {
        byString[stringNumber] = nextFrets;
      }

      if (!hasManualPositionData(byString)) {
        delete byPosition[targetPosition];
      } else {
        byPosition[targetPosition] = byString;
      }

      if (Object.keys(byPosition).length === 0) {
        delete next[key];
      } else {
        next[key] = byPosition;
      }

      writeManualStore(next);
      return next;
    });

    if (!removed) {
      setManualMuteStore((prev) => {
        const next: ManualMuteStore = { ...prev };
        const byPosition = { ...(next[key] ?? {}) };
        const byString = { ...(byPosition[targetPosition] ?? {}) };
        delete byString[stringNumber];

        if (Object.keys(byString).length === 0) {
          delete byPosition[targetPosition];
        } else {
          byPosition[targetPosition] = byString;
        }

        if (Object.keys(byPosition).length === 0) {
          delete next[key];
        } else {
          next[key] = byPosition;
        }

        writeMuteStore(next);
        return next;
      });
    }

    setEditStatus(`${targetPosition}번 포지션 ${stringNumber}번줄 ${fret}프렛 ${removed ? "해제" : "추가"}`);
  }

  function handleFretContextMenu(event: MouseEvent<HTMLTableCellElement>, stringNumber: StringNo): void {
    if (!editMode || selectedPosition == null) return;
    event.preventDefault();

    const key = buildManualKey(root, chordType);
    const targetPosition = selectedPosition;
    const currentMutes = normalizeManualFrets(manualMuteStore[key]?.[targetPosition]?.[stringNumber]);
    const removed = currentMutes.includes(0);

    setManualMuteStore((prev) => {
      const next: ManualMuteStore = { ...prev };
      const byPosition = { ...(next[key] ?? {}) };
      const byString = { ...(byPosition[targetPosition] ?? {}) };
      if (removed) {
        delete byString[stringNumber];
      } else {
        byString[stringNumber] = [0];
      }

      if (Object.keys(byString).length === 0) {
        delete byPosition[targetPosition];
      } else {
        byPosition[targetPosition] = byString;
      }

      if (Object.keys(byPosition).length === 0) {
        delete next[key];
      } else {
        next[key] = byPosition;
      }

      writeMuteStore(next);
      return next;
    });

    if (!removed) {
      setManualStore((prev) => {
        const next: ManualChordStore = { ...prev };
        const byPosition = { ...(next[key] ?? {}) };
        const byString = { ...(byPosition[targetPosition] ?? {}) };
        delete byString[stringNumber];

        if (Object.keys(byString).length === 0) {
          delete byPosition[targetPosition];
        } else {
          byPosition[targetPosition] = byString;
        }

        if (Object.keys(byPosition).length === 0) {
          delete next[key];
        } else {
          next[key] = byPosition;
        }

        writeManualStore(next);
        return next;
      });

      setManualBarreStore((prev) => {
        const next: ManualBarreStore = { ...prev };
        const byPosition = { ...(next[key] ?? {}) };
        const current = normalizeBarreSegments(byPosition[targetPosition]);
        const filtered = current.filter((segment) => {
          const minString = Math.min(segment.fromString, segment.toString);
          const maxString = Math.max(segment.fromString, segment.toString);
          return stringNumber < minString || stringNumber > maxString;
        });

        if (filtered.length === 0) {
          delete byPosition[targetPosition];
        } else {
          byPosition[targetPosition] = filtered;
        }

        if (Object.keys(byPosition).length === 0) {
          delete next[key];
        } else {
          next[key] = byPosition;
        }

        writeBarreStore(next);
        return next;
      });
    }

    setEditStatus(`${targetPosition}번 포지션 ${stringNumber}번줄 뮤트 ${removed ? "해제" : "설정"} (0프렛 X)`);
  }

  function handleFretMouseDown(event: MouseEvent<HTMLTableCellElement>, stringNumber: StringNo, fret: number): void {
    if (!editMode || selectedPosition == null) return;
    if (event.button !== 0) return;
    if (!isPlayableCell(stringNumber, fret)) return;

    setBarreDrag({ fret, startString: stringNumber, currentString: stringNumber });
  }

  function handleFretMouseEnter(stringNumber: StringNo, fret: number): void {
    setBarreDrag((prev) => {
      if (!prev) return prev;
      if (prev.fret !== fret) return prev;
      if (!isPlayableCell(stringNumber, fret)) return prev;
      if (prev.currentString === stringNumber) return prev;
      return { ...prev, currentString: stringNumber };
    });
  }

  return (
    <section className="card">
      <h2>코드</h2>

      <div className="filter-stack">
        <div className="filter-row">
          <span className="filter-label">루트</span>
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
        </div>

        <div className="filter-row">
          <span className="filter-label">코드 성격</span>
          <div className="option-strip" role="group" aria-label="코드 성격 선택">
            {CHORD_TYPE_DEFS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`option-btn ${chordType === item.id ? "active" : ""}`}
                aria-pressed={chordType === item.id}
                onClick={() => setChordType(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label">포지션</span>
          <div className="position-controls">
            <div className="position-group" role="group" aria-label="포지션 선택">
              {POSITION_OPTIONS.map((item) => (
                <button
                  key={String(item)}
                  type="button"
                  className={`option-btn ${position === item ? "active" : ""}`}
                  aria-pressed={position === item}
                  onClick={() => handlePositionSelect(item)}
                >
                  {item === "all" ? "전체" : item}
                </button>
              ))}
            </div>

            <div className="position-actions">
              <button
                type="button"
                className={`option-btn ${editMode ? "active" : ""}`}
                aria-pressed={editMode}
                onClick={handleToggleEditMode}
                disabled={selectedPosition == null}
              >
                {editMode ? "포지션 수정 종료" : "포지션 수정"}
              </button>
              <button
                type="button"
                className="option-btn"
                onClick={handleClearSelectedPosition}
                disabled={selectedPosition == null}
              >
                현재 포지션 초기화
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="muted">
        {root} {selectedType.label} ({chordNotes.join(" - ")})
      </p>
      {editStatus ? <p className="ok">{editStatus}</p> : null}

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
            {DISPLAY_TUNING.map(({ string: stringNumber }) => {
              const stringMuted = mutedStrings.has(stringNumber);
              return (
                <tr key={stringNumber} className={stringMuted ? "string-muted" : ""}>
                  <td className="string-label">{stringNumber}</td>
                  {FRETS.map((fret) => {
                    const key = `${stringNumber}:${fret}`;
                    const isOpenFret = fret === 0;
                    const note = noteAt(stringNumber, fret);
                    const muted = stringMuted && isOpenFret;
                    const active = !stringMuted && activeKeys.has(key);
                    const isRoot = active && note === root;
                    const marker = muted ? "X" : active ? note : "";
                    const isOpenDisplay = isOpenFret && !muted;
                    const storedBarreRole = stringMuted ? undefined : barreRoleByKey.get(key);
                    const draftBarreRole =
                      editMode && !stringMuted && !storedBarreRole
                        ? draftRoleForCell(barreDrag, stringNumber, fret)
                        : null;
                    const visibleBarreRole = storedBarreRole ?? draftBarreRole;
                    const isDraftBarre = storedBarreRole == null && draftBarreRole != null;

                    return (
                      <td
                        key={key}
                        className={`${isOpenFret ? "open-fret-cell" : ""} ${editMode ? "editable-cell" : ""} ${
                          stringMuted ? "muted-string-cell" : ""
                        } ${visibleBarreRole ? "barre-cell" : ""}`.trim()}
                        onMouseDown={(event) => handleFretMouseDown(event, stringNumber, fret)}
                        onMouseEnter={() => handleFretMouseEnter(stringNumber, fret)}
                        onClick={() => handleFretClick(stringNumber, fret)}
                        onContextMenu={(event) => handleFretContextMenu(event, stringNumber)}
                      >
                        {visibleBarreRole ? (
                          <span className={`barre-mark barre-${visibleBarreRole} ${isDraftBarre ? "barre-draft" : ""}`.trim()} />
                        ) : null}
                        <span
                          className={`note-dot ${isOpenDisplay ? "open" : ""} ${active ? "active" : ""} ${
                            isRoot ? "root" : ""
                          } ${muted ? "mute" : ""}`}
                        >
                          {marker}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

