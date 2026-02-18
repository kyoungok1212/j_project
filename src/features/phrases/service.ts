import type { CreatePhrasePayload } from "./types";

export function buildDefaultPhrase(title: string): CreatePhrasePayload {
  return {
    title,
    musicalKey: "A",
    timeSignature: "4/4",
    bpm: 90,
    content: {
      type: "tab_text",
      value: "e|----------------5-8-5-----|"
    },
    loopStart: 0,
    loopEnd: 8
  };
}

