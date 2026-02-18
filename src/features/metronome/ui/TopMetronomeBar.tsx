import { useEffect, useMemo, useRef, useState } from "react";
import { MetronomeEngine } from "../service";
import {
  METRONOME_FORCE_STOP_EVENT,
  METRONOME_SETTINGS_EVENT,
  METRONOME_SUBDIVISION_STEPS,
  METRONOME_VISUAL_EVENT,
  type MetronomeSettings,
  type MetronomeSubdivision,
  emitMetronomeSettings,
  readMetronomeSettings,
  writeMetronomeSettings
} from "../shared";

const BEAT_SLIDER_THUMB_SIZE = 20;
const SUBDIVISION_OPTIONS: Array<{ value: MetronomeSubdivision; label: string }> = [
  { value: "quarter", label: "4분음표" },
  { value: "eighth", label: "8분음표" },
  { value: "sixteenth", label: "16분음표" },
  { value: "triplet", label: "3연음" },
  { value: "sextuplet", label: "6연음" }
];

function normalizeVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

interface TopMetronomeBarProps {
  forceFourBeats?: boolean;
}

export function TopMetronomeBar({ forceFourBeats = false }: TopMetronomeBarProps) {
  const engine = useMemo(() => new MetronomeEngine(), []);
  const initialSettings = useMemo(() => readMetronomeSettings(), []);
  const [bpm, setBpm] = useState(initialSettings.bpm);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [subdivision, setSubdivision] = useState<MetronomeSubdivision>(initialSettings.subdivision);
  const [volume, setVolume] = useState(normalizeVolume(initialSettings.volume));
  const [running, setRunning] = useState(false);
  const [externalVisual, setExternalVisual] = useState<MetronomeSettings | null>(null);
  const [lightIndex, setLightIndex] = useState(0);
  const lightTimerRef = useRef<number | null>(null);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const appliedBpmRef = useRef(bpm);
  const appliedBeatsRef = useRef(beatsPerBar);
  const appliedSubdivisionRef = useRef(subdivision);
  const [sliderLeftPx, setSliderLeftPx] = useState(0);
  const visualSettings = externalVisual?.running ? externalVisual : null;
  const visualBeatsPerBarRaw = Number.parseInt(visualSettings?.timeSignature.split("/")[0] ?? "", 10);
  const visualBeatsPerBar = Number.isFinite(visualBeatsPerBarRaw) && visualBeatsPerBarRaw > 0 ? visualBeatsPerBarRaw : beatsPerBar;
  const visualBpm = visualSettings ? visualSettings.bpm : bpm;
  const volumePercent = Math.round(volume * 100);
  const lightsRunning = running || visualSettings != null;

  useEffect(() => {
    if (forceFourBeats && beatsPerBar !== 4) {
      setBeatsPerBar(4);
    }
  }, [forceFourBeats, beatsPerBar]);

  useEffect(() => {
    function updateSliderBubblePosition(): void {
      const slider = sliderRef.current;
      if (!slider) return;
      const min = Number.parseInt(slider.min, 10) || 1;
      const max = Number.parseInt(slider.max, 10) || 12;
      const value = Number.parseInt(slider.value, 10) || beatsPerBar;
      const range = Math.max(1, max - min);
      const ratio = (value - min) / range;
      const width = slider.getBoundingClientRect().width;
      const left = ratio * Math.max(0, width - BEAT_SLIDER_THUMB_SIZE) + BEAT_SLIDER_THUMB_SIZE / 2;
      setSliderLeftPx(left);
    }

    const rafId = window.requestAnimationFrame(updateSliderBubblePosition);
    window.addEventListener("resize", updateSliderBubblePosition);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updateSliderBubblePosition);
    };
  }, [beatsPerBar]);

  useEffect(() => {
    return () => {
      engine.stop();
      if (lightTimerRef.current != null) {
        window.clearInterval(lightTimerRef.current);
        lightTimerRef.current = null;
      }
    };
  }, [engine]);

  useEffect(() => {
    function handleForceStop(): void {
      engine.stop();
      appliedBpmRef.current = bpm;
      appliedBeatsRef.current = beatsPerBar;
      appliedSubdivisionRef.current = subdivision;
      setRunning(false);
    }

    window.addEventListener(METRONOME_FORCE_STOP_EVENT, handleForceStop);
    return () => window.removeEventListener(METRONOME_FORCE_STOP_EVENT, handleForceStop);
  }, [engine, bpm, beatsPerBar, subdivision]);

  useEffect(() => {
    function handleSettingsEvent(event: Event): void {
      const custom = event as CustomEvent<MetronomeSettings>;
      const detail = custom.detail;
      if (!detail) {
        return;
      }
      setBpm(detail.bpm);
      const beatsRaw = Number.parseInt(detail.timeSignature.split("/")[0], 10);
      const beats = Number.isFinite(beatsRaw) && beatsRaw > 0 ? beatsRaw : 4;
      setBeatsPerBar(forceFourBeats ? 4 : Math.max(1, Math.min(12, beats)));
      setSubdivision(detail.subdivision);
      setVolume(normalizeVolume(detail.volume));
    }

    window.addEventListener(METRONOME_SETTINGS_EVENT, handleSettingsEvent as EventListener);
    return () => window.removeEventListener(METRONOME_SETTINGS_EVENT, handleSettingsEvent as EventListener);
  }, [forceFourBeats]);

  useEffect(() => {
    function handleVisualState(event: Event): void {
      const custom = event as CustomEvent<MetronomeSettings>;
      const detail = custom.detail;
      if (!detail) return;
      if (!detail.running) {
        setExternalVisual(null);
        return;
      }
      setExternalVisual(detail);
      setLightIndex(0);
    }

    window.addEventListener(METRONOME_VISUAL_EVENT, handleVisualState as EventListener);
    return () => window.removeEventListener(METRONOME_VISUAL_EVENT, handleVisualState as EventListener);
  }, []);

  useEffect(() => {
    const settings = { bpm, timeSignature: `${beatsPerBar}/4`, subdivision, volume, running };
    writeMetronomeSettings(settings);
    emitMetronomeSettings(settings);
  }, [bpm, beatsPerBar, subdivision, volume, running]);

  useEffect(() => {
    engine.setVolume(volume);
  }, [engine, volume]);

  useEffect(() => {
    if (!running) return;
    if (
      appliedBpmRef.current === bpm &&
      appliedBeatsRef.current === beatsPerBar &&
      appliedSubdivisionRef.current === subdivision
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      await engine.start(bpm, beatsPerBar, METRONOME_SUBDIVISION_STEPS[subdivision], undefined, volume);
      if (cancelled) return;
      appliedBpmRef.current = bpm;
      appliedBeatsRef.current = beatsPerBar;
      appliedSubdivisionRef.current = subdivision;
      setLightIndex(0);
    })();

    return () => {
      cancelled = true;
    };
  }, [running, bpm, beatsPerBar, subdivision, volume, engine]);

  useEffect(() => {
    if (!lightsRunning) {
      if (lightTimerRef.current != null) {
        window.clearInterval(lightTimerRef.current);
        lightTimerRef.current = null;
      }
      setLightIndex(0);
      return;
    }

    const beatMs = 60000 / Math.max(40, Math.min(240, visualBpm || 90));
    setLightIndex(0);
    if (lightTimerRef.current != null) {
      window.clearInterval(lightTimerRef.current);
    }
    lightTimerRef.current = window.setInterval(() => {
      setLightIndex((prev) => (prev + 1) % visualBeatsPerBar);
    }, beatMs);

    return () => {
      if (lightTimerRef.current != null) {
        window.clearInterval(lightTimerRef.current);
        lightTimerRef.current = null;
      }
    };
  }, [lightsRunning, visualBpm, visualBeatsPerBar]);

  async function toggle() {
    if (running) {
      engine.stop();
      setExternalVisual(null);
      appliedBpmRef.current = bpm;
      appliedBeatsRef.current = beatsPerBar;
      appliedSubdivisionRef.current = subdivision;
      setRunning(false);
      return;
    }
    setExternalVisual(null);
    await engine.start(bpm, beatsPerBar, METRONOME_SUBDIVISION_STEPS[subdivision], undefined, volume);
    appliedBpmRef.current = bpm;
    appliedBeatsRef.current = beatsPerBar;
    appliedSubdivisionRef.current = subdivision;
    setRunning(true);
  }

  return (
    <div className={`metro-bar ${forceFourBeats ? "beat-locked" : ""}`.trim()}>
      <div className="metro-title">
        <span className={`metro-dot ${lightsRunning ? "on" : ""}`} />
        <strong>메트로놈</strong>
      </div>

      <div className="metro-control-grid">
        <label className="metro-field">
          BPM
          <input
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) => setBpm(Number.parseInt(e.target.value, 10) || 40)}
          />
        </label>

        <div className="metro-field metro-play-field">
          재생
          <button
            type="button"
            className={`metro-play-btn ${running ? "running" : ""}`}
            onClick={() => void toggle()}
            aria-label={running ? "메트로놈 정지" : "메트로놈 시작"}
            title={running ? "정지" : "시작"}
          >
            {running ? "■" : "▶"}
          </button>
        </div>

        <label className="metro-field metro-beat-control" htmlFor="metro-beat-select">
          비트 선택
          <select
            id="metro-beat-select"
            value={beatsPerBar}
            onChange={(e) => setBeatsPerBar(Number.parseInt(e.target.value, 10) || 1)}
            aria-label="비트 선택"
            disabled={forceFourBeats}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((beat) => (
              <option key={beat} value={beat}>
                {beat}
              </option>
            ))}
          </select>
        </label>

        <label className="metro-field metro-subdivision-field">
          박자 선택
          <select
            value={subdivision}
            onChange={(e) => setSubdivision(e.target.value as MetronomeSubdivision)}
            aria-label="박자 선택"
          >
            {SUBDIVISION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="metro-beat-slider-row">
        <div className="metro-beat-slider-wrap">
          <input
            ref={sliderRef}
            id="metro-beat-slider"
            className="metro-beat-slider"
            type="range"
            min={1}
            max={12}
            step={1}
            value={beatsPerBar}
            onChange={(e) => setBeatsPerBar(Number.parseInt(e.target.value, 10) || 1)}
            disabled={forceFourBeats}
          />
          <span className="metro-beat-slider-value" style={{ left: `${sliderLeftPx}px` }}>
            {beatsPerBar}
          </span>
        </div>
      </div>

      <div className="metro-lights" aria-label="메트로놈 비트 인디케이터">
        {Array.from({ length: visualBeatsPerBar }, (_, i) => (
          <span key={i} className={`metro-light ${lightsRunning && i === lightIndex ? "on" : ""}`} />
        ))}
      </div>

      <div className="metro-volume-slider-row">
        <label className="metro-slider-label" htmlFor="metro-volume-slider">
          메트로놈 볼륨
        </label>
        <div className="metro-volume-slider-wrap">
          <input
            id="metro-volume-slider"
            className="metro-volume-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            onChange={(e) => setVolume(normalizeVolume((Number.parseInt(e.target.value, 10) || 0) / 100))}
          />
          <span className="metro-volume-slider-value">{volumePercent}%</span>
        </div>
      </div>
    </div>
  );
}
