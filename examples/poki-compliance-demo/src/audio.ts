// Synthesised sound — no audio files, so nothing to fetch.
//
// Browsers only allow an AudioContext to run after a user gesture, so the context is made
// on the first one. Muting suspends it entirely rather than turning a gain down: a
// suspended context cannot leak a sound through an ad break, whatever schedules one.

export type AudioState = "locked" | "running" | "muted";

export class Sound {
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #muteHolds = 0;

  get state(): AudioState {
    if (!this.#context) return "locked";
    return this.#muteHolds > 0 ? "muted" : "running";
  }

  /** Call from a user gesture. Safe to call more than once. */
  unlock(): void {
    if (this.#context) return;
    const Context =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      this.#context = new Context();
      this.#master = this.#context.createGain();
      this.#master.gain.value = 0.2;
      this.#master.connect(this.#context.destination);
      if (this.#muteHolds > 0) void this.#context.suspend();
    } catch {
      // No audio is better than no game.
      this.#context = null;
    }
  }

  /** Mutes are counted, so an ad and a hidden tab can overlap without unmuting early. */
  mute(): void {
    this.#muteHolds += 1;
    if (this.#muteHolds === 1) void this.#context?.suspend();
  }

  unmute(): void {
    if (this.#muteHolds === 0) return;
    this.#muteHolds -= 1;
    if (this.#muteHolds === 0) void this.#context?.resume();
  }

  blip(frequency: number, durationS = 0.08): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master || this.#muteHolds > 0) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(1, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + durationS);
    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + durationS);
  }
}
