// Tower Merge Rush's music and sound effects, as a score: rendered by
// examples/wgf-golden-shared/library/tools/audio/render.mjs into ../audio/.
//
// Riso-arcade: bright, playful, warm. F major. The play loop is a swung pop-funk groove at
// 120 BPM - punchy kick and clap, shaker, a bouncing plucked bass, electric-piano comping, a
// marimba riff and a whistle-like lead - over real progressions (I-vi-ii-V turns, a IV-iv
// bridge); 32 bars, 64 s, seamless. The title variant is the same harmony at 96 BPM with no
// kit: pads, piano, marimba and a bell melody, 40 s. Stings are in the music's key so they
// sit on top of it while it ducks; the merge pop is tuned to F so the game can pitch it up
// the F major scale, one step per tower level.
//
// The UI tap and the drop's body are CC0 recordings by Kenney (sources/), layered.
// Authored for web-game-template's golden reference ports. CC0-1.0.

import {
  bassNote,
  swung,
  voicing,
} from "../../../../wgf-golden-shared/library/tools/audio/synth.js";

const PLAY_BPM = 120;
const TITLE_BPM = 96;

// 32 bars: groove (A), verse (A'), chorus (B), bridge (C) - which turns back into A.
const A = ["Fmaj7", "Dm7", "Gm7", "C7sus4", "Fmaj7", "Am7", "Bbmaj7", "C7"];
const B = ["Bbmaj7", "C7", "Am7", "Dm7", "Gm7", "C7", "Fmaj7", "F7"];
const C = ["Bbmaj7", "Bbm6", "Am7", "D7", "Gm7", "C7", "Fmaj7", "C7"];
const PLAY = [...A, ...A, ...B, ...C];
const SECTION = ["groove", "verse", "chorus", "bridge"];

// [beat in bar, length in beats, MIDI note] per bar.
const VERSE = [
  [
    [0, 0.5, 72],
    [0.5, 0.5, 69],
    [1, 0.5, 72],
    [1.5, 1, 77],
    [3, 0.5, 76],
    [3.5, 0.5, 74],
  ],
  [
    [0, 1, 72],
    [1, 0.5, 69],
    [1.5, 0.5, 65],
    [2, 1.5, 69],
    [3.5, 0.5, 67],
  ],
  [
    [0, 0.5, 70],
    [0.5, 0.5, 74],
    [1, 0.5, 77],
    [1.5, 1, 74],
    [3, 0.5, 72],
    [3.5, 0.5, 70],
  ],
  [
    [0, 1.5, 72],
    [1.5, 0.5, 70],
    [2, 1, 67],
    [3, 1, 64],
  ],
  [
    [0, 0.5, 72],
    [0.5, 0.5, 69],
    [1, 0.5, 72],
    [1.5, 1, 77],
    [3, 0.5, 76],
    [3.5, 0.5, 74],
  ],
  [
    [0, 1, 76],
    [1, 0.5, 72],
    [1.5, 0.5, 69],
    [2, 1, 76],
    [3, 0.5, 77],
    [3.5, 0.5, 76],
  ],
  [
    [0, 1, 74],
    [1, 0.5, 70],
    [1.5, 0.5, 65],
    [2, 0.5, 69],
    [2.5, 0.5, 70],
    [3, 1, 74],
  ],
  [
    [0, 1.5, 72],
    [1.5, 0.5, 76],
    [2, 2, 79],
  ],
];
const CHORUS = [
  [
    [0, 1.5, 77],
    [1.5, 0.5, 76],
    [2, 1, 74],
    [3, 1, 69],
  ],
  [
    [0, 1.5, 76],
    [1.5, 0.5, 74],
    [2, 1, 72],
    [3, 1, 67],
  ],
  [
    [0, 1, 72],
    [1, 0.5, 76],
    [1.5, 0.5, 79],
    [2, 1.5, 76],
    [3.5, 0.5, 72],
  ],
  [
    [0, 2, 74],
    [2, 0.5, 77],
    [2.5, 0.5, 76],
    [3, 1, 74],
  ],
  [
    [0, 1, 70],
    [1, 0.5, 74],
    [1.5, 0.5, 77],
    [2, 1, 79],
    [3, 1, 77],
  ],
  [
    [0, 1, 76],
    [1, 1, 79],
    [2, 1, 82],
    [3, 1, 79],
  ],
  [
    [0, 3, 81],
    [3, 0.5, 79],
    [3.5, 0.5, 77],
  ],
  [
    [0, 1, 75],
    [1, 1, 74],
    [2, 1, 72],
    [3, 1, 69],
  ],
];

function playLoop(s, out, t0) {
  const beat = 60 / PLAY_BPM;
  const bar = 4 * beat;
  const swing = 0.16;
  const at = (i, pos) => t0 + i * bar + swung(pos, swing) * beat;
  const drums = s.gain(out, 0.8);
  const music = s.gain(out, 1);
  const room = s.reverb(out, { seconds: 1.6, decay: 0.45, wet: 0.2, bright: 0.5 });
  const echo = s.pingpong(out, { time: 0.75 * beat, feedback: 0.3, wet: 0.14, lp: 3000 });
  const leadBus = s.gain(music, 1);
  leadBus.connect(room);
  leadBus.connect(echo);
  const keys = s.gain(music, 0.9);
  keys.connect(room);
  const kicks = [];

  PLAY.forEach((name, i) => {
    const section = SECTION[Math.floor(i / 8)];
    const inSection = i % 8;
    const next = PLAY[(i + 1) % PLAY.length];
    const half = section === "bridge" && inSection < 4;

    // -- kit
    const kickPattern = half ? [] : section === "bridge" ? [0, 1, 2, 3] : [0, 1.75, 2, 2.75];
    for (const p of kickPattern) {
      s.kick(drums, at(i, p), p === 0 ? 1 : 0.8);
      kicks.push(at(i, p));
    }
    for (const p of half ? [2] : [1, 3]) {
      s.clap(drums, at(i, p), 0.8);
      s.snare(drums, at(i, p), 0.45, { tone: 200, bright: 2600 });
      s.snare(room, at(i, p), 0.25);
    }
    if (section !== "groove" || inSection >= 4) {
      for (let k = 0; k < 16; k++) s.shaker(drums, at(i, k / 4), k % 2 ? 0.7 : 1);
    }
    for (const p of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
      if (!half) s.hat(drums, at(i, p), p % 1 ? 0.55 : 0.3);
    }
    if (section === "chorus")
      for (const p of [0.5, 1.5, 2.5, 3.5]) s.hat(drums, at(i, p), 0.35, true);
    if (inSection === 7) {
      [3, 3.25, 3.5, 3.75].forEach((p, k) => s.snare(drums, at(i, p), 0.35 + k * 0.15));
      s.tom(drums, at(i, 2.5), 0.6, 180);
      s.tom(drums, at(i, 2.75), 0.6, 140);
    }
    if (inSection === 0 && section === "chorus") s.crash(drums, at(i, 0), 0.8);
    if (i === PLAY.length - 1) s.riser(drums, at(i, 0), bar, 0.6);

    // -- bass: root, octave bounce, fifth, root, chromatic approach into the next chord
    const root = bassNote(name, 36);
    const target = bassNote(next, 36);
    if (half) {
      s.pluckBass(music, at(i, 0), root, 1.8 * beat, 0.8);
      s.pluckBass(music, at(i, 2), root + 7, 1.8 * beat, 0.7);
    } else {
      s.pluckBass(music, at(i, 0), root, 0.9 * beat, 1);
      s.pluckBass(music, at(i, 1.5), root + 12, 0.35 * beat, 0.7);
      s.pluckBass(music, at(i, 2), root + 7, 0.8 * beat, 0.85);
      s.pluckBass(music, at(i, 3), root, 0.4 * beat, 0.75);
      s.pluckBass(music, at(i, 3.5), target + (target > root ? -1 : 1), 0.4 * beat, 0.7);
    }

    // -- electric piano: syncopated comping; held chords in the bridge
    const chordNotes = voicing(name, 58);
    if (section === "bridge") {
      for (const n of chordNotes) s.epiano(keys, at(i, 0), n, 3.6 * beat, 0.8);
      s.softPad(keys, at(i, 0), voicing(name, 53), 3.8 * beat, 1);
    } else {
      for (const [p, len, v] of [
        [0, 1, 0.9],
        [1.5, 0.4, 0.7],
        [2.5, 0.9, 0.8],
      ]) {
        for (const n of chordNotes) s.epiano(keys, at(i, p), n, len * beat, v);
      }
      if (section === "chorus") s.softPad(keys, at(i, 0), voicing(name, 60), 3.9 * beat, 0.8);
    }

    // -- marimba: a riff in the groove, eighths under the verse, sixteenths in the chorus
    const tones = voicing(name, 67);
    if (section === "groove") {
      const riff = [
        [0, 0],
        [0.5, 1],
        [1, 2],
        [1.75, 1],
        [2.5, 3 % tones.length],
        [3, 2],
        [3.5, 1],
      ];
      for (const [p, k] of riff) s.mallet(keys, at(i, p), tones[k % tones.length], 0.85);
    } else if (section === "verse") {
      for (let k = 0; k < 8; k++)
        s.mallet(keys, at(i, k / 2), tones[[0, 2, 1, 2][k % 4] % tones.length] + 12, 0.4);
    } else if (section === "chorus") {
      for (let k = 0; k < 16; k++)
        s.mallet(keys, at(i, k / 4), tones[[0, 1, 2, 3, 2, 1][k % 6] % tones.length] + 12, 0.32);
    } else {
      for (let k = 0; k < 8; k++)
        s.mallet(keys, at(i, k / 2), tones[[0, 1, 2, 3, 2, 1, 2, 3][k] % tones.length] + 12, 0.7);
      if (inSection % 2 === 0) s.bell(leadBus, at(i, 0), tones[tones.length - 1] + 12, 0.5);
    }

    // -- lead
    const line =
      section === "verse" ? VERSE[inSection] : section === "chorus" ? CHORUS[inSection] : null;
    if (line) {
      let prev = null;
      for (const [p, len, note] of line) {
        s.pulseLead(
          leadBus,
          at(i, p),
          note,
          len * beat * 0.92,
          0.9,
          prev !== null && Math.abs(prev - note) <= 2 ? prev : null,
        );
        if (section === "chorus") s.bell(leadBus, at(i, p), note + 12, 0.18, 0.6);
        prev = note;
      }
    }
  });
  s.duck(music.gain, kicks, { floor: 0.62, release: 0.18 });
}

function titleLoop(s, out, t0) {
  const beat = 60 / TITLE_BPM;
  const bar = 4 * beat;
  const at = (i, pos) => t0 + i * bar + pos * beat;
  const music = s.gain(out, 1);
  const room = s.reverb(out, { seconds: 2.4, decay: 0.7, wet: 0.3, bright: 0.45 });
  const echo = s.pingpong(out, { time: 0.75 * beat, feedback: 0.35, wet: 0.2, lp: 2600 });
  music.connect(room);
  const sparkle = s.gain(music, 1);
  sparkle.connect(echo);
  const chords = [...A, ...A];
  chords.forEach((name, i) => {
    s.softPad(music, at(i, 0), voicing(name, 55), 3.9 * beat, 1);
    for (const n of voicing(name, 60)) s.epiano(music, at(i, 0), n, 3.4 * beat, 0.55);
    const root = bassNote(name, 36);
    s.pluckBass(music, at(i, 0), root, 1.8 * beat, 0.55);
    s.pluckBass(music, at(i, 2), root + 7, 1.6 * beat, 0.45);
    const tones = voicing(name, 67);
    for (let k = 0; k < 8; k++)
      s.mallet(sparkle, at(i, k / 2), tones[[0, 1, 2, 1, 3, 2, 1, 2][k] % tones.length], 0.38);
    if (i >= 4) for (let k = 0; k < 8; k++) s.shaker(music, at(i, k / 2), k % 2 ? 0.45 : 0.7);
    if (i >= 8) {
      s.kick(music, at(i, 0), 0.45, { decay: 0.3, click: 0.2 });
      s.hat(music, at(i, 1), 0.4);
      s.hat(music, at(i, 3), 0.4);
      for (const [p, len, note] of VERSE[i - 8])
        if (len >= 1 || p % 1 === 0) s.bell(sparkle, at(i, p), note + 12, 0.32, 1.1);
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

export default {
  samples: {
    plank: "../audio/sources/kenney-impact-sounds/impactPlank_medium_000.ogg",
    soft: "../audio/sources/kenney-impact-sounds/impactSoft_medium_000.ogg",
    click: "../audio/sources/kenney-interface-sounds/click_002.ogg",
  },
  cues: {
    "music-loop": {
      file: "audio/music-loop.ogg",
      format: "opus",
      loop: true,
      seconds: (32 * 4 * 60) / PLAY_BPM,
      bitrate: 128000,
      seed: 11,
      master: { threshold: -16, ratio: 3, makeup: 1.5, low: -3, presence: 3, high: 8 },
      build: playLoop,
    },
    "music-title": {
      file: "audio/music-title.ogg",
      format: "opus",
      loop: true,
      seconds: (16 * 4 * 60) / TITLE_BPM,
      bitrate: 112000,
      seed: 12,
      master: { threshold: -20, ratio: 2.5, makeup: 1.4, low: -3, presence: 3, high: 7 },
      build: titleLoop,
    },

    // A piece landing: a wooden knock (recorded), a soft body thump and a short sub drop.
    "sfx-drop": sfx(
      (s, out, t) => {
        s.sample("plank", t, out, { gain: 0.9, rate: 0.92 });
        s.sample("soft", t, out, { gain: 0.6 });
        s.kick(out, t, 0.7, { pitch: 140, low: 55, decay: 0.16, click: 0.15 });
      },
      0.5,
      { uses: ["plank", "soft"], seed: 21 },
    ),

    // Two towers becoming one: a bubbly pop tuned to F4 (the game pitches it up the scale).
    "sfx-merge": sfx(
      (s, out, t) => {
        const g = s.gain(out, 0);
        s.hit(g.gain, t, 0.9, 0.22, 0.002);
        const body = s.osc("sine", 175, t, t + 0.3, g);
        body.frequency.exponentialRampToValueAtTime(349.2, t + 0.035);
        const h = s.gain(out, 0);
        s.hit(h.gain, t, 0.35, 0.09, 0.002);
        const ring = s.osc("sine", 350, t, t + 0.2, h);
        ring.frequency.exponentialRampToValueAtTime(698.5, t + 0.03);
        const c = s.gain(out, 0);
        s.hit(c.gain, t, 0.4, 0.014);
        s.noiseSource(t, 0.03, s.filter(c, "bandpass", 3200, 1.5));
        s.mallet(out, t + 0.012, 77, 0.55, 0.3);
      },
      0.45,
      { seed: 22 },
    ),

    // A cascade: a fast rising F major arpeggio into a bell chord, a swish up under it.
    "sfx-combo": sfx(
      (s, out, t) => {
        const room = s.reverb(out, { seconds: 1.0, decay: 0.3, wet: 0.25 });
        [77, 81, 84, 89].forEach((n, k) => {
          s.mallet(out, t + k * 0.065, n, 0.9, 0.4);
          s.mallet(room, t + k * 0.065, n, 0.4);
        });
        for (const n of [89, 93, 96]) {
          s.bell(out, t + 0.26, n, 0.6, 0.9);
          s.bell(room, t + 0.26, n, 0.4);
        }
        s.riser(out, t, 0.26, 0.5);
      },
      1.1,
      { seed: 23 },
    ),

    // The run is over: a playful falling "wah-wah" (C - Bb - A, then a wobbling G) on a muted
    // brass with a mallet double, and a soft thump.
    "sfx-game-over": sfx(
      (s, out, t) => {
        const room = s.reverb(out, { seconds: 1.4, decay: 0.4, wet: 0.22 });
        const notes = [
          [0, 0.24, 72],
          [0.28, 0.24, 70],
          [0.56, 0.24, 69],
          [0.84, 0.95, 67],
        ];
        for (const [p, len, n] of notes) {
          s.brass(out, t + p, [n - 12, n], len, 0.9);
          s.brass(room, t + p, [n], len, 0.5);
          s.pulseLead(out, t + p, n, len, 0.5);
          s.mallet(out, t + p, n + 12, 0.35, 0.3);
        }
        s.tom(out, t + 0.84, 0.5, 98);
      },
      2.1,
      { seed: 24 },
    ),

    // A reward granted: a quick roll of bells up an F major triad, shimmering.
    "sfx-reward": sfx(
      (s, out, t) => {
        const room = s.reverb(out, { seconds: 1.8, decay: 0.55, wet: 0.35 });
        [89, 93, 96, 101].forEach((n, k) => {
          s.bell(out, t + k * 0.05, n, 0.7, 1.2);
          s.bell(room, t + k * 0.05, n, 0.5, 1.2);
        });
        s.softPad(out, t, [65, 69, 72, 77], 0.5, 1.2);
      },
      1.6,
      { seed: 25 },
    ),

    // A new best: two short brass stabs and a held F major chord, a bell on top.
    "ui-fanfare": sfx(
      (s, out, t) => {
        const room = s.reverb(out, { seconds: 1.6, decay: 0.45, wet: 0.28 });
        for (const [p, len, chordNotes] of [
          [0, 0.13, [65, 69, 72]],
          [0.17, 0.13, [65, 69, 72]],
          [0.36, 0.13, [67, 70, 74]],
          [0.52, 0.9, [65, 69, 72, 77]],
        ]) {
          s.brass(out, t + p, chordNotes, len, 1);
          s.brass(room, t + p, chordNotes, len, 0.5);
        }
        s.bell(out, t + 0.52, 89, 0.6, 1.2);
        s.kick(out, t + 0.52, 0.5, { decay: 0.25 });
        s.crash(out, t + 0.52, 0.4);
      },
      1.8,
      { seed: 26 },
    ),

    // A button: Kenney's click with a quiet tuned tick so it belongs to the score.
    "ui-tap": sfx(
      (s, out, t) => {
        s.sample("click", t, out, { gain: 0.9 });
        const g = s.gain(out, 0);
        s.hit(g.gain, t, 0.12, 0.04);
        s.osc("sine", 1396.9, t, t + 0.06, g);
      },
      0.25,
      { uses: ["click"], seed: 27 },
    ),
  },
};
