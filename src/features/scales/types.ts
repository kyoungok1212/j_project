export interface ScalePatternPosition {
  position: number;
  notes: string[];
  fretPositions: Array<{ string: number; frets: number[] }>;
}

export interface Scale {
  id: string;
  name: string;
  mode: string;
  root: string;
  patternPositions: ScalePatternPosition[];
}

export interface ScaleListResponse {
  items: Scale[];
}

export interface ScalePatternResponse {
  root: string;
  mode: string;
  system: "caged" | "3nps";
  position: number;
  notes: string[];
  tuning: Array<{ string: number; openNote: string }>;
  fretPositions: Array<{ string: number; frets: number[] }>;
}

export type ScaleManualStore = Record<string, Partial<Record<number, Partial<Record<number, number[]>>>>>;

export interface ScaleManualState {
  patterns: ScaleManualStore;
}
