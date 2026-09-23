// Synthesised audio with reason-counted muting.
//
// Muting counts reasons for the same reason pausing does: the portal's `muteAudio` setting
// and an ad break are independent, and an ad ending must not unmute a player who muted the
// site. The portal's setting has priority over any in-game toggle.
//
// The AudioContext is created and resumed only from a user gesture. iOS interrupts audio on
// backgrounding and only lets it resume from a touchend or click, which CrazyGames calls out
// in its technical requirements.

export type MuteReason = "ad" | "platform";

export class Audio {
  readonly #reasons = new Set<MuteReason>();
  #context: AudioContext | null = null;
  #master: GainNode | null = null;

  constructor() {
    const unlock = (): void => this.#unlock();
    for (const type of ["pointerdown", "touchend", "click", "keydown"]) {
      document.addEventListener(type, unlock, { passive: true });
    }
  }

  get muted(): boolean {
    return this.#reasons.size > 0;
  }

  /** The master gain actually applied. Read by the tests; 0 means nothing can be heard. */
  get gain(): number {
    return this.#master?.gain.value ?? 0;
  }

  get contextState(): AudioContextState | "none" {
    return this.#context?.state ?? "none";
  }

  mute(reason: MuteReason): void {
    this.#reasons.add(reason);
    this.#apply();
  }

  unmute(reason: MuteReason): void {
    this.#reasons.delete(reason);
    this.#apply();
  }

  /** A short blip. Silent until the first gesture unlocks audio, and while muted. */
  blip(frequency: number, durationS = 0.08): void {
    const context = this.#context;
    const master = this.#master;
    if (!context || !master || this.muted || context.state !== "running") return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.25, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, context.currentTime + durationS);
    oscillator.connect(envelope).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + durationS);
  }

  #unlock(): void {
    if (!this.#context) {
      const Context = globalThis.AudioContext as typeof AudioContext | undefined;
      if (!Context) return;
      this.#context = new Context();
      this.#master = this.#context.createGain();
      this.#master.connect(this.#context.destination);
      this.#apply();
    }
    if (this.#context.state !== "running") void this.#context.resume().catch(() => {});
  }

  #apply(): void {
    if (this.#master) this.#master.gain.value = this.muted ? 0 : 0.6;
  }
}
