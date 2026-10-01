// The game's audio: music and sound effects from the runtime asset manifest, mixed.
//
// GOLDEN-RUN REPLAY. Written into this repository by the Factory's golden-run replay
// developer (scripts/golden/replay_developer.py); not agent-written code. Shared by both
// reference ports. Every sound is a production asset listed in public/assets/assets.json
// (type `music` or `sfx`); nothing is synthesized here. The rules it keeps:
//
//   - Nothing plays before the player's first input (the browser's autoplay policy, and the
//     portals'): the context is created suspended, files load and decode in the background
//     after boot, and `unlock()` - called on the first input - resumes it.
//   - Silent whenever the platform says so (an ad, a portal mute setting, a hidden tab), the
//     game is paused, or the player's own toggle is off: the master gain ramps to zero and
//     the context is suspended, so the music resumes exactly where it was.
//   - Music crossfades between tracks (title -> play), may carry layers that start in
//     lock-step with it and fade with the game's intensity, and ducks under stings.
//   - One-shots are mixed below stings, vary a little in pitch, and are voice-limited.
//   - `probe()` reports what is playing and the master output's measured RMS (an
//     AnalyserNode after every gain), for the play probe's `audio` field.

const MANIFEST = "assets/assets.json";
const MUTE_RAMP_S = 0.06;
const MAX_VOICES = 4;

interface Entry {
  readonly type: string;
  readonly url?: string;
  readonly placeholder?: boolean;
}

export interface PlayOptions {
  /** Playback rate: 2 is an octave up. */
  readonly rate?: number;
  /** Linear gain on top of the cue's mix level. */
  readonly gain?: number;
  /** -1 (left) .. 1 (right). */
  readonly pan?: number;
  /** Random pitch spread, in cents either side. */
  readonly vary?: number;
  /** Seconds from now. */
  readonly delay?: number;
}

export interface MusicOptions {
  /** Crossfade length, seconds. */
  readonly fade?: number;
  /** Tracks started in lock-step with the main one, each at its own gain (0 by default). */
  readonly layers?: readonly string[];
}

export interface LoopHandle {
  setRate(rate: number): void;
  setGain(gain: number): void;
  setFilter(hz: number): void;
  setPan(pan: number): void;
  stop(fade?: number): void;
}

export interface AudioProbe {
  readonly music: string | null;
  readonly playing: boolean;
  readonly level: number;
  readonly muted: boolean;
}

interface Track {
  readonly id: string;
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  readonly sources: AudioBufferSourceNode[];
  readonly layers: Map<string, GainNode>;
}

/** Mix levels per cue id (linear), below the sfx bus; anything unlisted plays at 0.8. */
export type Mix = Readonly<Record<string, number>>;

export class Audio {
  readonly #mix: Mix;
  readonly #ctx: AudioContext | null;
  readonly #master: GainNode | null = null;
  readonly #musicBus: GainNode | null = null;
  readonly #duckBus: GainNode | null = null;
  readonly #sfxBus: GainNode | null = null;
  readonly #analyser: AnalyserNode | null = null;
  readonly #samples: Float32Array<ArrayBuffer> = new Float32Array(2048);
  readonly #buffers = new Map<string, AudioBuffer>();
  readonly #loading = new Map<string, Promise<AudioBuffer | null>>();
  readonly #voices = new Map<string, AudioBufferSourceNode[]>();
  #entries: Record<string, Entry> = {};
  #manifestUrl = "";
  #track: Track | null = null;
  #wanted: { id: string; options: MusicOptions } | null = null;
  #unlocked = false;
  #platformMuted = false;
  #paused = false;
  #userMuted = false;
  #suspendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: { readonly mix?: Mix; readonly music?: number } = {}) {
    this.#mix = options.mix ?? {};
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
    } catch {
      ctx = null; // no audio device: the game plays muted, every cue has a visual twin
    }
    this.#ctx = ctx;
    if (!ctx) return;
    this.#master = ctx.createGain();
    this.#master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.#analyser = ctx.createAnalyser();
    this.#analyser.fftSize = this.#samples.length;
    this.#master.connect(limiter).connect(this.#analyser).connect(ctx.destination);
    this.#musicBus = ctx.createGain();
    this.#musicBus.gain.value = options.music ?? 0.5;
    this.#duckBus = ctx.createGain();
    this.#musicBus.connect(this.#duckBus).connect(this.#master);
    this.#sfxBus = ctx.createGain();
    this.#sfxBus.connect(this.#master);
  }

  /**
   * Read the runtime manifest and fetch + decode every music and sfx asset in it, `first`
   * ids before the rest. Never blocks the game: call it after the first frame and do not
   * wait. A build with no manifest (a greybox) has no sound.
   */
  async load(first: readonly string[] = []): Promise<void> {
    if (!this.#ctx) return;
    try {
      this.#manifestUrl = new URL(MANIFEST, document.baseURI).href;
      const response = await fetch(this.#manifestUrl);
      if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return;
      const manifest = (await response.json()) as { assets?: Record<string, Entry> };
      this.#entries = manifest.assets ?? {};
    } catch {
      return;
    }
    const ids = Object.keys(this.#entries).filter((id) => this.#isAudio(id));
    const ordered = [
      ...first.filter((id) => ids.includes(id)),
      ...ids.filter((id) => !first.includes(id)),
    ];
    for (const id of ordered) await this.#buffer(id);
  }

  /** Ids of the audio assets decoded so far (the play probe's assets_loaded). */
  get loaded(): string[] {
    return [...this.#buffers.keys()].sort();
  }

  /** The first player input: sound may start. */
  unlock(): void {
    if (this.#unlocked) return;
    this.#unlocked = true;
    this.#apply();
  }

  /** The platform's say: an ad is playing, the portal's mute setting, a hidden tab. */
  setPlatformMuted(muted: boolean): void {
    this.#platformMuted = muted;
    this.#apply();
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
    this.#apply();
  }

  /** The player's own sound toggle, beside the platform's say. */
  setUserMuted(muted: boolean): void {
    this.#userMuted = muted;
    this.#apply();
  }

  get userMuted(): boolean {
    return this.#userMuted;
  }

  get audible(): boolean {
    return this.#unlocked && !this.#platformMuted && !this.#paused && !this.#userMuted;
  }

  /**
   * Make `id` the music, crossfading from whatever plays now; null fades music out. Asked
   * for before the first input or before the file decodes, it starts as soon as it can.
   */
  music(id: string | null, options: MusicOptions = {}): void {
    if (id === null) {
      this.#wanted = null;
      this.#fadeOut(this.#track, options.fade ?? 1);
      this.#track = null;
      return;
    }
    if (this.#track?.id === id || (this.#wanted?.id === id && !this.#track)) return;
    this.#wanted = { id, options };
    void this.#startWanted();
  }

  /** The gain of one of the current music's layers, 0..1, smoothed over `seconds`. */
  setLayer(id: string, gain: number, seconds = 0.6): void {
    const node = this.#track?.layers.get(id);
    if (!node || !this.#ctx) return;
    node.gain.setTargetAtTime(Math.max(0, Math.min(1, gain)), this.#ctx.currentTime, seconds / 3);
  }

  /** A low-pass over the current music (not its layers), Hz; 20000 is open. */
  setMusicFilter(hz: number, seconds = 0.4): void {
    if (!this.#track || !this.#ctx) return;
    this.#track.filter.frequency.setTargetAtTime(hz, this.#ctx.currentTime, seconds / 3);
  }

  /** Pull the music down to `level` for `hold` seconds, then back (a sting on top of it). */
  duck(level = 0.3, hold = 1.2): void {
    if (!this.#ctx || !this.#duckBus) return;
    const g = this.#duckBus.gain;
    const now = this.#ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(level, now, 0.03);
    g.setTargetAtTime(1, now + hold, 0.25);
  }

  /** A one-shot. Silent until unlocked, while muted, or before the file decodes. */
  play(id: string, options: PlayOptions = {}): void {
    const ctx = this.#ctx;
    const buffer = this.#buffers.get(id);
    if (!ctx || !buffer || !this.audible || !this.#sfxBus) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const cents = options.vary ? (Math.random() * 2 - 1) * options.vary : 0;
    source.playbackRate.value = (options.rate ?? 1) * Math.pow(2, cents / 1200);
    const gain = ctx.createGain();
    gain.gain.value = (this.#mix[id] ?? 0.8) * (options.gain ?? 1);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
    source.connect(gain).connect(pan).connect(this.#sfxBus);
    const voices = this.#voices.get(id) ?? [];
    while (voices.length >= MAX_VOICES) voices.shift()?.stop();
    voices.push(source);
    this.#voices.set(id, voices);
    source.onended = () => {
      const list = this.#voices.get(id);
      if (list) list.splice(list.indexOf(source) >>> 0, 1);
    };
    source.start(ctx.currentTime + (options.delay ?? 0));
  }

  /** A one-shot that the music ducks under for its length. */
  sting(id: string, options: PlayOptions & { readonly duckTo?: number } = {}): void {
    const buffer = this.#buffers.get(id);
    if (!buffer || !this.audible) return;
    this.duck(options.duckTo ?? 0.3, (options.delay ?? 0) + buffer.duration / (options.rate ?? 1));
    this.play(id, options);
  }

  /** A looping sound (an engine) the game steers; null when the file is not decoded yet. */
  loop(id: string, options: { readonly gain?: number } = {}): LoopHandle | null {
    const ctx = this.#ctx;
    const buffer = this.#buffers.get(id);
    if (!ctx || !buffer || !this.#sfxBus) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2000;
    const gain = ctx.createGain();
    const level = (this.#mix[id] ?? 0.8) * (options.gain ?? 1);
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(level, ctx.currentTime, 0.1);
    const pan = ctx.createStereoPanner();
    source.connect(filter).connect(gain).connect(pan).connect(this.#sfxBus);
    source.start();
    const smooth = (param: AudioParam, value: number, tau = 0.08): void => {
      param.setTargetAtTime(value, ctx.currentTime, tau);
    };
    return {
      setRate: (rate) => smooth(source.playbackRate, Math.max(0.25, Math.min(4, rate))),
      setGain: (g) => smooth(gain.gain, level * Math.max(0, g)),
      setFilter: (hz) => smooth(filter.frequency, Math.max(40, Math.min(20000, hz))),
      setPan: (p) => smooth(pan.pan, Math.max(-1, Math.min(1, p))),
      stop: (fade = 0.15) => {
        smooth(gain.gain, 0, fade / 3);
        source.stop(ctx.currentTime + fade + 0.05);
      },
    };
  }

  /** What is playing and how loud the output is now: the play probe's `audio`. */
  probe(): AudioProbe {
    const running = this.#ctx?.state === "running";
    let level = 0;
    if (running && this.#analyser) {
      this.#analyser.getFloatTimeDomainData(this.#samples);
      let sum = 0;
      for (const v of this.#samples) sum += v * v;
      level = Math.sqrt(sum / this.#samples.length);
    }
    return {
      music: this.#track?.id ?? null,
      playing: Boolean(this.#track) && running && this.audible,
      level: Math.round(level * 10000) / 10000,
      muted: !this.audible,
    };
  }

  // -- internals ------------------------------------------------------------------------------

  #isAudio(id: string): boolean {
    const entry = this.#entries[id];
    return Boolean(entry?.url && (entry.type === "music" || entry.type === "sfx"));
  }

  #buffer(id: string): Promise<AudioBuffer | null> {
    const existing = this.#loading.get(id);
    if (existing) return existing;
    const entry = this.#entries[id];
    const ctx = this.#ctx;
    const task = (async (): Promise<AudioBuffer | null> => {
      if (!ctx || !entry?.url || !this.#isAudio(id)) return null;
      try {
        const response = await fetch(new URL(entry.url, this.#manifestUrl).href);
        if (!response.ok) return null;
        const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
        this.#buffers.set(id, decoded);
        if (this.#wanted && (this.#wanted.id === id || this.#wanted.options.layers?.includes(id))) {
          void this.#startWanted();
        }
        return decoded;
      } catch {
        return null;
      }
    })();
    this.#loading.set(id, task);
    return task;
  }

  /** Mute, pause and unlock in one place: ramp the master, suspend or resume the context. */
  #apply(): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#master) return;
    const on = this.audible;
    if (this.#suspendTimer) clearTimeout(this.#suspendTimer);
    this.#suspendTimer = null;
    if (on) {
      void ctx.resume().then(() => {
        this.#master?.gain.setTargetAtTime(1, ctx.currentTime, MUTE_RAMP_S / 3);
        void this.#startWanted();
      });
    } else {
      this.#master.gain.setTargetAtTime(0, ctx.currentTime, MUTE_RAMP_S / 3);
      // Once the ramp has settled, stop the clock: the music resumes where it was.
      this.#suspendTimer = setTimeout(() => {
        if (!this.audible && ctx.state === "running") void ctx.suspend();
      }, 250);
    }
  }

  async #startWanted(): Promise<void> {
    const ctx = this.#ctx;
    const wanted = this.#wanted;
    if (!ctx || !wanted || !this.#musicBus || !this.audible || ctx.state !== "running") return;
    if (this.#track?.id === wanted.id) return;
    const ids = [wanted.id, ...(wanted.options.layers ?? [])];
    const buffers = ids.map((id) => this.#buffers.get(id));
    if (buffers.some((b) => !b)) {
      for (const id of ids) void this.#buffer(id);
      return;
    }
    if (this.#wanted !== wanted || this.#track?.id === wanted.id) return;
    const fade = wanted.options.fade ?? 1.2;
    const start = ctx.currentTime + 0.05;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, start + fade);
    gain.connect(this.#musicBus);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 20000;
    filter.connect(gain);
    const track: Track = { id: wanted.id, gain, filter, sources: [], layers: new Map() };
    ids.forEach((id, index) => {
      const source = ctx.createBufferSource();
      source.buffer = buffers[index]!;
      source.loop = true;
      if (index === 0) {
        source.connect(filter);
      } else {
        const layer = ctx.createGain();
        layer.gain.value = 0;
        source.connect(layer).connect(gain);
        track.layers.set(id, layer);
      }
      source.start(start);
      track.sources.push(source);
    });
    this.#fadeOut(this.#track, fade);
    this.#track = track;
  }

  #fadeOut(track: Track | null, fade: number): void {
    const ctx = this.#ctx;
    if (!track || !ctx) return;
    const now = ctx.currentTime;
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    track.gain.gain.linearRampToValueAtTime(0, now + fade);
    for (const source of track.sources) source.stop(now + fade + 0.05);
  }
}
