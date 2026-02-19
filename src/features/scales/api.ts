import { apiRequest } from "../../shared/api/http";
import type { ScaleListResponse, ScalePatternResponse, ScaleManualState } from "./types";

export function getScales(root?: string, mode?: string): Promise<ScaleListResponse> {
  const params = new URLSearchParams();
  if (root) params.set("root", root);
  if (mode) params.set("mode", mode);
  const query = params.toString();
  return apiRequest<ScaleListResponse>(`/scales${query ? `?${query}` : ""}`);
}

export function getScalePattern(
  root: string,
  mode: string,
  position: number,
  system: "caged" | "3nps"
): Promise<ScalePatternResponse> {
  const params = new URLSearchParams({
    root,
    mode,
    position: String(position),
    system
  });
  return apiRequest<ScalePatternResponse>(`/scales/pattern?${params.toString()}`);
}

export function getScaleManualState(): Promise<ScaleManualState> {
  return apiRequest<ScaleManualState>("/scales/state", { requireUser: true });
}

export function upsertScaleManualState(payload: ScaleManualState): Promise<{ saved: true }> {
  return apiRequest<{ saved: true }>("/scales/state", {
    method: "PUT",
    requireUser: true,
    body: JSON.stringify(payload)
  });
}
