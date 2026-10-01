// The instruments and the mix the reference games' music and sound effects are rendered with.
//
// Runs in a browser page, inside an OfflineAudioContext (render.mjs drives it headless): every
// sound is Web Audio - oscillators, seeded noise, biquad filters, a convolver over a generated
// impulse response, delays and compressors - scheduled ahead and rendered faster than real
// time. Nothing here is random at render time except through the seeded generator, so a score
// renders to the same audio twice on the same browser build - within one 16-bit step: the
// browser's floating-point paths are not bit-exact from run to run, so the bytes may differ.
//
// Authored for web-game-template's golden reference ports. CC0-1.0.
/* global fetch */

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const EPS = 0.0001;

// -- chords ---------------------------------------------------------------------------------

const ROOTS = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};
const QUALITIES = {
  "": [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  7: [0, 4, 7, 10],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  dim: [0, 3, 6],
  6: [0, 4, 7, 9],
};

/** {root (pitch class), tones (semitones above the root), bass (pitch class)} of "Fmaj7",
 * "C/Bb", "Am7". */
export function chord(name) {
  const [head, slash] = name.split("/");
  const match = /^([A-G][b#]?)(.*)$/.exec(head);
  if (!match) throw new Error(`bad chord ${name}`);
  const root = ROOTS[match[1]];
  const tones = QUALITIES[match[2]];
  if (root === undefined || !tones) throw new Error(`bad chord ${name}`);
  const bass = slash ? ROOTS[slash] : root;
  return { root, tones, bass };
}

/** MIDI notes of a chord voiced close above `floor` (the lowest note allowed). */
export function voicing(name, floor = 55, spread = false) {
  const c = chord(name);
  let base = floor + ((((c.root - floor) % 12) + 12) % 12);
  const notes = c.tones.map((t) => base + t);
  if (spread && notes.length >= 3) notes[1] += 12; // open voicing: the third up an octave
  return notes.sort((a, b) => a - b);
}

export function bassNote(name, floor = 33) {
  const c = chord(name);
  return floor + ((((c.bass - floor) % 12) + 12) % 12);
}

// -- the studio -----------------------------------------------------------------------------

export class Studio {
  constructor(ctx, seed = 1) {
    this.ctx = ctx;
    this.rand = rng(seed);
    this.noise = this.#noise(3);
    this.samples = {};
    this.waves = {};
  }

  #noise(seconds) {
    const { ctx } = this;
    const buffer = ctx.createBuffer(1, Math.floor(seconds * ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = this.rand() * 2 - 1;
    return buffer;
  }

  async load(samples) {
    for (const [name, url] of Object.entries(samples || {})) {
      const bytes = await (await fetch(url)).arrayBuffer();
      this.samples[name] = await this.ctx.decodeAudioData(bytes);
    }
  }

  /** A pulse wave of the given duty cycle, from its Fourier series. */
  pulse(duty = 0.25) {
    const key = `pulse-${duty}`;
    if (!this.waves[key]) {
      const n = 48;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      this.waves[key] = this.ctx.createPeriodicWave(real, imag);
    }
    return this.waves[key];
  }

  gain(dest, value = 1) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  pan(dest, value) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = value;
    p.connect(dest);
    return p;
  }

  filter(dest, type, frequency, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  /** Attack-decay-sustain-release on an AudioParam, from 0, over a note of `dur` seconds. */
  adsr(param, t, dur, { a = 0.005, d = 0.1, s = 0.6, r = 0.15, peak = 1 } = {}) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.setTargetAtTime(peak * s, t + a, Math.max(d / 3, 0.001));
    const end = t + Math.max(dur, a);
    param.setTargetAtTime(0, end, Math.max(r / 4, 0.001));
    return end + r * 1.5;
  }

  /** A percussive envelope: instant attack, exponential decay. */
  hit(param, t, peak, decay, attack = 0.001) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(EPS, t + attack + decay);
    return t + attack + decay + 0.01;
  }

  osc(type, frequency, t, stop, dest) {
    const o = this.ctx.createOscillator();
    if (type === "pulse") o.setPeriodicWave(this.pulse(0.25));
    else if (type === "pulse12") o.setPeriodicWave(this.pulse(0.125));
    else o.type = type;
    o.frequency.setValueAtTime(frequency, t);
    o.connect(dest);
    o.start(t);
    o.stop(stop);
    return o;
  }

  noiseSource(t, dur, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const offset = this.rand() * (this.noise.duration - dur - 0.05);
    s.connect(dest);
    s.start(t, Math.max(0, offset), dur + 0.02);
    return s;
  }

  sample(name, t, dest, { rate = 1, gain = 1, offset = 0, dur } = {}) {
    const buffer = this.samples[name];
    if (!buffer) throw new Error(`sample ${name} not loaded`);
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    const g = this.gain(dest, gain);
    s.connect(g);
    if (dur === undefined) s.start(t, offset);
    else s.start(t, offset, dur);
    return s;
  }

  // -- effects ------------------------------------------------------------------------------

  /** A stereo impulse response: decorrelated noise under an exponential decay that darkens
   * as it falls (a one-pole low-pass closing over the tail), after a pre-delay. */
  impulse({ seconds = 2.2, decay = 0.6, predelay = 0.012, bright = 0.6, seed = 7 } = {}) {
    const { ctx } = this;
    const rand = rng(seed);
    const len = Math.floor((seconds + predelay) * ctx.sampleRate);
    const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
    const pre = Math.floor(predelay * ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / ctx.sampleRate;
        const amp = Math.exp(-t / decay);
        const k = bright * Math.exp(-t / (decay * 1.5)) + 0.04;
        lp += k * (rand() * 2 - 1 - lp);
        data[i] = lp * amp;
      }
    }
    return buffer;
  }

  /** A reverb send: returns the node to feed; its wet output goes to `dest`. */
  reverb(dest, options = {}) {
    const input = this.gain(null, 1);
    const hp = this.filter(null, "highpass", options.lowCut || 180);
    const conv = this.ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = this.impulse(options);
    const wet = this.gain(dest, options.wet ?? 0.3);
    input.connect(hp).connect(conv).connect(wet);
    return input;
  }

  /** A ping-pong delay send: left and right taps alternate, filtered in the loop. */
  pingpong(dest, { time = 0.375, feedback = 0.35, wet = 0.25, lp = 3200 } = {}) {
    const input = this.gain(null, 1);
    const left = this.ctx.createDelay(4);
    const right = this.ctx.createDelay(4);
    left.delayTime.value = time;
    right.delayTime.value = time;
    const fbL = this.gain(null, feedback);
    const fbR = this.gain(null, feedback);
    const tone = this.filter(null, "lowpass", lp);
    const merger = this.ctx.createChannelMerger(2);
    const out = this.gain(dest, wet);
    input.connect(tone).connect(left);
    left.connect(fbL).connect(right);
    right.connect(fbR).connect(left);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(out);
    return input;
  }

  /** Sidechain-style ducking: the param dips to `floor` at each time and recovers. */
  duck(param, times, { floor = 0.55, release = 0.16, level = 1 } = {}) {
    param.setValueAtTime(level, 0);
    for (const t of times) {
      param.setTargetAtTime(floor * level, t, 0.004);
      param.setTargetAtTime(level, t + 0.02, release / 3);
    }
  }

  /** The master chain: rumble cut, a mastering EQ (low shelf at 110 Hz, presence peak at
   * 2.8 kHz, high shelf at 6 kHz; dB), glue compressor, make-up, a fast limiter. */
  master(
    dest,
    { threshold = -18, ratio = 3, makeup = 1.6, limit = -2, low = 0, presence = 0, high = 0 } = {},
  ) {
    const input = this.gain(null, 1);
    const hp = this.filter(null, "highpass", 28, 0.6);
    const shelfLow = this.filter(null, "lowshelf", 110);
    shelfLow.gain.value = low;
    const mid = this.filter(null, "peaking", 2800, 0.8);
    mid.gain.value = presence;
    const shelfHigh = this.filter(null, "highshelf", 6000);
    shelfHigh.gain.value = high;
    hp.connect(shelfLow).connect(mid);
    const eqOut = mid.connect(shelfHigh);
    const glue = this.ctx.createDynamicsCompressor();
    glue.threshold.value = threshold;
    glue.ratio.value = ratio;
    glue.knee.value = 8;
    glue.attack.value = 0.012;
    glue.release.value = 0.22;
    const make = this.gain(null, makeup);
    const lim = this.ctx.createDynamicsCompressor();
    lim.threshold.value = limit;
    lim.ratio.value = 20;
    lim.knee.value = 0;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    input.connect(hp);
    eqOut.connect(glue).connect(make).connect(lim).connect(dest);
    return input;
  }

  // -- drums --------------------------------------------------------------------------------

  kick(dest, t, vel = 1, { pitch = 150, low = 46, decay = 0.38, click = 0.5 } = {}) {
    const g = this.gain(dest, 0);
    const end = this.hit(g.gain, t, 1.1 * vel, decay);
    const o = this.osc("sine", pitch, t, end, g);
    o.frequency.exponentialRampToValueAtTime(low, t + 0.11);
    const cg = this.gain(dest, 0);
    this.hit(cg.gain, t, click * vel, 0.012);
    this.noiseSource(t, 0.03, this.filter(cg, "highpass", 2500));
  }

  snare(dest, t, vel = 1, { tone = 185, decay = 0.18, bright = 2200 } = {}) {
    const ng = this.gain(dest, 0);
    this.hit(ng.gain, t, 0.75 * vel, decay);
    const bp = this.filter(ng, "bandpass", bright, 0.8);
    this.noiseSource(t, decay + 0.05, this.filter(bp, "highpass", 900));
    const bg = this.gain(dest, 0);
    const end = this.hit(bg.gain, t, 0.55 * vel, 0.09);
    const o = this.osc("triangle", tone, t, end, bg);
    o.frequency.exponentialRampToValueAtTime(tone * 0.8, t + 0.08);
  }

  clap(dest, t, vel = 1) {
    const g = this.gain(dest, 0);
    const p = g.gain;
    p.setValueAtTime(0, t);
    for (let k = 0; k < 3; k++) {
      const s = t + k * 0.011;
      p.linearRampToValueAtTime(0.8 * vel, s + 0.001);
      p.exponentialRampToValueAtTime(0.08 * vel, s + 0.01);
    }
    p.setTargetAtTime(0, t + 0.035, 0.05);
    const bp = this.filter(g, "bandpass", 1300, 1.1);
    this.noiseSource(t, 0.3, bp);
  }

  hat(dest, t, vel = 1, open = false) {
    const g = this.gain(dest, 0);
    this.hit(g.gain, t, 0.5 * vel, open ? 0.28 : 0.04);
    const hp = this.filter(g, "highpass", 7000, 0.9);
    this.noiseSource(t, open ? 0.35 : 0.06, this.filter(hp, "peaking", 10000, 1));
  }

  shaker(dest, t, vel = 1) {
    const g = this.gain(dest, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.075);
    this.noiseSource(t, 0.09, this.filter(g, "bandpass", 6500, 1.4));
  }

  tom(dest, t, vel = 1, pitch = 140) {
    const g = this.gain(dest, 0);
    const end = this.hit(g.gain, t, 0.8 * vel, 0.32);
    const o = this.osc("sine", pitch, t, end, g);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.6, t + 0.3);
  }

  crash(dest, t, vel = 1) {
    const g = this.gain(dest, 0);
    this.hit(g.gain, t, 0.3 * vel, 1.8, 0.002);
    this.noiseSource(t, 1.9, this.filter(this.filter(g, "highpass", 4500), "peaking", 7000, 0.7));
  }

  /** Noise swelling up a band-pass into a downbeat. */
  riser(dest, t, dur, vel = 1) {
    const g = this.gain(dest, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * vel, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    const bp = this.filter(g, "bandpass", 400, 2.5);
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    this.noiseSource(t, dur + 0.05, bp);
  }

  // -- tonal ---------------------------------------------------------------------------------

  /** A round, plucky bass: triangle plus sine sub through a closing low-pass. */
  pluckBass(dest, t, midi, dur, vel = 1) {
    const f = mtof(midi);
    const g = this.gain(dest, 0);
    const end = this.adsr(g.gain, t, dur, { a: 0.004, d: 0.18, s: 0.45, r: 0.08, peak: 0.7 * vel });
    const lp = this.filter(g, "lowpass", 300, 2);
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(380, t + 0.16);
    this.osc("triangle", f, t, end, lp);
    this.osc("sine", f, t, end, g);
  }

  /** A synthwave bass: two detuned saws and a sine sub, low-passed. */
  sawBass(dest, t, midi, dur, vel = 1, cutoff = 900) {
    const f = mtof(midi);
    const g = this.gain(dest, 0);
    const end = this.adsr(g.gain, t, dur, { a: 0.004, d: 0.12, s: 0.7, r: 0.05, peak: 0.5 * vel });
    const lp = this.filter(g, "lowpass", cutoff, 3);
    lp.frequency.setValueAtTime(cutoff * 2.6, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff, t + 0.09);
    this.osc("sawtooth", f, t, end, lp).detune.value = -7;
    this.osc("sawtooth", f, t, end, lp).detune.value = 7;
    const sub = this.gain(dest, 0);
    this.adsr(sub.gain, t, dur, { a: 0.004, d: 0.1, s: 0.8, r: 0.05, peak: 0.45 * vel });
    this.osc("sine", f / 2, t, end, sub);
  }

  /** An electric-piano tine: two-operator FM whose index falls as the note rings. */
  epiano(dest, t, midi, dur, vel = 1) {
    const f = mtof(midi);
    const g = this.gain(dest, 0);
    const end = this.adsr(g.gain, t, dur, { a: 0.003, d: 0.9, s: 0.25, r: 0.35, peak: 0.28 * vel });
    const car = this.osc("sine", f, t, end, g);
    const mod = this.ctx.createOscillator();
    mod.frequency.value = f;
    const index = this.gain(car.frequency, 0);
    index.gain.setValueAtTime(f * 2.2 * vel, t);
    index.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.6);
    mod.connect(index);
    mod.start(t);
    mod.stop(end);
    // the tine's bell: a quiet 14th partial that dies at once
    const bell = this.gain(dest, 0);
    this.hit(bell.gain, t, 0.035 * vel, 0.08);
    this.osc("sine", f * 14, t, t + 0.12, bell);
  }

  /** A mallet (marimba-like): fundamental plus the 4th and 10th partials, short. */
  mallet(dest, t, midi, vel = 1, decay = 0.45) {
    const f = mtof(midi);
    const g = this.gain(dest, 0);
    const end = this.hit(g.gain, t, 0.45 * vel, decay);
    this.osc("sine", f, t, end, g);
    const h = this.gain(dest, 0);
    this.hit(h.gain, t, 0.16 * vel, decay * 0.25);
    this.osc("sine", f * 3.99, t, end, h);
    const k = this.gain(dest, 0);
    this.hit(k.gain, t, 0.05 * vel, decay * 0.08);
    this.osc("sine", f * 9.9, t, end, k);
  }

  /** A glockenspiel / bell: inharmonic partials, long ring. */
  bell(dest, t, midi, vel = 1, decay = 1.4) {
    const f = mtof(midi);
    const partials = [
      [1, 0.5, 1],
      [2.76, 0.22, 0.6],
      [5.4, 0.12, 0.35],
      [8.93, 0.06, 0.2],
    ];
    for (const [ratio, amp, life] of partials) {
      const g = this.gain(dest, 0);
      const end = this.hit(g.gain, t, amp * vel * 0.5, decay * life);
      this.osc("sine", f * ratio, t, end, g);
    }
  }

  /** A whistle-like pulse lead with delayed vibrato. */
  pulseLead(dest, t, midi, dur, vel = 1, glideFrom = null) {
    const f = mtof(midi);
    const g = this.gain(dest, 0);
    const end = this.adsr(g.gain, t, dur, { a: 0.012, d: 0.12, s: 0.75, r: 0.09, peak: 0.2 * vel });
    const lp = this.filter(g, "lowpass", 3400, 0.9);
    const o = this.osc("pulse", glideFrom ? mtof(glideFrom) : f, t, end, lp);
    if (glideFrom) o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const depth = this.gain(o.detune, 0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(dur > 0.4 ? 22 : 0, t + Math.min(0.35, dur));
    lfo.connect(depth);
    lfo.start(t);
    lfo.stop(end);
    // a soft sine an octave down gives the whistle body
    const body = this.gain(dest, 0);
    this.adsr(body.gain, t, dur, { a: 0.015, d: 0.1, s: 0.8, r: 0.08, peak: 0.12 * vel });
    this.osc("sine", f, t, end, body);
  }

  /** A synthwave pad: five detuned saws per note, spread, slow filter swell. */
  pad(dest, t, notes, dur, vel = 1, cutoff = 1600) {
    const g = this.gain(dest, 0);
    const end = this.adsr(g.gain, t, dur, { a: 0.45, d: 0.6, s: 0.85, r: 0.9, peak: 0.07 * vel });
    const lp = this.filter(g, "lowpass", cutoff * 0.5, 0.8);
    lp.frequency.setValueAtTime(cutoff * 0.45, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + Math.min(dur, 1.2));
    lp.frequency.linearRampToValueAtTime(cutoff * 0.7, t + dur + 0.6);
    const spreads = [-14, -6, 0, 6, 14];
    for (const midi of notes) {
      spreads.forEach((cents, i) => {
        const p = this.pan(lp, (i - 2) * 0.32);
        this.osc("sawtooth", mtof(midi), t, end, p).detune.value = cents;
      });
    }
  }

  /** A soft pad for the playful score: triangles and a filtered saw, gentle. */
  softPad(dest, t, notes, dur, vel = 1) {
    const g = this.gain(dest, 0);
    const end = this.adsr(g.gain, t, dur, { a: 0.3, d: 0.5, s: 0.8, r: 0.7, peak: 0.06 * vel });
    const lp = this.filter(g, "lowpass", 1400, 0.6);
    for (const midi of notes) {
      this.osc("triangle", mtof(midi), t, end, this.pan(lp, -0.3)).detune.value = -5;
      this.osc("triangle", mtof(midi), t, end, this.pan(lp, 0.3)).detune.value = 5;
    }
  }

  /** A square pluck for arpeggios. */
  arp(dest, t, midi, vel = 1, decay = 0.22, cutoff = 2600) {
    const g = this.gain(dest, 0);
    const end = this.hit(g.gain, t, 0.16 * vel, decay, 0.002);
    const lp = this.filter(g, "lowpass", cutoff, 4);
    lp.frequency.setValueAtTime(cutoff * 1.8, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff * 0.35, t + decay);
    this.osc("square", mtof(midi), t, end, lp);
  }

  /** A synthwave lead: saw plus a detuned saw an octave up, glide and vibrato. */
  sawLead(dest, t, midi, dur, vel = 1, glideFrom = null) {
    const f = mtof(midi);
    const g = this.gain(dest, 0);
    const end = this.adsr(g.gain, t, dur, { a: 0.02, d: 0.2, s: 0.8, r: 0.25, peak: 0.13 * vel });
    const lp = this.filter(g, "lowpass", 3800, 1.4);
    const voices = [
      this.osc("sawtooth", f, t, end, this.pan(lp, -0.15)),
      this.osc("sawtooth", f * 2, t, end, this.pan(lp, 0.15)),
    ];
    voices[0].detune.value = -6;
    voices[1].detune.value = 5;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = this.gain(null, 0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(dur > 0.5 ? 18 : 0, t + Math.min(0.5, dur));
    lfo.connect(depth);
    for (const v of voices) {
      if (glideFrom) {
        const from = mtof(glideFrom) * (v === voices[1] ? 2 : 1);
        v.frequency.setValueAtTime(from, t);
        v.frequency.exponentialRampToValueAtTime(v === voices[1] ? f * 2 : f, t + 0.07);
      }
      depth.connect(v.detune);
    }
    lfo.start(t);
    lfo.stop(end);
  }

  /** A brass-like stab: saws through a filter envelope that opens and closes fast. */
  brass(dest, t, notes, dur, vel = 1) {
    const g = this.gain(dest, 0);
    const end = this.adsr(g.gain, t, dur, { a: 0.02, d: 0.25, s: 0.7, r: 0.18, peak: 0.11 * vel });
    const lp = this.filter(g, "lowpass", 600, 1.6);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(3600, t + 0.05);
    lp.frequency.setTargetAtTime(1500, t + 0.06, 0.15);
    for (const midi of notes) {
      this.osc("sawtooth", mtof(midi), t, end, lp).detune.value = -4;
      this.osc("sawtooth", mtof(midi), t, end, lp).detune.value = 4;
    }
  }
}

// -- rendering helpers ------------------------------------------------------------------------

/** Times of every beat position `pattern` (beats within a bar) over `bars` bars. */
export function times(start, bars, beat, pattern, swing = 0) {
  const out = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const p of pattern) out.push(start + (bar * 4 + swung(p, swing)) * beat);
  }
  return out;
}

/** A beat position with swing applied to its off-beat sixteenths (0 = straight). */
export function swung(position, swing) {
  const sixteenth = Math.round(position * 4);
  if (Math.abs(position * 4 - sixteenth) > 1e-6 || sixteenth % 2 === 0) return position;
  return position + swing * 0.25;
}
