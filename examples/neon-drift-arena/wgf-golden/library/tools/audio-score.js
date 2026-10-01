// Neon Drift Arena's music and sound effects, as a score: rendered by
// examples/wgf-golden-shared/library/tools/audio/render.mjs into ../audio/.
//
// Synthwave. A minor, 112.5 BPM (a bar is exactly 102400 samples at 48 kHz). The driving loop
// is two stems of one 32-bar, 68 s arrangement that start together and stay in lock-step:
//
//   music-drive        the base - four-on-the-floor kick, gated-reverb snare, sixteenth
//                      hats, a pumping octave saw bass and wide detuned pads, sidechained
//   music-drive-layer  the intensity - a ping-pong square arpeggio, a saw lead with glide,
//                      open hats, claps, crashes, risers and a tom fill
//
// The game plays both: the base's low-pass opens and the layer fades in as speed rises. The
// title variant is pads, a slow arpeggio and a sub, no kit. The engine is a seamless 2 s loop
// whose partials all complete whole cycles, for the game to re-pitch and filter with speed and
// steering. The crash layers CC0 recordings by Kenney (sources/) under a synthesized body.
// Authored for web-game-template's golden reference ports. CC0-1.0.

import { bassNote, voicing } from "../../../../wgf-golden-shared/library/tools/audio/synth.js";

const BPM = 112.5;
const S1 = ["Am", "F", "C", "G", "Am", "F", "Dm", "E"];
const S2 = ["F", "G", "Em", "Am", "F", "G", "Am", "Am"];
const S4 = ["Dm", "Am", "F", "G", "Dm", "Am", "F", "G"];
const DRIVE = [...S1, ...S2, ...S1, ...S4];

const LEAD2 = [
  [
    [0, 1.5, 81],
    [1.5, 0.5, 79],
    [2, 2, 77],
  ],
  [
    [0, 1.5, 79],
    [1.5, 0.5, 77],
    [2, 1, 76],
    [3, 1, 74],
  ],
  [
    [0, 3, 76],
    [3, 0.5, 74],
    [3.5, 0.5, 76],
  ],
  [
    [0, 2, 72],
    [2, 1, 71],
    [3, 1, 72],
  ],
  [
    [0, 1, 77],
    [1, 1, 81],
    [2, 2, 84],
  ],
  [
    [0, 1.5, 83],
    [1.5, 0.5, 81],
    [2, 2, 79],
  ],
  [
    [0, 2, 81],
    [2, 1, 79],
    [3, 1, 76],
  ],
  [[0, 4, 81]],
];
const LEAD3 = [
  [
    [0, 1, 76],
    [1, 0.5, 72],
    [1.5, 0.5, 76],
    [2, 2, 81],
  ],
  [
    [0, 1, 79],
    [1, 1, 77],
    [2, 2, 72],
  ],
  [
    [0, 1, 76],
    [1, 0.5, 79],
    [1.5, 0.5, 84],
    [2, 2, 79],
  ],
  [
    [0, 1.5, 74],
    [1.5, 0.5, 76],
    [2, 2, 79],
  ],
  [
    [0, 1, 81],
    [1, 1, 84],
    [2, 1, 83],
    [3, 1, 81],
  ],
  [
    [0, 2, 77],
    [2, 1, 76],
    [3, 1, 77],
  ],
  [
    [0, 2, 74],
    [2, 1, 77],
    [3, 1, 81],
  ],
  [
    [0, 2, 80],
    [2, 1, 83],
    [3, 1, 76],
  ],
];

function drive(stem) {
  return (s, out, t0) => {
    const beat = 60 / BPM;
    const bar = 4 * beat;
    const at = (i, pos) => t0 + i * bar + pos * beat;
    const music = s.gain(out, 1);
    const drums = s.gain(out, 0.85);
    const gated = s.reverb(out, {
      seconds: 0.55,
      decay: 0.5,
      wet: 0.5,
      bright: 0.7,
      predelay: 0.008,
    });
    const hall = s.reverb(out, { seconds: 3.2, decay: 1.1, wet: 0.28, bright: 0.45 });
    const echo = s.pingpong(out, { time: 0.75 * beat, feedback: 0.42, wet: 0.3, lp: 3600 });
    music.connect(hall);
    const kicks = [];
    DRIVE.forEach((name, i) => {
      const section = Math.floor(i / 8);
      const inSection = i % 8;
      const breakdown = section === 3 && inSection < 4;
      if (stem === "base") {
        if (!breakdown) {
          for (const p of [0, 1, 2, 3]) {
            s.kick(drums, at(i, p), 1, { pitch: 120, low: 42, decay: 0.42, click: 0.35 });
            kicks.push(at(i, p));
          }
          for (const p of [1, 3]) {
            s.snare(drums, at(i, p), 0.7, { tone: 175, decay: 0.16, bright: 1900 });
            s.snare(gated, at(i, p), 0.9);
          }
          for (let k = 0; k < 16; k++) s.hat(drums, at(i, k / 4), k % 4 === 2 ? 0.55 : 0.28);
        } else {
          for (const p of [0, 2]) kicks.push(at(i, p));
        }
        const root = bassNote(name, 33);
        if (breakdown) {
          s.sawBass(music, at(i, 0), root, 3.8 * beat, 0.8, 500);
        } else {
          const step = section === 2 ? 0.25 : 0.5;
          for (let p = 0; p < 4; p += step) {
            const up = section === 2 ? Math.round(p * 4) % 4 === 2 : Math.round(p * 2) % 4 === 3;
            s.sawBass(music, at(i, p), root + (up ? 12 : 0), step * beat * 0.85, up ? 0.8 : 1, 700);
          }
        }
        s.pad(
          music,
          at(i, 0),
          voicing(name, 57, true),
          3.95 * beat,
          breakdown ? 0.8 : 1,
          breakdown ? 1500 : 3200,
        );
      } else {
        const tones = voicing(name, 69);
        const order = [0, 1, 2, 1, 0, 2, 1, 2];
        for (let k = 0; k < 16; k++) {
          const n = tones[order[k % 8] % tones.length] + (k % 8 >= 4 ? 12 : 0);
          s.arp(echo, at(i, k / 4), n, breakdown ? 0.55 : 0.9, 0.2, breakdown ? 1400 : 2600);
          s.arp(music, at(i, k / 4), n, breakdown ? 0.4 : 0.7, 0.2, breakdown ? 1400 : 2600);
        }
        if (!breakdown) {
          for (const p of [0.5, 1.5, 2.5, 3.5]) s.hat(drums, at(i, p), 0.5, true);
          for (const p of [1, 3]) s.clap(gated, at(i, p), 0.6);
        }
        if (inSection === 0 && section !== 3) s.crash(drums, at(i, 0), 0.7);
        if (section === 3 && inSection === 4) s.crash(drums, at(i, 0), 0.8);
        if (inSection === 7) s.riser(drums, at(i, 0), bar, 0.7);
        if (i === DRIVE.length - 1)
          [2, 2.5, 3, 3.5].forEach((p, k) => s.tom(drums, at(i, p), 0.8, 190 - k * 30));
        const line = section === 1 ? LEAD2[inSection] : section === 2 ? LEAD3[inSection] : null;
        if (line) {
          let prev = null;
          for (const [p, len, note] of line) {
            s.sawLead(
              music,
              at(i, p),
              note,
              len * beat * 0.95,
              1,
              prev !== null && Math.abs(prev - note) <= 3 ? prev : null,
            );
            s.sawLead(echo, at(i, p), note, len * beat * 0.9, 0.4);
            prev = note;
          }
        }
      }
    });
    s.duck(music.gain, kicks, { floor: stem === "base" ? 0.45 : 0.65, release: 0.2 });
  };
}

function title(s, out, t0) {
  const beat = 60 / BPM;
  const bar = 4 * beat;
  const at = (i, pos) => t0 + i * bar + pos * beat;
  const music = s.gain(out, 1);
  const hall = s.reverb(out, { seconds: 3.6, decay: 1.3, wet: 0.35, bright: 0.4 });
  const echo = s.pingpong(out, { time: 0.75 * beat, feedback: 0.45, wet: 0.35, lp: 5200 });
  music.connect(hall);
  [...S1, ...S2].forEach((name, i) => {
    s.pad(music, at(i, 0), voicing(name, 57, true), 3.95 * beat, 1, 2200);
    s.sawBass(music, at(i, 0), bassNote(name, 33), 3.6 * beat, 0.5, 300);
    const tones = voicing(name, 69);
    for (let k = 0; k < 8; k++) {
      const n = tones[[0, 1, 2, 1][k % 4] % tones.length] + (k >= 4 ? 12 : 0);
      s.arp(echo, at(i, k / 2), n, 0.8, 0.3, 3400);
      s.arp(music, at(i, k / 2), n, 0.6, 0.3, 3400);
    }
    if (i >= 8) {
      s.kick(music, at(i, 0), 0.5, { pitch: 100, low: 40, decay: 0.5, click: 0.1 });
      const line = LEAD2[i - 8];
      for (const [p, len, note] of line) if (len >= 1) s.bell(echo, at(i, p), note, 0.35, 1.6);
    }
  });
}

// -- sound effects (mono, 44.1 kHz) -------------------------------------------------------------

const sfx = (build, seconds, extra = {}) => ({
  format: "wav",
  channels: 1,
  sampleRate: 44100,
  seconds,
  build,
  ...extra,
});

/** The engine: a 2 s loop of partials that complete whole cycles in it (multiples of 0.5 Hz),
 * a throb at 7.5 Hz, and a noise buffer exactly a quarter of the loop, looped. */
function engine(s, out, t0, { pass }) {
  if (pass) return;
  const L = 2;
  const end = t0 + 3 * L;
  const g = s.gain(out, 1);
  const lp = s.filter(g, "lowpass", 900, 1.2);
  const body = s.gain(lp, 0.55);
  s.osc("sawtooth", 55, t0, end, body);
  s.osc("sawtooth", 55.5, t0, end, s.gain(lp, 0.35));
  s.osc("square", 27.5, t0, end, s.gain(lp, 0.4));
  s.osc("sine", 110, t0, end, s.gain(g, 0.25));
  const throb = s.ctx.createOscillator();
  throb.frequency.value = 7.5;
  const depth = s.gain(body.gain, 0.2);
  throb.connect(depth);
  throb.start(t0);
  throb.stop(end);
  const buffer = s.ctx.createBuffer(1, Math.round((s.ctx.sampleRate * L) / 4), s.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = s.rand() * 2 - 1;
  const noise = s.ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  noise.connect(s.filter(s.gain(g, 0.18), "bandpass", 700, 0.9));
  noise.start(t0);
  noise.stop(end);
}

export default {
  samples: {
    crunch: "../audio/sources/kenney-sci-fi-sounds/explosionCrunch_000.ogg",
    boom: "../audio/sources/kenney-sci-fi-sounds/lowFrequency_explosion_000.ogg",
    metal: "../audio/sources/kenney-impact-sounds/impactMetal_heavy_000.ogg",
    glass: "../audio/sources/kenney-impact-sounds/impactGlass_heavy_000.ogg",
    select: "../audio/sources/kenney-interface-sounds/select_002.ogg",
  },
  cues: {
    "music-drive": {
      file: "audio/music-drive.ogg",
      format: "opus",
      loop: true,
      seconds: (32 * 4 * 60) / BPM,
      group: "drive",
      bitrate: 128000,
      seed: 31,
      master: { threshold: -16, ratio: 3, makeup: 1.5, low: -3, presence: 4, high: 9 },
      build: drive("base"),
    },
    "music-drive-layer": {
      file: "audio/music-drive-layer.ogg",
      format: "opus",
      loop: true,
      seconds: (32 * 4 * 60) / BPM,
      group: "drive",
      bitrate: 112000,
      seed: 32,
      master: { threshold: -16, ratio: 3, makeup: 1.5, presence: 1, high: 3 },
      build: drive("layer"),
    },
    "music-title": {
      file: "audio/music-title.ogg",
      format: "opus",
      loop: true,
      seconds: (16 * 4 * 60) / BPM,
      bitrate: 112000,
      seed: 33,
      rms: -18,
      master: { threshold: -20, ratio: 2.5, makeup: 1.3, low: -3, presence: 4, high: 10 },
      build: title,
    },

    "sfx-engine": sfx(engine, 2, { loop: true, seed: 41 }),

    // A wall going past: band-passed noise sweeping up and back down.
    "sfx-pass": sfx(
      (s, out, t) => {
        const g = s.gain(out, 0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.8, t + 0.18);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        const bp = s.filter(g, "bandpass", 600, 1.6);
        bp.frequency.setValueAtTime(500, t);
        bp.frequency.exponentialRampToValueAtTime(2600, t + 0.18);
        bp.frequency.exponentialRampToValueAtTime(700, t + 0.55);
        s.noiseSource(t, 0.6, bp);
      },
      0.6,
      { seed: 42 },
    ),

    // A near miss: a hard whoosh with a falling doppler zing and a short tail.
    "sfx-near-miss": sfx(
      (s, out, t) => {
        const room = s.reverb(out, { seconds: 0.8, decay: 0.25, wet: 0.25 });
        const g = s.gain(out, 0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        const bp = s.filter(g, "bandpass", 900, 1.2);
        bp.frequency.setValueAtTime(900, t);
        bp.frequency.exponentialRampToValueAtTime(5200, t + 0.1);
        bp.frequency.exponentialRampToValueAtTime(900, t + 0.5);
        s.noiseSource(t, 0.55, bp);
        const z = s.gain(out, 0);
        s.hit(z.gain, t + 0.06, 0.35, 0.45, 0.01);
        const zing = s.osc("sawtooth", 1800, t + 0.06, t + 0.6, s.filter(z, "lowpass", 4000));
        zing.frequency.exponentialRampToValueAtTime(700, t + 0.5);
        const zr = s.gain(room, 0);
        s.hit(zr.gain, t + 0.06, 0.3, 0.4, 0.01);
        s.osc("sine", 1800, t + 0.06, t + 0.5, zr).frequency.exponentialRampToValueAtTime(
          700,
          t + 0.5,
        );
      },
      0.9,
      { seed: 43 },
    ),

    // The crash: recorded crunch, boom, metal and glass over a synthesized sub drop.
    "sfx-crash": sfx(
      (s, out, t) => {
        s.sample("crunch", t, out, { gain: 0.9 });
        s.sample("boom", t, out, { gain: 0.8 });
        s.sample("metal", t, out, { gain: 0.7, rate: 0.85 });
        s.sample("glass", t + 0.02, out, { gain: 0.5 });
        s.kick(out, t, 1, { pitch: 90, low: 30, decay: 0.7, click: 0.6 });
        const g = s.gain(out, 0);
        s.hit(g.gain, t, 0.5, 0.9);
        s.noiseSource(t, 1, s.filter(g, "lowpass", 1600));
      },
      1.8,
      { uses: ["crunch", "boom", "metal", "glass"], seed: 44 },
    ),

    // Game over: a falling saw line, E - C - A, the last note bending down like a tape stop.
    "sfx-game-over": sfx(
      (s, out, t) => {
        const hall = s.reverb(out, { seconds: 2, decay: 0.7, wet: 0.35 });
        [
          [0, 0.22, 76],
          [0.24, 0.22, 72],
        ].forEach(([p, len, n]) => {
          s.sawLead(out, t + p, n, len, 1);
          s.sawLead(hall, t + p, n, len, 0.6);
        });
        s.sawLead(out, t + 0.48, 69, 1.0, 1);
        s.sawLead(hall, t + 0.48, 69, 1.0, 0.6);
        const drop = s.gain(out, 0);
        s.adsr(drop.gain, t + 0.48, 1.0, { a: 0.05, d: 0.3, s: 0.8, r: 0.3, peak: 0.12 });
        for (const n of [45, 52, 57]) {
          const o = s.osc(
            "sawtooth",
            440 * Math.pow(2, (n - 69) / 12),
            t + 0.48,
            t + 1.9,
            s.filter(drop, "lowpass", 1400),
          );
          o.frequency.setValueAtTime(440 * Math.pow(2, (n - 69) / 12), t + 0.9);
          o.frequency.exponentialRampToValueAtTime(440 * Math.pow(2, (n - 69 - 14) / 12), t + 1.6);
        }
      },
      2.0,
      { seed: 45 },
    ),

    // A new best: synth brass stabs climbing Am - C - G, then a held A major with sparkle.
    "ui-fanfare": sfx(
      (s, out, t) => {
        const hall = s.reverb(out, { seconds: 1.8, decay: 0.6, wet: 0.3 });
        for (const [p, len, notes] of [
          [0, 0.12, [57, 60, 64]],
          [0.16, 0.12, [60, 64, 67]],
          [0.32, 0.12, [62, 67, 71]],
          [0.5, 1.0, [57, 61, 64, 69]],
        ]) {
          s.brass(out, t + p, notes, len, 1);
          s.brass(hall, t + p, notes, len, 0.5);
        }
        [81, 85, 88, 93].forEach((n, k) => s.arp(out, t + 0.5 + k * 0.06, n, 0.9, 0.4, 3000));
        s.crash(out, t + 0.5, 0.5);
      },
      1.8,
      { seed: 46 },
    ),

    // A button: Kenney's select, with a short bright blip a fifth above A.
    "ui-tap": sfx(
      (s, out, t) => {
        s.sample("select", t, out, { gain: 0.9 });
        const g = s.gain(out, 0);
        s.hit(g.gain, t, 0.1, 0.05);
        s.osc("square", 1318.5, t, t + 0.07, s.filter(g, "lowpass", 3000));
      },
      0.2,
      { uses: ["select"], seed: 47 },
    ),
  },
};
