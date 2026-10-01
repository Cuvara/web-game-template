#!/usr/bin/env node
// Render a reference port's music and sound effects from its score.
//
//   node examples/wgf-golden-shared/library/tools/audio/render.mjs <library dir> [cue id ...]
//
// Run from a template checkout with its dependencies installed (it uses the template's own
// Playwright Chromium; nothing is added to package.json). The library's tools/audio-score.js
// says what to render; each cue is rendered in an OfflineAudioContext in headless Chromium
// (page.js, synth.js), normalized, and written under the library: one-shots as 16-bit PCM
// WAV, music as Ogg Opus (WebCodecs' encoder, muxed here into an Ogg container per RFC 7845).
// Every written file is decoded again by the browser and measured - duration, RMS, peak, the
// loop seam - into <library>/audio/render-report.json.
//
// Authored for web-game-template's golden reference ports. CC0-1.0.
/* global Buffer, URL, console, process, window */
/* eslint-disable no-console -- a command-line tool reports to stdout */

import { createServer } from "node:http";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, "../../../..");
const library = path.resolve(process.argv[2] || "");
const only = process.argv.slice(3);
if (!fs.existsSync(path.join(library, "tools", "audio-score.js"))) {
  console.error(`usage: render.mjs <library dir with tools/audio-score.js> [cue ...]`);
  process.exit(2);
}
const { chromium } = createRequire(path.join(process.cwd(), "/"))("@playwright/test");

const TYPES = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(examples, decodeURIComponent(url.pathname));
  if (!file.startsWith(examples) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${server.address().port}`;
const rel = (p) => "/" + path.relative(examples, p).split(path.sep).join("/");

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.error("page:", m.text());
});
page.on("pageerror", (e) => console.error("page error:", e.message));
fs.writeFileSync(
  path.join(here, ".page.html"),
  `<!doctype html><meta charset="utf-8"><script type="module" src="./page.js"></script>`,
);
const score = `${origin}${rel(path.join(library, "tools", "audio-score.js"))}`;
await page.goto(
  `${origin}${rel(path.join(here, ".page.html"))}?score=${encodeURIComponent(score)}`,
);
await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });

const cues = (await page.evaluate(() => window.cues())).filter(
  (c) => !only.length || only.includes(c.id),
);
const reportPath = path.join(library, "audio", "render-report.json");
const report = fs.existsSync(reportPath)
  ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
  : { files: {} };
const TARGET_PEAK = Math.pow(10, -1 / 20); // -1 dBFS

const raw = {};
for (const cue of cues) {
  const t0 = Date.now();
  raw[cue.id] = await page.evaluate((id) => window.render(id), cue.id);
  console.log(
    `rendered ${cue.id} in ${((Date.now() - t0) / 1000).toFixed(1)} s (peak ${raw[cue.id].peak.toFixed(3)})`,
  );
}
// One gain per group: stems of one piece keep the balance they were mixed at.
// Music is levelled to its RMS target (-16 dBFS unless the cue says otherwise), never above
// a -1 dBFS peak; a one-shot is peak-normalized - the game mixes cues by its own gains.
const groupGain = {};
for (const cue of cues) {
  const key = cue.group || cue.id;
  const r = raw[cue.id];
  let gain = TARGET_PEAK / Math.max(r.peak, 1e-6);
  if (cue.rms !== null) gain = Math.min(gain, Math.pow(10, cue.rms / 20) / Math.max(r.rms, 1e-9));
  groupGain[key] = Math.min(groupGain[key] ?? Infinity, gain);
}

for (const cue of cues) {
  const gain = groupGain[cue.group || cue.id];
  const out = await page.evaluate(([id, g]) => window.finish(id, g), [cue.id, gain]);
  const target = path.join(library, cue.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let bytes;
  if (out.wav) {
    bytes = Buffer.from(out.wav, "base64");
  } else {
    bytes = oggOpus(out, { title: cue.id, loop: cue.loop });
  }
  fs.writeFileSync(target, bytes);
  const stats = await page.evaluate(
    ([b, f]) => window.analyse(b, f),
    [bytes.toString("base64"), raw[cue.id].frames],
  );
  stats.bytes = bytes.length;
  stats.file = cue.file;
  stats.format = cue.format === "opus" ? "ogg (opus)" : "wav (pcm s16le)";
  stats.loop = cue.loop;
  stats.gain_db = +(20 * Math.log10(gain)).toFixed(2);
  if (out.preskip !== undefined)
    stats.opus = { preskip: out.preskip, encoder_delay: out.encoderDelay };
  report.files[cue.id] = stats;
  console.log(
    `  ${cue.file}: ${stats.duration_s}s ${stats.channels}ch rms ${stats.rms_dbfs} peak ${stats.peak_dbfs} dBFS` +
      (cue.loop ? ` seam ${stats.seam_ratio}x step` : "") +
      ` ${bytes.length} B`,
  );
}
report.generator = "examples/wgf-golden-shared/library/tools/audio/render.mjs";
report.browser = browser.version();
report.files = Object.fromEntries(Object.entries(report.files).sort());
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
fs.rmSync(path.join(here, ".page.html"), { force: true });
await browser.close();
server.close();

// -- Ogg Opus (RFC 7845) ------------------------------------------------------------------------

function crcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
}
var CRC; // hoisted: the main body above runs before this line is reached
function crc(bytes) {
  CRC = CRC || crcTable();
  let c = 0;
  for (const b of bytes) c = ((c << 8) ^ CRC[((c >>> 24) ^ b) & 0xff]) >>> 0;
  return c >>> 0;
}

function page_(serial, sequence, granule, flags, packets) {
  const lacing = [];
  for (const p of packets) {
    let len = p.length;
    while (len >= 255) {
      lacing.push(255);
      len -= 255;
    }
    lacing.push(len);
  }
  const header = Buffer.alloc(27 + lacing.length);
  header.write("OggS", 0, "latin1");
  header[4] = 0;
  header[5] = flags;
  header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(sequence, 18);
  header.writeUInt32LE(0, 22);
  header[26] = lacing.length;
  Buffer.from(lacing).copy(header, 27);
  const pageBytes = Buffer.concat([header, ...packets.map((p) => Buffer.from(p))]);
  pageBytes.writeUInt32LE(crc(pageBytes), 22);
  return pageBytes;
}

function oggOpus(out, { title, loop }) {
  const serial = 0x57474641; // "WGFA"
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1");
  head[8] = 1;
  head[9] = out.channels;
  head.writeUInt16LE(out.preskip, 10);
  head.writeUInt32LE(48000, 12);
  head.writeInt16LE(0, 16);
  head[18] = 0;
  const vendor = Buffer.from("wgf-golden render.mjs (Chromium WebCodecs libopus)");
  const comments = [`TITLE=${title}`, "LICENSE=CC0-1.0", ...(loop ? ["WGF_LOOP=1"] : [])].map((c) =>
    Buffer.from(c),
  );
  const tags = Buffer.concat([
    Buffer.from("OpusTags", "latin1"),
    u32(vendor.length),
    vendor,
    u32(comments.length),
    ...comments.flatMap((c) => [u32(c.length), c]),
  ]);
  const pages = [page_(serial, 0, 0, 0x02, [head]), page_(serial, 1, 0, 0, [tags])];
  const packets = out.packets.map((p) => Buffer.from(p, "base64"));
  const end = out.preskip + out.samples;
  let granule = 0,
    sequence = 2,
    batch = [],
    segments = 0;
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    const need = Math.floor(p.length / 255) + 1;
    if (segments + need > 255 || batch.length >= 50) {
      pages.push(page_(serial, sequence++, Math.min(granule, end), 0, batch));
      batch = [];
      segments = 0;
    }
    batch.push(p);
    segments += need;
    granule += out.packetSamples[i] || 960;
    if (granule >= end) {
      // Everything past the end trim is padding the encoder flushed; the last page's granule
      // tells the decoder where the real samples stop.
      pages.push(page_(serial, sequence++, end, 0x04, batch));
      batch = [];
      break;
    }
  }
  if (batch.length) pages.push(page_(serial, sequence++, end, 0x04, batch));
  return Buffer.concat(pages);
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}
