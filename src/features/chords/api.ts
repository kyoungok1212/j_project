import { apiRequest } from "../../shared/api/http";
import type { Chord, ChordListResponse, ChordManualState } from "./types";

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

export function getChordManualState(): Promise<ChordManualState> {
  return apiRequest<ChordManualState>("/chords/state", { requireUser: true });
}

export function upsertChordManualState(payload: ChordManualState): Promise<{ saved: true }> {
  return apiRequest<{ saved: true }>("/chords/state", {
    method: "PUT",
    requireUser: true,
    body: JSON.stringify(payload)
  });
}
