// The page side of render.mjs: renders one cue of a score in an OfflineAudioContext, encodes
// it (16-bit WAV, or Opus packets through WebCodecs' AudioEncoder for render.mjs to put in an
// Ogg container), and measures any audio file the browser can decode.
//
// Authored for web-game-template's golden reference ports. CC0-1.0.
/* global window, location, URL, URLSearchParams, OfflineAudioContext, AudioEncoder, AudioData, atob, btoa */

import { Studio, rng } from "./synth.js";

const params = new URLSearchParams(location.search);
const score = (await import(params.get("score"))).default;
const rendered = {};

const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

window.cues = () =>
  Object.entries(score.cues).map(([id, c]) => ({
    id,
    file: c.file || `audio/${id}.${c.format === "opus" ? "ogg" : "wav"}`,
    format: c.format,
    seconds: c.seconds,
    loop: Boolean(c.loop),
    group: c.group || null,
    channels: c.channels || 2,
    rms: c.rms ?? (c.format === "opus" ? -16 : null),
  }));

/** Render a cue; keep its samples in the page. Returns its raw peak. */
window.render = async (id) => {
  const cue = score.cues[id];
  const sr = cue.format === "opus" ? 48000 : cue.sampleRate || 44100;
  const channels = cue.channels || 2;
  const length = cue.loop ? 2 * cue.seconds : cue.seconds + (cue.tail ?? 0.5);
  const ctx = new OfflineAudioContext(channels, Math.ceil(length * sr), sr);
  const studio = new Studio(ctx, cue.seed || 1);
  const samples = {};
  for (const [name, rel] of Object.entries(score.samples || {})) {
    if (!cue.uses || cue.uses.includes(name))
      samples[name] = new URL(rel, params.get("score")).href;
  }
  await studio.load(samples);
  const out = studio.master(ctx.destination, cue.master || {});
  const queue = defer(studio);
  if (cue.loop) {
    // Two passes: the second starts with the first's reverb and delay tails, exactly what
    // its own end leads into - so the second pass, cut out, loops without a seam.
    cue.build(studio, out, 0, { pass: 0 });
    cue.build(studio, out, cue.seconds, { pass: 1 });
  } else {
    cue.build(studio, out, 0, {});
  }
  const buffer = await play(ctx, queue, length);
  const n = Math.round(cue.seconds * sr);
  let data = [];
  for (let c = 0; c < channels; c++) {
    const all = buffer.getChannelData(c);
    data.push(cue.loop ? all.slice(n, 2 * n) : all.slice(0, all.length));
  }
  if (!cue.loop) data = trim(data, sr, cue.seconds);
  let peak = 0,
    sum = 0;
  for (const ch of data)
    for (let i = 0; i < ch.length; i++) {
      peak = Math.max(peak, Math.abs(ch[i]));
      sum += ch[i] * ch[i];
    }
  rendered[id] = { data, sr, cue };
  return {
    peak,
    rms: Math.sqrt(sum / (data.length * data[0].length)),
    frames: data[0].length,
    sampleRate: sr,
  };
};

// Every instrument call takes its start time as its second argument. Calls are queued, not
// played: a minute of music is thousands of nodes, and a graph that holds them all from the
// first render quantum is visited whole every quantum. play() creates each note's nodes just
// before it sounds, half a second at a time, so finished ones are collected.
const INSTRUMENTS = [
  "kick",
  "snare",
  "clap",
  "hat",
  "shaker",
  "tom",
  "crash",
  "riser",
  "pluckBass",
  "sawBass",
  "epiano",
  "mallet",
  "bell",
  "pulseLead",
  "pad",
  "softPad",
  "arp",
  "sawLead",
  "brass",
  "sample",
];

function defer(studio) {
  const queue = [];
  for (const name of INSTRUMENTS) {
    const real = studio[name].bind(studio);
    studio[name] = (...args) => {
      queue.push([args[1], () => real(...args)]);
    };
  }
  return queue;
}

async function play(ctx, queue, length) {
  const block = 0.5;
  queue.sort((a, b) => a[0] - b[0]);
  let next = 0;
  const run = (until) => {
    while (next < queue.length && queue[next][0] < until) queue[next++][1]();
  };
  run(block);
  for (let k = 1; k * block < length; k++) {
    const at = k * block;
    ctx.suspend(at).then(() => {
      run(at + block);
      ctx.resume();
    });
  }
  return ctx.startRendering();
}

/** A one-shot: cut after the last sample above -60 dBFS (capped at `max` s), fade the end. */
function trim(data, sr, max) {
  let last = 0;
  const floor = Math.pow(10, -60 / 20);
  for (const ch of data) {
    for (let i = ch.length - 1; i > last; i--) {
      if (Math.abs(ch[i]) > floor) {
        last = i;
        break;
      }
    }
  }
  const end = Math.min(last + Math.round(0.02 * sr), Math.round(max * sr), data[0].length);
  const fade = Math.round(0.01 * sr);
  return data.map((ch) => {
    const out = ch.slice(0, end);
    for (let i = 0; i < fade && i < out.length; i++) out[out.length - 1 - i] *= i / fade;
    return out;
  });
}

/** Scale a rendered cue by `gain` and encode it. WAV: base64 bytes; Opus: base64 packets. */
window.finish = async (id, gain) => {
  const { data, sr, cue } = rendered[id];
  const scaled = data.map((ch) => ch.map((v) => v * gain));
  if (cue.format === "wav") return { wav: b64(wav(scaled, sr, cue.seed || 1)) };
  const opus = await encodeOpus(scaled, cue);
  return { ...opus, packets: opus.packets.map(b64) };
};

function wav(channels, sr, seed) {
  const n = channels[0].length;
  const ch = channels.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(bytes.buffer);
  const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + n * ch * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * ch * 2, true);
  const dither = rng(seed * 31 + 7);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const tpdf = (dither() - dither()) / 32768;
      const s = Math.max(-1, Math.min(1, channels[c][i] + tpdf));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return bytes;
}

/**
 * Opus packets of the samples (48 kHz). A loop is encoded with 80 ms of its own end in front
 * and its start behind, and the Ogg pre-skip covers the encoder delay plus that pre-roll: the
 * decoder starts on the music that really precedes the loop point, and the end trim (the last
 * page's granule) cuts exactly at the loop length - so a looped buffer has no seam.
 */
async function encodeOpus(channels, cue) {
  const n = channels[0].length;
  const ch = channels.length;
  const preroll = cue.loop ? 3840 : 0;
  const tail = 960 * 6;
  const input = channels.map((c) => {
    const out = new Float32Array(preroll + n + tail);
    if (cue.loop) {
      out.set(c.subarray(n - preroll), 0);
      out.set(c, preroll);
      out.set(c.subarray(0, tail), preroll + n);
    } else {
      out.set(c, 0);
    }
    return out;
  });
  const packets = [];
  let config = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta && meta.decoderConfig) config = meta.decoderConfig;
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      packets.push({ bytes, duration: chunk.duration, timestamp: chunk.timestamp });
    },
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({
    codec: "opus",
    sampleRate: 48000,
    numberOfChannels: ch,
    bitrate: cue.bitrate || (ch === 2 ? 128000 : 64000),
    opus: { frameDuration: 20000, complexity: 10, application: "audio" },
  });
  const block = 4800;
  const total = input[0].length;
  for (let start = 0; start < total; start += block) {
    const frames = Math.min(block, total - start);
    const planar = new Float32Array(frames * ch);
    for (let c = 0; c < ch; c++) planar.set(input[c].subarray(start, start + frames), c * frames);
    encoder.encode(
      new AudioData({
        format: "f32-planar",
        sampleRate: 48000,
        numberOfFrames: frames,
        numberOfChannels: ch,
        timestamp: Math.round((start / 48000) * 1e6),
        data: planar,
      }),
    );
  }
  await encoder.flush();
  encoder.close();
  let delay = 312;
  const desc = config && config.description ? new Uint8Array(config.description) : null;
  if (desc && desc.length >= 12 && String.fromCharCode(...desc.subarray(0, 8)) === "OpusHead") {
    delay = desc[10] | (desc[11] << 8);
  }
  return {
    packets: packets.map((p) => p.bytes),
    packetSamples: packets.map((p) => Math.round(p.duration * 0.048)),
    preskip: delay + preroll,
    samples: n,
    channels: ch,
    encoderDelay: delay,
    description: desc ? Array.from(desc) : null,
  };
}

/**
 * Decode any audio file and measure it: duration, channels, sample rate, RMS and peak (dBFS),
 * the quietest and loudest one-second windows, and the loop seam - the jump from the last
 * sample to the first against the signal's typical sample-to-sample step.
 */
window.analyse = async (base64, expectFrames) => {
  const bytes = unb64(base64);
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  const buffer = await ctx.decodeAudioData(bytes.buffer);
  const n = buffer.length;
  let sum = 0,
    peak = 0,
    jump = 0,
    step = 0;
  const win = buffer.sampleRate;
  const windows = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      sum += d[i] * d[i];
      peak = Math.max(peak, Math.abs(d[i]));
    }
    jump = Math.max(jump, Math.abs(d[n - 1] - d[0]));
    let steps = 0;
    for (let i = 1; i < n; i += 7) steps += Math.abs(d[i] - d[i - 1]);
    step = Math.max(step, steps / Math.floor(n / 7));
    for (let w = 0, k = 0; w + win <= n; w += win, k++) {
      let s = 0;
      for (let i = w; i < w + win; i++) s += d[i] * d[i];
      windows[k] = (windows[k] || 0) + s / win / buffer.numberOfChannels;
    }
  }
  const rms = Math.sqrt(sum / (n * buffer.numberOfChannels));
  const wdb = windows.map((x) => db(Math.sqrt(x)));
  return {
    duration_s: +(n / buffer.sampleRate).toFixed(4),
    frames: n,
    channels: buffer.numberOfChannels,
    sample_rate: buffer.sampleRate,
    rms_dbfs: +db(rms).toFixed(2),
    peak_dbfs: +db(peak).toFixed(2),
    quietest_second_dbfs: wdb.length ? +Math.min(...wdb).toFixed(2) : null,
    loudest_second_dbfs: wdb.length ? +Math.max(...wdb).toFixed(2) : null,
    seam_jump: +jump.toFixed(5),
    typical_step: +step.toFixed(5),
    seam_ratio: step > 0 ? +(jump / step).toFixed(2) : null,
    expected_frames: expectFrames ?? null,
  };
};

window.ready = true;
