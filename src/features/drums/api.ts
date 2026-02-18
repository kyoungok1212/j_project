import { apiRequest } from "../../shared/api/http";

export interface DrumSheetPayload {
  id: string;
  title: string;
  bpm: number;
  timeSignature: string;
  stepsPerBar: number;
  totalBars: number;
  pattern: unknown;
  noteLengthOverrides: unknown;
  selectedSamples: unknown;
  updatedAt: number;
}

export interface DrumSheetListResponse {
  items: DrumSheetPayload[];
}

export interface DrumSheetRevisionSummary {
  revision: number;
  title: string;
  bpm: number;
  timeSignature: string;
  stepsPerBar: number;
  totalBars: number;
  sourceUpdatedAt: number;
  savedAt: number;
}

export interface DrumSheetRevisionListResponse {
  id: string;
  items: DrumSheetRevisionSummary[];
}

export function getDrumSheets(): Promise<DrumSheetListResponse> {
  return apiRequest<DrumSheetListResponse>("/drum-sheets", { requireUser: true });
}

export function upsertDrumSheet(sheet: DrumSheetPayload): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`/drum-sheets/${sheet.id}`, {
    method: "PUT",
    requireUser: true,
    body: JSON.stringify(sheet)
  });
}

export function getDrumSheetRevisions(sheetId: string): Promise<DrumSheetRevisionListResponse> {
  return apiRequest<DrumSheetRevisionListResponse>(`/drum-sheets/${sheetId}/revisions`, { requireUser: true });
}

export function restoreDrumSheetRevision(sheetId: string, revision: number): Promise<{ id: string; restoredFromRevision: number }> {
  return apiRequest<{ id: string; restoredFromRevision: number }>(`/drum-sheets/${sheetId}/revisions/${revision}/restore`, {
    method: "POST",
    requireUser: true
  });
}
