export interface Chord {
  id: string;
  name: string;
  root: string;
  type: string;
  tones: string[];
  fingering: Array<number | null>;
}

export interface ChordListResponse {
  items: Chord[];
}

export type ChordManualVoicingStore = Record<string, Partial<Record<number, Partial<Record<number, number | number[]>>>>>;
export type ChordManualMuteStore = Record<string, Partial<Record<number, Partial<Record<number, number[]>>>>>;
export type ChordManualBarreStore = Record<
  string,
  Partial<Record<number, Array<{ fret: number; fromString: number; toString: number }>>>
>;

export interface ChordManualState {
  voicings: ChordManualVoicingStore;
  mutes: ChordManualMuteStore;
  barres: ChordManualBarreStore;
}
