import { apiRequest } from "../../shared/api/http";
import type { MetronomePresetListResponse } from "./types";

export function getMetronomePresets(): Promise<MetronomePresetListResponse> {
  return apiRequest<MetronomePresetListResponse>("/metronome/presets", { requireUser: true });
}
