import { apiRequest } from "../../shared/api/http";
import type { CreatePhrasePayload, PhraseListResponse } from "./types";

export function getPhrases(): Promise<PhraseListResponse> {
  return apiRequest<PhraseListResponse>("/phrases", { requireUser: true });
}

export function createPhrase(payload: CreatePhrasePayload): Promise<{ id: string; version: number }> {
  return apiRequest<{ id: string; version: number }>("/phrases", {
    method: "POST",
    requireUser: true,
    body: JSON.stringify(payload)
  });
}

