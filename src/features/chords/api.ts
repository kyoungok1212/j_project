import { apiRequest } from "../../shared/api/http";
import type { Chord, ChordListResponse } from "./types";

export function getChords(root?: string, type?: string): Promise<ChordListResponse> {
  const params = new URLSearchParams();
  if (root) params.set("root", root);
  if (type) params.set("type", type);
  const query = params.toString();
  return apiRequest<ChordListResponse>(`/chords${query ? `?${query}` : ""}`);
}

export function getChord(id: string): Promise<Chord> {
  return apiRequest<Chord>(`/chords/${id}`);
}

