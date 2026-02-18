import { apiRequest } from "../../shared/api/http";
import type { PracticeSessionListResponse, ProgressSummary } from "./types";

export function createPracticeSession(payload: {
  category: string;
  targetType: string;
  targetId?: string;
  bpm: number;
  durationSec: number;
  result: string;
}) {
  return apiRequest<{ id: string }>("/progress/sessions", {
    method: "POST",
    requireUser: true,
    idempotencyKey: `local-${Date.now().toString(36)}`,
    body: JSON.stringify(payload)
  });
}

export function getPracticeSessions(): Promise<PracticeSessionListResponse> {
  return apiRequest<PracticeSessionListResponse>("/progress/sessions", {
    requireUser: true
  });
}

export function getProgressSummary(period: "week" | "month"): Promise<ProgressSummary> {
  const date = new Date().toISOString().slice(0, 10);
  return apiRequest<ProgressSummary>(`/progress/summary?period=${period}&date=${date}`, {
    requireUser: true
  });
}

