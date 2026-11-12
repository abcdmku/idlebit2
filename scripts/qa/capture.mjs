// Local headless Chrome/CDP capture of the game (dev server), driven through the DEV bridge.
// Cases come from a manifest; each one boots the game fresh with a seeded, controlled clock.
//
// Manifest: [{ id, width, height, dpr, seed, fresh?, stage?, awayMs?, catchUpShot?, probe?, query?, steps?: string[], tickMs? }]
// `stage` loads an existing campaign stage save before boot, for legal later-era captures.
// The stage must load: a save from another SAVE_VERSION resets to a fresh game, and that case is
// recorded as an error (the page's notice, its SAVE_VERSION and the state's tick are all checked).
// `awayMs` backdates the stored envelope (`savedAtMs = now - awayMs`), so the page boots into a
// real cold return: the runtime measures the absence and runs its own offline catch-up. Boot
// then waits in real time for the worker. `catchUpShot` also writes <id>.catchup.png the first
// time the catch-up plate is on screen during that boot.
// `steps` are page expressions run after `__br.ready()`, for example
// "__br.dispatch({ type: 'returnToMarket' })" or "__br.advance(60000)".
// `probe` is a page expression evaluated after the steps; its JSON value is written to
// <id>.probe.json, so a case can leave the numbers it checked as evidence.
// Every case also runs the live alignment audit (audit-live.mjs): its findings go to
// <id>.audit.json and audit.json. They are reported, not errors; --strict-audit makes them fail.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeArtifact as writeFileSync } from './files.mjs';
import { launchChrome, sleep } from './cdp.mjs';
import { auditPage } from './audit-live.mjs';
import { controlledClock } from './clock.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = option('base', 'http://127.0.0.1:6174');
const out = path.resolve(option('out', 'artifacts/qa/capture'));
const manifest = JSON.parse(readFileSync(option('manifest', 'scripts/qa/manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
mkdirSync(out, { recursive: true });
const diagnostics = [], frames = [], alignments = {}, loadedLoaders = new Set();
let current = 'setup', revision = 'unknown', scriptId;
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(); } catch { /* Archive checkout. */ }
const browser = await launchChrome(option('chrome', process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'));
const record = (severity, message) => {
  diagnostics.push({ case: current, severity, message });
  if (severity === 'error') console.error(`[${current}] ${message}`);
};
browser.listen(message => {
  const p = message.params;
  if (message.method === 'Page.lifecycleEvent' && p.name === 'load') loadedLoaders.add(p.loaderId);
  if (message.method === 'Runtime.exceptionThrown') record('error', p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(p.type)) record(p.type, p.args.map(a => a.value ?? a.description).join(' '));
  if (message.method === 'Log.entryAdded' && ['warning', 'error'].includes(p.entry.level)) record(p.entry.level, `${p.entry.text} ${p.entry.url ?? ''}`);
  if (message.method === 'Network.loadingFailed' && !p.canceled) record('error', `Network ${p.errorText}`);
  if (message.method === 'Network.responseReceived' && p.response.status >= 400) record('error', `HTTP ${p.response.status} ${p.response.url}`);
});
try {
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await browser.send(`${domain}.enable`);
  await browser.send('Page.setLifecycleEventsEnabled', { enabled: true });
  for (const test of manifest) {
    current = test.id;
    try {
      if (!/^[a-zA-Z0-9_.-]+$/.test(test.id)) throw new Error('Unsafe case ID');
      const url = new URL(option('game-path', '/'), base);
      if (test.fresh !== false && !test.stage) url.searchParams.set('fresh', '');
      for (const [key, value] of Object.entries(test.query ?? {})) url.searchParams.set(key, value);
      if (scriptId) await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
      if (test.stage && !existsSync(test.stage)) throw new Error(`Stage ${test.stage} is missing. Build the stage set: node scripts/qa/fixtures/build.mjs`);
      const saved = test.stage ? JSON.parse(readFileSync(test.stage, 'utf8')).save : null;
      if (test.stage && typeof saved !== 'string') throw new Error('Stage has no serialized save');
      const awayMs = test.awayMs ?? 0;
      if (!Number.isSafeInteger(awayMs) || awayMs < 0) throw new Error('awayMs must be whole non-negative ms');
      if (awayMs > 0 && !saved) throw new Error('awayMs needs a stage');
      const envelope = saved ? JSON.parse(saved) : null;
      const restore = saved ? `localStorage.setItem('idlebit2:save-v3', JSON.stringify({ savedAtMs: Date.now() - ${awayMs}, save: ${JSON.stringify(saved)} }));` : '';
      scriptId = (await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: controlledClock(test.seed ?? 42) + restore })).identifier;
      await browser.send('Emulation.setDeviceMetricsOverride', { width: test.width, height: test.height, deviceScaleFactor: test.dpr ?? 1, mobile: false });
      const navigation = await browser.send('Page.navigate', { url: url.href });
      if (navigation.errorText) throw new Error(navigation.errorText);
      let ready = false;
      for (let attempt = 0; attempt < 200 && !ready; attempt++) {
        ready = (!navigation.loaderId || loadedLoaders.has(navigation.loaderId))
          && await browser.evaluate('Boolean(window.__br && window.__qaTick && document.readyState === "complete")');
        if (!ready) await sleep(100);
      }
      if (!ready) throw new Error('Missing __br bridge or incomplete document after 20 s');
      // The controlled clock only moves when ticked, so boot needs explicit frames.
      // A cold return (awayMs) catches up in a worker on real time: wait for it, up to 4 minutes.
      const bootDeadline = Date.now() + 240_000;
      let catchUpShot = null;
      for (let attempt = 0; attempt < 100 || Date.now() < bootDeadline; attempt++) {
        const status = await browser.evaluate('window.__qaTick(50), window.__br.bootStatus');
        if (status === 'ready') break;
        if (status === 'error') throw new Error(`Boot failed: ${await browser.evaluate('JSON.stringify(window.__br.bootError)')}`);
        const catching = await browser.evaluate('Boolean(window.__br?.getLifecycle?.().catchingUp)');
        if (!catching && attempt >= 100) break;
        if (catching && test.catchUpShot && !catchUpShot && await browser.evaluate('Boolean(document.querySelector("[data-testid=catch-up-plate]")) && (window.__br.getCatchUp?.()?.simulatedMs ?? 0) > 0')) {
          catchUpShot = (await browser.send('Page.captureScreenshot', { format: 'png' })).data;
        }
        if (catching) await sleep(25);
      }
      if (test.catchUpShot && !catchUpShot) record('error', 'catchUpShot: the catch-up plate never showed during boot');
      await browser.evaluate('window.__br.ready().then(() => true)');
      if (envelope) {
        // A stage that does not load boots a fresh game and every later step "passes" on the wrong state.
        const page = await browser.evaluate(`import(${JSON.stringify(new URL('src/game/save/schema.ts', base.endsWith('/') ? base : base + '/').href)}).then(m => m.SAVE_VERSION, () => null)
          .then(version => ({ version, notice: window.__br.getNotice(), tick: window.__br.getState().clock.tick, seed: window.__br.getState().seed }))`);
        const stageTick = envelope.state?.clock?.tick ?? 0;
        if (page.version !== null && envelope.version !== page.version) throw new Error(`Stage ${test.stage} is save version ${envelope.version}; the game is ${page.version}. The page booted a fresh game. Rebuild the stage (scripts/qa/fixtures/build.mjs).`);
        if (/reset/i.test(page.notice ?? '')) throw new Error(`Stage ${test.stage} did not load: ${page.notice}`);
        if (page.tick < stageTick || page.seed !== envelope.state?.seed) throw new Error(`Stage ${test.stage} did not load: page is at tick ${page.tick}, the stage at ${stageTick}`);
      }
      await browser.evaluate('document.fonts.ready.then(() => true)');
      // Hydration can finish before the shell's first draw. Wait for the actual
      // hit targets before scripts select a part, without advancing the saved game.
      const wasPaused = await browser.evaluate('window.__br.isPaused()');
      await browser.evaluate('window.__br.pause()');
      let drawn = false;
      for (let attempt = 0; attempt < 100 && !drawn; attempt++) {
        drawn = await browser.evaluate('window.__qaTick(50), Boolean(window.__brShell?.surface.renderer?.getTargets().length)');
      }
      if (!drawn) throw new Error('Shell did not publish hardware targets');
      if (!wasPaused) await browser.evaluate('window.__br.resume()');
      for (const step of test.steps ?? []) await browser.evaluate(`Promise.resolve(${step}).then(() => true)`);
      // Let 500 ms selector cadences settle after scripted actions before auditing their painted state.
      await browser.evaluate(`window.__qaTick(${Math.max(0, test.tickMs ?? 600)})`);
      const geometry = await browser.evaluate(`(() => {
        const root = document.querySelector(${JSON.stringify(option('root', '#root'))});
        if (!root) throw new Error('Missing content root');
        const rect = root.getBoundingClientRect(), canvas = root.querySelector('canvas');
        window.__qaCanvas = canvas;
        return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height,
          canvasWidth: canvas?.width ?? 0, canvasHeight: canvas?.height ?? 0, fontStatus: document.fonts.status };
      })()`);
      const prefix = path.join(out, test.id), files = [];
      if (catchUpShot) { writeFileSync(`${prefix}.catchup.png`, Buffer.from(catchUpShot, 'base64')); files.push(`${test.id}.catchup.png`); }
      if (geometry.canvasWidth > 0) {
        const canvas = await browser.evaluate('window.__qaCanvas.toDataURL("image/png")');
        writeFileSync(`${prefix}.canvas.png`, Buffer.from(canvas.split(',')[1], 'base64')); files.push(`${test.id}.canvas.png`);
      }
      if (test.probe) {
        const value = await browser.evaluate(`Promise.resolve(${test.probe})`);
        writeFileSync(`${prefix}.probe.json`, JSON.stringify(value ?? null, null, 2) + '\n'); files.push(`${test.id}.probe.json`);
      }
      const capture = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, scale: 1 } });
      writeFileSync(`${prefix}.full.png`, Buffer.from(capture.data, 'base64')); files.push(`${test.id}.full.png`);
      const audits = await browser.evaluate(`(() => {
        const failures = [];
        for (const el of document.querySelectorAll('[data-qa-label]')) {
          if (el.scrollWidth > el.clientWidth + 1) failures.push('Text overflow: ' + el.textContent);
        }
        for (const el of document.querySelectorAll('[data-qa-target]')) {
          const r = el.getBoundingClientRect();
          // Closed native disclosures have no rendered targets. Audit them after opening,
          // rather than reporting their intentionally hidden descendants as zero-size buttons.
          if (r.width === 0 || r.height === 0) continue;
          if (r.width < 44 || r.height < 44) failures.push('Target under 44 px: ' + el.textContent);
        }
        return { failures, labeled: document.querySelectorAll('[data-qa-label]').length, targets: document.querySelectorAll('[data-qa-target]').length };
      })()`);
      for (const failure of audits.failures) record('error', failure);
      const alignment = await auditPage(browser);
      alignments[test.id] = alignment;
      writeFileSync(`${prefix}.audit.json`, JSON.stringify(alignment, null, 2) + '\n'); files.push(`${test.id}.audit.json`);
      if (args.includes('--strict-audit')) for (const f of alignment.violations) record('error', `Audit ${f.rule} ${f.what}: ${f.detail}`);
      frames.push({ ...test, url: url.href, geometry, audits, alignment: { violations: alignment.violations.length, clipped: alignment.clipped.length, checked: alignment.checked }, files });
      console.log(`Audit ${test.id}: ${alignment.violations.length} violations, ${alignment.clipped.length} clipped`);
      console.log(`Captured ${test.id}`);
    } catch (error) { record('error', String(error)); }
  }
} finally {
  await browser.close();
  writeFileSync(path.join(out, 'audit.json'), JSON.stringify(alignments, null, 2) + '\n');
  writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ revision, browser: browser.version,
    expectedFrames: manifest.length, frames, diagnostics }, null, 2) + '\n');
  if (diagnostics.some(d => d.severity === 'error') || frames.length !== manifest.length) process.exitCode = 1;
}
