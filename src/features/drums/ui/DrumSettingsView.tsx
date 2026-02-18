import { useEffect, useMemo, useRef, useState } from "react";
import { readDrumSampleSettings, writeDrumSampleSettings } from "../sampleSettings";

const TRACKS = [
  { id: "kick", label: "킥" },
  { id: "snare", label: "스네어" },
  { id: "rimshot", label: "림샷" },
  { id: "sidestick", label: "사이드스틱" },
  { id: "high_tom", label: "하이 탐" },
  { id: "mid_tom", label: "미드 탐" },
  { id: "floor_tom", label: "플로어 탐" },
  { id: "hi_hat_open", label: "하이햇 오픈" },
  { id: "hi_hat_close", label: "하이햇 클로즈" },
  { id: "foot_hi_hat", label: "풋 하이햇" },
  { id: "ride_cymbal", label: "라이드 심벌" },
  { id: "crash_cymbal", label: "크래시 심벌" }
] as const;

type DrumTrackId = (typeof TRACKS)[number]["id"];
type DrumTrackSampleMap = Partial<Record<DrumTrackId, string>>;

interface DrumSampleManifest {
  version?: number;
  source?: string;
  tracks?: Partial<Record<DrumTrackId, DrumSampleOption[]>>;
}

interface DrumSampleOption {
  value: string;
  label: string;
}

function emptySampleOptions(): Record<DrumTrackId, DrumSampleOption[]> {
  return TRACKS.reduce((acc, track) => {
    acc[track.id] = [];
    return acc;
  }, {} as Record<DrumTrackId, DrumSampleOption[]>);
}

function buildDefaultSamples(options: Record<DrumTrackId, DrumSampleOption[]>): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const first = options[track.id]?.[0];
    if (first) {
      acc[track.id] = first.value;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

function normalizeSamplesForOptions(
  samples: DrumTrackSampleMap,
  options: Record<DrumTrackId, DrumSampleOption[]>,
  defaults: DrumTrackSampleMap
): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const choices = options[track.id] ?? [];
    const value = samples[track.id];
    if (typeof value === "string" && value && choices.some((item) => item.value === value)) {
      acc[track.id] = value;
      return acc;
    }
    const fallback = defaults[track.id];
    if (typeof fallback === "string" && fallback && choices.some((item) => item.value === fallback)) {
      acc[track.id] = fallback;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

function mapStorageSamplesToTracks(stored: Record<string, string>): DrumTrackSampleMap {
  return TRACKS.reduce((acc, track) => {
    const value = stored[track.id];
    if (typeof value === "string" && value) {
      acc[track.id] = value;
    }
    return acc;
  }, {} as DrumTrackSampleMap);
}

function toStorageSamples(samples: DrumTrackSampleMap): Record<string, string> {
  const next: Record<string, string> = {};
  for (const track of TRACKS) {
    const value = samples[track.id];
    if (typeof value === "string" && value) {
      next[track.id] = value;
    }
  }
  return next;
}

export function DrumSettingsView() {
  const [sampleOptions, setSampleOptions] = useState<Record<DrumTrackId, DrumSampleOption[]>>(() => emptySampleOptions());
  const [selectedSamples, setSelectedSamples] = useState<DrumTrackSampleMap>({});
  const [sampleLoadError, setSampleLoadError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const sampleBufferRef = useRef<Partial<Record<DrumTrackId, AudioBuffer>>>({});
  const sampleBufferUrlRef = useRef<Partial<Record<DrumTrackId, string>>>({});
  const sampleLoadPromiseRef = useRef<Record<string, Promise<AudioBuffer | null>>>({});
  const defaultSamples = useMemo(() => buildDefaultSamples(sampleOptions), [sampleOptions]);
  const normalizedSelectedSamples = useMemo(
    () => normalizeSamplesForOptions(selectedSamples, sampleOptions, defaultSamples),
    [selectedSamples, sampleOptions, defaultSamples]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadManifest(): Promise<void> {
      try {
        const response = await fetch("/real-drum/manifest.json");
        if (!response.ok) {
          throw new Error(`샘플 목록 로드 실패 (${response.status})`);
        }
        const parsed = (await response.json()) as DrumSampleManifest;
        if (!parsed || typeof parsed !== "object" || !parsed.tracks || typeof parsed.tracks !== "object") {
          throw new Error("샘플 목록 형식이 올바르지 않습니다.");
        }
        if (cancelled) {
          return;
        }

        const nextOptions = emptySampleOptions();
        const tracksRecord = parsed.tracks as Record<string, unknown>;
        for (const track of TRACKS) {
          const rawOptions = tracksRecord[track.id];
          if (!Array.isArray(rawOptions)) {
            continue;
          }
          nextOptions[track.id] = rawOptions
            .map((option, index) => {
              if (!option || typeof option !== "object") {
                return null;
              }
              const record = option as Record<string, unknown>;
              const value = typeof record.value === "string" ? record.value : "";
              if (!value) {
                return null;
              }
              const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : `${track.label} ${index + 1}`;
              return { value, label };
            })
            .filter((option): option is DrumSampleOption => option != null);
        }

        const defaults = buildDefaultSamples(nextOptions);
        const storedSamples = mapStorageSamplesToTracks(readDrumSampleSettings());
        const normalized = normalizeSamplesForOptions(storedSamples, nextOptions, defaults);

        setSampleOptions(nextOptions);
        setSelectedSamples(normalized);
        writeDrumSampleSettings(toStorageSamples(normalized));
      } catch (err) {
        if (!cancelled) {
          setSampleLoadError(err instanceof Error ? err.message : "샘플 목록 로드 실패");
        }
      }
    }

    void loadManifest();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToastMessage("");
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toastMessage]);

  function getAudioContext(): AudioContext {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }

  async function ensureTrackSampleBuffer(trackId: DrumTrackId, sampleUrl: string): Promise<AudioBuffer | null> {
    const existing = sampleBufferRef.current[trackId];
    if (existing && sampleBufferUrlRef.current[trackId] === sampleUrl) {
      return existing;
    }

    const key = `${trackId}::${sampleUrl}`;
    const inFlight = sampleLoadPromiseRef.current[key];
    if (inFlight) {
      return inFlight;
    }

    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const ctx = getAudioContext();
        const response = await fetch(sampleUrl);
        if (!response.ok) {
          throw new Error(`${trackId} sample load failed (${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        sampleBufferRef.current = {
          ...sampleBufferRef.current,
          [trackId]: decoded
        };
        sampleBufferUrlRef.current = {
          ...sampleBufferUrlRef.current,
          [trackId]: sampleUrl
        };
        return decoded;
      } catch {
        return null;
      } finally {
        delete sampleLoadPromiseRef.current[key];
      }
    })();

    sampleLoadPromiseRef.current[key] = promise;
    return promise;
  }

  function triggerFallback(trackId: DrumTrackId): void {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const frequencyMap: Record<DrumTrackId, number> = {
      kick: 92,
      snare: 220,
      rimshot: 340,
      sidestick: 420,
      high_tom: 210,
      mid_tom: 160,
      floor_tom: 126,
      hi_hat_open: 760,
      hi_hat_close: 920,
      foot_hi_hat: 640,
      ride_cymbal: 960,
      crash_cymbal: 740
    };
    osc.type = "triangle";
    osc.frequency.setValueAtTime(frequencyMap[trackId], now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  async function previewTrack(trackId: DrumTrackId): Promise<void> {
    const sampleUrl = normalizedSelectedSamples[trackId] ?? "";
    if (!sampleUrl) {
      triggerFallback(trackId);
      return;
    }
    const loaded = await ensureTrackSampleBuffer(trackId, sampleUrl);
    if (!loaded) {
      setToastMessage(`${TRACKS.find((track) => track.id === trackId)?.label ?? trackId} 샘플 로드 실패`);
      return;
    }
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = loaded;
    gain.gain.value = 0.9;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(ctx.currentTime);
  }

  function handleSampleChange(trackId: DrumTrackId, sampleUrl: string): void {
    setSelectedSamples((prev) => {
      const next = normalizeSamplesForOptions(
        {
          ...prev,
          [trackId]: sampleUrl
        },
        sampleOptions,
        defaultSamples
      );
      writeDrumSampleSettings(toStorageSamples(next));
      return next;
    });
    setToastMessage("드럼 설정이 저장되었습니다.");
  }

  return (
    <section className="card">
      <h2>드럼 설정</h2>
      <p className="muted">트랙별 샘플을 설정하면 드럼 머신과 악보만들기에 동일하게 적용됩니다.</p>
      {sampleLoadError ? <p className="error">{sampleLoadError}</p> : null}

      <div className="drum-settings-list">
        {TRACKS.map((track) => (
          <div key={track.id} className="drum-settings-row">
            <span className="drum-settings-track">{track.label}</span>
            <select
              className="drum-settings-select"
              value={normalizedSelectedSamples[track.id] ?? ""}
              onChange={(event) => handleSampleChange(track.id, event.target.value)}
              disabled={sampleOptions[track.id].length === 0}
            >
              {sampleOptions[track.id].length === 0 ? <option value="">샘플 없음</option> : null}
              {sampleOptions[track.id].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="drum-settings-preview-btn"
              onClick={() => void previewTrack(track.id)}
              aria-label={`${track.label} 샘플 미리듣기`}
            >
              ▶
            </button>
          </div>
        ))}
      </div>

      {toastMessage ? (
        <div className="sheet-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
    </section>
  );
}
