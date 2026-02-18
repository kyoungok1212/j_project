export interface MetronomePreset {
  id: string;
  name: string;
  bpm: number;
  timeSignature: string;
  subdivision: string;
  accentPattern: number[];
  createdAt: string;
}

export interface MetronomePresetListResponse {
  items: MetronomePreset[];
}

