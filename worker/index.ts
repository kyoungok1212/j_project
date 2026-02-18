import { options, fail } from "./lib/http";
import { makeRequestId } from "./lib/utils";
import { handleChords } from "./routes/chords";
import { handleScales } from "./routes/scales";
import { handleMetronome } from "./routes/metronome";
import { handlePhrases } from "./routes/phrases";
import { handleProgress } from "./routes/progress";
import { handleDrumSheets } from "./routes/drumSheets";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return options();
    }

    const requestId = makeRequestId();
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] !== "api" || segments[1] !== "v1") {
      return fail(requestId, "NOT_FOUND", "route not found", 404);
    }

    const feature = segments[2];
    const pathParts = segments.slice(3);

    try {
      switch (feature) {
        case "chords":
          return await handleChords(request, env, requestId, pathParts);
        case "scales":
          return await handleScales(request, env, requestId, pathParts);
        case "metronome":
          return await handleMetronome(request, env, requestId, pathParts);
        case "phrases":
          return await handlePhrases(request, env, requestId, pathParts);
        case "progress":
          return await handleProgress(request, env, requestId, pathParts);
        case "drum-sheets":
          return await handleDrumSheets(request, env, requestId, pathParts);
        default:
          return fail(requestId, "NOT_FOUND", "route not found", 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return fail(requestId, "INTERNAL_ERROR", message, 500);
    }
  }
};
