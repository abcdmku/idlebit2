// Boot check for a built or deployed page (no DEV bridge needed): loads the URL in headless Chrome
// at desktop and phone sizes, lets the game run, and fails on any console error, exception,
// failed request or HTTP error. Writes <id>.png and boot.json to --out.
//
//   node scripts/qa/boot.mjs --url=http://127.0.0.1:4174/idlebit2/ [--out=artifacts/qa/boot] [--run-ms=6000]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchChrome, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const url = option('url', 'http://127.0.0.1:4174/idlebit2/');
const out = path.resolve(option('out', 'artifacts/qa/boot'));
const runMs = Number(option('run-ms', '6000'));
const CASES = [
  { id: 'desktop-1440x900', width: 1440, height: 900, dpr: 1, mobile: false },
  { id: 'phone-390x780', width: 390, height: 780, dpr: 2, mobile: true },
];
mkdirSync(out, { recursive: true });

const browser = await launchChrome(option('chrome', process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'));
const results = [];
let current;
browser.listen(({ method, params: p }) => {
  if (!current) return;
  if (method === 'Runtime.exceptionThrown') current.errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
  if (method === 'Runtime.consoleAPICalled' && p.type === 'error') current.errors.push(p.args.map(a => a.value ?? a.description).join(' '));
  if (method === 'Runtime.consoleAPICalled' && p.type === 'warning') current.warnings.push(p.args.map(a => a.value ?? a.description).join(' '));
  if (method === 'Log.entryAdded' && p.entry.level === 'error') current.errors.push(`${p.entry.text} ${p.entry.url ?? ''}`.trim());
  if (method === 'Network.loadingFailed' && !p.canceled) current.errors.push(`Network ${p.errorText}`);
  if (method === 'Network.responseReceived') {
    current.requests.push(`${p.response.status} ${p.response.url}`);
    if (p.response.status >= 400) current.errors.push(`HTTP ${p.response.status} ${p.response.url}`);
  }
});
try {
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await browser.send(`${domain}.enable`);
  await browser.send('Network.setCacheDisabled', { cacheDisabled: true });
  for (const test of CASES) {
    current = { id: test.id, errors: [], warnings: [], requests: [] };
    await browser.send('Emulation.setDeviceMetricsOverride', { width: test.width, height: test.height, deviceScaleFactor: test.dpr, mobile: test.mobile });
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: test.mobile });
    const navigation = await browser.send('Page.navigate', { url });
    if (navigation.errorText) current.errors.push(`Navigate ${navigation.errorText}`);
    let booted = false;
    for (let attempt = 0; attempt < 150 && !booted; attempt++) {
      booted = await browser.evaluate('document.readyState === "complete" && !!document.querySelector("#root canvas")').catch(() => false);
      if (!booted) await sleep(100);
    }
    if (!booted) current.errors.push('No game canvas after 15 s');
    await sleep(runMs);
    current.page = await browser.evaluate(`document.fonts.ready.then(() => ({
      title: document.title,
      font: [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Chakra Petch' && f.status === 'loaded').map(f => f.weight).sort().join(','),
      canvas: !!document.querySelector('#root canvas'),
      shell: !!document.querySelector('main.br-shell'),
    }))`);
    if (!current.page.font) current.errors.push('Chakra Petch did not load');
    const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(out, `${test.id}.png`), Buffer.from(shot.data, 'base64'));
    results.push(current);
    console.log(`${test.id}: ${current.errors.length} errors, ${current.warnings.length} warnings, ${JSON.stringify(current.page)}`);
    for (const error of current.errors) console.error(`  ${error}`);
    current = undefined;
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(out, 'boot.json'), JSON.stringify({ url, runMs, results }, null, 2));
process.exit(results.some(r => r.errors.length) || results.length < CASES.length ? 1 : 0);
