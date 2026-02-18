export class MetronomeEngine {
  private context: AudioContext | null = null;
  private timerId: number | null = null;
  private nextTickTime = 0;
  private tickStep = 0;
  private volume = 1;

  async start(
    bpm: number,
    beatsPerBar: number,
    subdivisionsPerBeat = 1,
    startAtTime?: number,
    volume = 1
  ): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.setVolume(volume);
    this.stop();
    const safeBpm = Number.isFinite(bpm) ? Math.max(40, Math.min(240, bpm)) : 90;
    const safeBeatsPerBar = Number.isFinite(beatsPerBar) ? Math.max(1, Math.min(12, Math.round(beatsPerBar))) : 4;
    const safeSubdivisions = Number.isFinite(subdivisionsPerBeat)
      ? Math.max(1, Math.min(12, Math.round(subdivisionsPerBeat)))
      : 1;

    this.tickStep = 0;
    const safeStartAt =
      Number.isFinite(startAtTime) && typeof startAtTime === "number"
        ? Math.max(this.context.currentTime, startAtTime)
        : this.context.currentTime;
    this.nextTickTime = safeStartAt;
    const secondsPerTick = 60 / safeBpm / safeSubdivisions;

    this.timerId = window.setInterval(() => {
      if (!this.context) return;
      while (this.nextTickTime < this.context.currentTime + 0.1) {
        const tickInBeat = this.tickStep % safeSubdivisions;
        const beatInBar = Math.floor(this.tickStep / safeSubdivisions) % safeBeatsPerBar;
        const isBeatStart = tickInBeat === 0;
        const tickType = isBeatStart ? (beatInBar === 0 ? "bar" : "beat") : "sub";

        this.scheduleTick(this.nextTickTime, tickType);
        this.nextTickTime += secondsPerTick;
        this.tickStep += 1;
      }
    }, 25);
  }

  stop(): void {
    if (this.timerId != null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
      this.volume = 1;
      return;
    }
    this.volume = Math.max(0, Math.min(1, volume));
  }

  private scheduleTick(time: number, tickType: "bar" | "beat" | "sub"): void {
    if (!this.context) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    let frequency = 900;
    let peakGain = 0.17;
    let releaseTime = 0.05;

    if (tickType === "bar") {
      frequency = 1240;
      peakGain = 0.24;
      releaseTime = 0.06;
    } else if (tickType === "sub") {
      frequency = 760;
      peakGain = 0.11;
      releaseTime = 0.036;
    }

    osc.frequency.value = frequency;
    const scaledPeak = Math.max(0.0001, peakGain * this.volume);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(scaledPeak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + releaseTime);
    osc.connect(gain);
    gain.connect(this.context.destination);
    osc.start(time);
    osc.stop(time + releaseTime + 0.01);
  }
}
