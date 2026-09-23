// Sound, generated rather than loaded: a few oscillator blips and a quiet pad.
//
// Synthesised so the demo ships no audio files and makes no requests for them, and so that
// "is sound playing" has one clear answer: the AudioContext is running or it is not. That
// is the state requirements 1.3 (focus loss) and 4.7 (ads) are about, and it is what the
// e2e suite reads.
//
// The context is created on the first user gesture — browsers refuse to start audio before
// one — and is suspended whenever the app says sound is not allowed.

export type Cue = "catch" | "miss" | "over";

export class Sound {
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #pad: OscillatorNode | null = null;
  #allowed = false;
  #enabled = true;
  #padWanted = false;

  /** Call from a user gesture. Safe to call again. */
  unlock(): void {
    if (this.#context) return;
    const Context =
      globalThis.AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      this.#context = new Context();
      this.#master = this.#context.createGain();
      this.#master.gain.value = 0.25;
      this.#master.connect(this.#context.destination);
    } catch {
      this.#context = null;
      return;
    }
    this.#apply();
  }

  /** "running" | "suspended" | "closed" | "none". Read by the e2e suite. */
  get state(): string {
    return this.#context?.state ?? "none";
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** The player's own switch (recommendation 6.2). */
  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#apply();
  }

  /** Whether the app currently permits sound at all: not paused, not in an ad, in focus. */
  setAllowed(allowed: boolean): void {
    this.#allowed = allowed;
    this.#apply();
  }

  /** The background pad, wanted during a run. */
  setPad(wanted: boolean): void {
    this.#padWanted = wanted;
    this.#apply();
  }

  play(cue: Cue): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master || context.state !== "running") return;
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    const [from, to, length] =
      cue === "catch" ? [660, 990, 0.12] : cue === "miss" ? [220, 140, 0.2] : [392, 196, 0.6];
    osc.type = cue === "catch" ? "triangle" : "sine";
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + length);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + length);
  }

  #apply(): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master) return;
    const audible = this.#allowed && this.#enabled;

    if (this.#padWanted && !this.#pad) {
      const pad = context.createOscillator();
      const padGain = context.createGain();
      pad.type = "sine";
      pad.frequency.value = 110;
      padGain.gain.value = 0.05;
      pad.connect(padGain).connect(master);
      pad.start();
      this.#pad = pad;
    } else if (!this.#padWanted && this.#pad) {
      this.#pad.stop();
      this.#pad.disconnect();
      this.#pad = null;
    }

    // Suspending the context, not just zeroing a gain, is what actually stops output — and
    // it stops the clock, so nothing scheduled fires into the silence.
    if (audible && context.state === "suspended") void context.resume().catch(() => undefined);
    if (!audible && context.state === "running") void context.suspend().catch(() => undefined);
  }
}
