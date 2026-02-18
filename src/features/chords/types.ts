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

