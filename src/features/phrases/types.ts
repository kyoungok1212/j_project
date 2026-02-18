export interface Phrase {
  id: string;
  userId: string;
  title: string;
  musicalKey: string;
  timeSignature: string;
  bpm: number;
  content: unknown;
  loopStart: number;
  loopEnd: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PhraseListResponse {
  items: Phrase[];
}

export interface CreatePhrasePayload {
  title: string;
  musicalKey: string;
  timeSignature: string;
  bpm: number;
  content: unknown;
  loopStart: number;
  loopEnd: number;
}

