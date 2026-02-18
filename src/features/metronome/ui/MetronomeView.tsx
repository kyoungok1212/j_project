import { useEffect, useMemo, useState } from "react";
import { MetronomeEngine } from "../service";

export function MetronomeView() {
  const engine = useMemo(() => new MetronomeEngine(), []);
  const [bpm, setBpm] = useState(90);
  const [timeSignature, setTimeSignature] = useState("4/4");
  const [running, setRunning] = useState(false);
  const beatsPerBar = Number.parseInt(timeSignature.split("/")[0], 10);

  useEffect(() => {
    return () => engine.stop();
  }, [engine]);

  async function toggle() {
    if (running) {
      engine.stop();
      setRunning(false);
      return;
    }
    await engine.start(bpm, beatsPerBar);
    setRunning(true);
  }

  return (
    <section className="card">
      <h2>Metronome</h2>
      <div className="row">
        <label>
          BPM
          <input
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) => setBpm(Number.parseInt(e.target.value, 10) || 40)}
          />
        </label>
        <label>
          Time
          <select value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)}>
            <option value="4/4">4/4</option>
            <option value="3/4">3/4</option>
            <option value="6/8">6/8</option>
          </select>
        </label>
        <button onClick={toggle}>{running ? "Stop" : "Start"}</button>
      </div>
      <p className="muted">AudioContext clock scheduling with lookahead window.</p>
    </section>
  );
}

