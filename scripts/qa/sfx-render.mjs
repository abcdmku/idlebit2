// Renders every sound effect of src/platform/sfx.ts to WAV and measures it (dev server, headless Chrome).
// Nobody can listen in CI, so this makes the effects inspectable: the page imports the real module and
// schedules its voices (scheduleVoice, fadeMaster) into an OfflineAudioContext behind the same master gain.
//
//   node scripts/qa/sfx-render.mjs [--out=artifacts/qa/sfx] [--base=http://127.0.0.1:6174/]
//
// Writes one WAV per effect at the default volume, the worst-case mixes, the master fade cases, and
// report.json / report.md with duration, peak, RMS, measured fundamentals, clipping and audibility.
// Exits 1 when anything clips, is too quiet at the default volume, or a master change steps.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchChrome } from './cdp.mjs';
import { writeArtifact } from './files.mjs';

const option = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = option('base', 'http://127.0.0.1:6174/'), out = path.resolve(option('out', 'artifacts/qa/sfx'));
const RATE = 48_000;
/** Quieter than this (RMS while sounding, dBFS) at the default volume is flagged. */
const QUIET_DB = -34;
mkdirSync(out, { recursive: true });

// Runs in the page. Returns each render as base64 float32 plus the note list it was made from.
const pageScript = `(async () => {
  const sfx = await import('/src/platform/sfx.ts');
  const RATE = ${RATE}, T0 = 0.01;
  const b64 = f32 => { const u = new Uint8Array(f32.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const length = v => Math.max(...v.notes.map(n => n[1] + n[2]));
  const render = async (seconds, volume, build) => {
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE), master = ctx.createGain();
    master.gain.value = volume / 100 * sfx.MASTER; master.connect(ctx.destination);
    build(ctx, master);
    return b64((await ctx.startRendering()).getChannelData(0));
  };
  const one = (name, voice, volume) => render(length(voice) + 0.05, volume, (ctx, m) => sfx.scheduleVoice(ctx, m, voice, T0))
    .then(pcm => ({ name, volume, wave: voice.wave, level: voice.level, notes: voice.notes.map(n => [n[0], T0 + n[1], n[2]]), pcm }));
  const volume = sfx.DEFAULT_SFX.volume, out = [], voices = { ...sfx.VOICES };
  sfx.MET_HZ.forEach((hz, i) => { voices['met-' + hz] = sfx.metVoice(10 ** (i * 3)); });
  for (const [name, voice] of Object.entries(voices)) for (const v of [volume, 100]) out.push({ kind: 'effect', ...(await one(name, voice, v)) });
  // Worst case: the payout blip at its rate limit (${'${sfx.MET_GAP_MS}'} ms) for 2 s, with every other effect starting on the first blip
  // and the failure sound at its own limit.
  const others = Object.values(sfx.VOICES), met = sfx.metVoice(1e12);
  for (const v of [volume, 100]) out.push({ kind: 'mix', name: 'met-4-per-second+all', volume: v, notes: [], pcm: await render(2.2, v, (ctx, m) => {
    for (let t = 0; t < 2; t += sfx.MET_GAP_MS / 1000) sfx.scheduleVoice(ctx, m, met, T0 + t);
    for (let t = 0; t < 2; t += sfx.FAIL_GAP_MS / 1000) sfx.scheduleVoice(ctx, m, sfx.VOICES.failed, T0 + t);
    for (const voice of others) if (voice !== sfx.VOICES.failed) sfx.scheduleVoice(ctx, m, voice, T0);
  }) });
  for (const v of [volume, 100]) out.push({ kind: 'mix', name: 'met-4-per-second', volume: v, notes: [], pcm: await render(2.2, v, (ctx, m) => {
    for (let t = 0; t < 2; t += sfx.MET_GAP_MS / 1000) sfx.scheduleVoice(ctx, m, met, T0 + t);
  }) });
  // Master changes while a tone sounds. A constant source through the same master shows the gain curve itself.
  const fade = async (name, from, to, legacy) => ({ kind: 'fade', name, volume: from, to, legacy, notes: [], pcm: await render(0.2, from, (ctx, m) => {
    const dc = ctx.createConstantSource(); dc.offset.value = 1; dc.connect(m); dc.start(0);
    // The old engine wrote gain.value directly; kept here as the baseline the fade replaced.
    if (legacy) m.gain.setValueAtTime(to / 100 * sfx.MASTER, 0.05); else ctx.suspend(0.05).then(() => { sfx.fadeMaster(m, to / 100 * sfx.MASTER, ctx.currentTime); ctx.resume(); });
  }) });
  out.push(await fade('master-mute', volume, 0, false), await fade('master-unmute', 0, volume, false), await fade('master-volume-40-100', 40, 100, false), await fade('master-mute-legacy-step', volume, 0, true));
  return { master: sfx.MASTER, defaultVolume: volume, metGapMs: sfx.MET_GAP_MS, failGapMs: sfx.FAIL_GAP_MS, renders: out };
})()`;

const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const round = (x, n = 4) => (Number.isFinite(x) ? Number(x.toFixed(n)) : null);
function wav(samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return data;
}
/** Fundamental of one note window from its positive-going zero crossings (interpolated). */
function fundamental(x, from, to) {
  const a = Math.floor(from * RATE), b = Math.min(x.length - 1, Math.floor(to * RATE)), at = [];
  for (let i = a + 1; i <= b; i++) if (x[i - 1] < 0 && x[i] >= 0) at.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  return at.length < 2 ? null : (at.length - 1) / ((at.at(-1) - at[0]) / RATE);
}
function measure(r, stepFromS = 0) {
  const bytes = Buffer.from(r.pcm, 'base64'), x = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  let peak = 0, first = -1, last = -1, step = 0, stepAt = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]); if (v > peak) peak = v;
    if (v > 1e-4) { if (first < 0) first = i; last = i; }
    const d = Math.abs(x[i] - (i ? x[i - 1] : 0)); if (i >= stepFromS * RATE && d > step) { step = d; stepAt = i; }
  }
  let sum = 0; for (let i = Math.max(0, first); i <= last; i++) sum += x[i] * x[i];
  const rms = last > first ? Math.sqrt(sum / (last - first + 1)) : 0;
  return { x, peak, rms, durationS: last >= 0 ? (last - first + 1) / RATE : 0, startS: first / RATE, maxStep: step, maxStepAtS: stepAt / RATE,
    fundamentals: r.notes.map(([hz, at, length]) => ({ wantHz: hz, gotHz: round(fundamental(x, at + 0.008, at + length - 0.012), 1) })) };
}

const browser = await launchChrome(option('chrome', process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'));
let data;
try {
  await browser.send('Page.enable');
  // Any document on the dev server's origin can import its modules; the module itself keeps the game out of it.
  await browser.send('Page.navigate', { url: new URL('src/platform/sfx.ts', base).href });
  for (let i = 0; i < 50 && await browser.evaluate('document.readyState') !== 'complete'; i++) await new Promise(r => setTimeout(r, 100));
  data = await browser.evaluate(pageScript);
} finally { await browser.close(); }

const rows = [], problems = [];
for (const r of data.renders) {
  // A fade case starts its constant source at time 0: only moves after that count.
  const m = measure(r, r.kind === 'fade' ? 0.01 : 0), file = `${r.name}${r.kind === 'fade' ? '' : `-vol${r.volume}`}.wav`;
  writeArtifact(path.join(out, file), wav(m.x));
  const row = { kind: r.kind, name: r.name, volume: r.volume, file, wave: r.wave ?? null, durationMs: round(m.durationS * 1000, 1), peak: round(m.peak), peakDb: round(db(m.peak), 1),
    rms: round(m.rms), rmsDb: round(db(m.rms), 1), fundamentals: m.fundamentals, clips: m.peak >= 1, maxStep: round(m.maxStep), maxStepAtS: round(m.maxStepAtS) };
  if (r.kind !== 'fade') {
    row.quiet = r.kind === 'effect' && r.volume === data.defaultVolume && db(m.rms) < QUIET_DB;
    if (row.clips) problems.push(`${file}: clips (peak ${row.peak})`);
    if (row.quiet) problems.push(`${file}: quiet at the default volume (${row.rmsDb} dBFS RMS)`);
    for (const f of m.fundamentals) if (f.gotHz === null || Math.abs(f.gotHz - f.wantHz) / f.wantHz > 0.02) problems.push(`${file}: note ${f.wantHz} Hz measured ${f.gotHz} Hz`);
  } else {
    // The gain curve of a master change. A step is one sample moving most of the way; a fade moves a little per sample.
    const span = Math.abs(r.volume - r.to) / 100 * data.master;
    row.stepShare = round(m.maxStep / span, 3); row.steps = row.stepShare > 0.05;
    if (row.steps && !r.legacy) problems.push(`${file}: the master gain steps (${row.stepShare} of the change in one sample)`);
  }
  rows.push(row);
}
const md = ['# Sound effects, rendered offline', '', `Master ${data.master}; default volume ${data.defaultVolume}%; payout blips at most every ${data.metGapMs} ms, failures every ${data.failGapMs} ms. ${RATE} Hz mono.`, '',
  '| File | Wave | Duration | Peak | RMS | Fundamentals (Hz, measured) | Clips | Quiet |', '|---|---|---:|---:|---:|---|---|---|',
  ...rows.filter(r => r.kind !== 'fade').map(r => `| ${r.file} | ${r.wave ?? 'mix'} | ${r.durationMs} ms | ${r.peak} (${r.peakDb} dB) | ${r.rms} (${r.rmsDb} dB) | ${r.fundamentals.map(f => f.gotHz).join(', ') || '-'} | ${r.clips ? 'YES' : 'no'} | ${r.quiet ? 'YES' : 'no'} |`),
  '', '| Master change | Largest one-sample move, share of the change | Steps |', '|---|---:|---|',
  ...rows.filter(r => r.kind === 'fade').map(r => `| ${r.file} | ${r.stepShare} | ${r.steps ? 'YES' : 'no'} |`),
  '', problems.length ? `Problems:\n${problems.map(p => `- ${p}`).join('\n')}` : 'No clipping, nothing quiet at the default volume, every note on pitch, no master step.', ''].join('\n');
writeArtifact(path.join(out, 'report.json'), JSON.stringify({ ...data, renders: undefined, rows, problems }, null, 1) + '\n');
writeArtifact(path.join(out, 'report.md'), md);
console.log(md);
if (problems.length) process.exitCode = 1;
