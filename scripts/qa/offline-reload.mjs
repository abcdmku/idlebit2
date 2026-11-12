// Reload in the middle of a capped offline catch-up (dev server, headless Chrome).
// The absence must resume under the same cap: total credit stays at the cap, the plate continues
// from the checkpoint and the report still says how long the player was away.
//
//   node scripts/qa/offline-reload.mjs --stage=<stage.json> [--away-hours=13] [--out=artifacts/qa/offline-reload]
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { launchChrome, sleep } from './cdp.mjs';
import { controlledClock } from './clock.mjs';
import { writeArtifact } from './files.mjs';

const option = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = option('base', 'http://127.0.0.1:6174/'), out = path.resolve(option('out', 'artifacts/qa/offline-reload'));
const stage = option('stage', 'artifacts/qa/stages/room.json'), awayMs = Number(option('away-hours', '13')) * 3_600_000;
const saved = JSON.parse(readFileSync(stage, 'utf8')).save, stageTick = JSON.parse(saved).state.clock.tick;
mkdirSync(out, { recursive: true });
const browser = await launchChrome(option('chrome', process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'));
const ev = browser.evaluate, result = { stage, awayMs, stageTick, checks: [] };
const check = (name, ok, detail) => { result.checks.push({ name, ok, detail }); console.log(`${ok ? 'pass' : 'FAIL'} ${name}${detail === undefined ? '' : ' · ' + JSON.stringify(detail)}`); };
const shot = async name => writeArtifact(path.join(out, `${name}.png`), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const stored = () => ev(`(() => { const e = JSON.parse(localStorage.getItem('idlebit2:save-v3')); return { savedAtMs: e.savedAtMs, absence: e.absence ?? null, tick: JSON.parse(e.save).state.clock.tick }; })()`);
try {
  for (const domain of ['Page', 'Runtime']) await browser.send(`${domain}.enable`);
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: false });
  const clock = controlledClock(42);
  const restore = `localStorage.setItem('idlebit2:save-v3', JSON.stringify({ savedAtMs: Date.now() - ${awayMs}, save: ${JSON.stringify(saved)} }));`;
  let script = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: clock + restore })).identifier;
  await browser.send('Page.navigate', { url: base });
  const bridge = async () => { for (let i = 0; i < 200 && !await ev('Boolean(window.__br?.getLifecycle && window.__qaTick)').catch(() => false); i++) await sleep(100); };
  await bridge();
  // Tick until a checkpoint with credited time is in storage while the catch-up still runs.
  let mid = null;
  for (let i = 0; i < 20000; i++) {
    await ev('window.__qaTick(2500)');
    const s = await stored().catch(() => null), life = await ev('window.__br.getLifecycle().catchingUp');
    if (s?.absence?.creditedMs > 0 && life) { mid = { ...s, catchUp: await ev('window.__br.getCatchUp()') }; break; }
    if (await ev('window.__br.bootStatus') === 'ready') break;
    await sleep(2);
  }
  check('a checkpoint landed mid-catch-up', mid !== null, mid);
  if (!mid) throw new Error('The catch-up finished before a checkpoint; use a larger stage');
  await shot('before-reload');
  // Reload without restoring the stage: the page reads its own checkpoint.
  await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
  script = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: clock })).identifier;
  await browser.send('Page.navigate', { url: base });
  await bridge();
  let resumed = null;
  for (let i = 0; i < 20000; i++) {
    const status = await ev('window.__qaTick(50), window.__br.bootStatus');
    const c = await ev('window.__br.getCatchUp()');
    if (c && !resumed) { resumed = c; await sleep(150); await ev('window.__qaTick(50)'); await shot('resumed-plate'); }
    if (status === 'ready') break;
    await sleep(2);
  }
  await ev('window.__br.ready().then(() => true)'); await ev('window.__qaTick(400)');
  const capMs = await ev(`import('/src/game/index.ts').then(m => m.offlineCapMs(window.__br.getState()))`);
  const end = await ev(`({ tick: __br.getState().clock.tick, report: __br.getOfflineReport(), absence: __br.getOfflineAbsence?.() ?? null,
    capped: document.querySelector('[data-testid=offline-capped]')?.textContent ?? null, time: document.querySelector('[data-testid=offline-time]')?.textContent ?? null })`);
  const creditedTicks = end.tick - stageTick, capTicks = capMs / 100;
  Object.assign(result, { mid, resumed, capMs, end: { ...end, report: end.report && { ticks: end.report.ticks } }, creditedTicks, capTicks });
  check('the plate resumes from the checkpoint', resumed !== null && resumed.simulatedMs >= mid.absence.creditedMs && resumed.totalMs === capMs && resumed.awayMs >= awayMs, resumed);
  // Boot frames after the catch-up are play time: allow a few seconds of them.
  check('total credit stays at the cap', creditedTicks >= capTicks && creditedTicks <= capTicks + 300, { creditedTicks, capTicks });
  check('the report keeps the capped line', /^Away \d/.test(end.capped ?? ''), end.capped);
  check('the stored absence is cleared', (await stored()).absence === null);
  await shot('report-after-reload');
} finally {
  await browser.close();
  writeArtifact(path.join(out, 'result.json'), JSON.stringify(result, null, 1) + '\n');
  if (result.checks.some(c => !c.ok) || result.checks.length < 5) process.exitCode = 1;
}
