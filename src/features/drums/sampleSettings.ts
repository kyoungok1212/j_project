export const DRUM_SAMPLE_SETTINGS_STORAGE_KEY = "jguitar_drum_sample_settings_v1";
export const DRUM_SAMPLE_SETTINGS_EVENT = "jguitar:drum-sample-settings";

export type DrumSampleSettingsMap = Record<string, string>;

function sanitizeSampleSettings(value: unknown): DrumSampleSettingsMap {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  const next: DrumSampleSettingsMap = {};
  for (const [key, rawValue] of Object.entries(record)) {
    if (!key) {
      continue;
    }
    if (typeof rawValue !== "string") {
      continue;
    }
    const valueText = rawValue.trim();
    if (!valueText) {
      continue;
    }
    next[key] = valueText;
  }
  return next;
}

export function readDrumSampleSettings(): DrumSampleSettingsMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(DRUM_SAMPLE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return sanitizeSampleSettings(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeDrumSampleSettings(nextSettings: DrumSampleSettingsMap): void {
  if (typeof window === "undefined") {
    return;
  }
  const sanitized = sanitizeSampleSettings(nextSettings);
  window.localStorage.setItem(DRUM_SAMPLE_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
  window.dispatchEvent(
    new CustomEvent(DRUM_SAMPLE_SETTINGS_EVENT, {
      detail: {
        samples: sanitized,
        updatedAt: Date.now()
      }
    })
  );
}
