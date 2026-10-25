// DEV-only harness for the rack, room and global levels (R3). Not a build input.
// Open /src/render/levels/rack/harness.html?level=rack&case=overview
//   &paused=1  round not running      &t=<ms>  sim time      &sel=<target id>   &top=&bottom=  world viewport margins (css px)
//   &hold=<0..1>&partner=<case>  freeze a zoom from `partner` (another level's case) to `case`
//   &scroll=<art px>  rack row scroll (clamped, whole &step= steps, default 8)
// Each level folder exports CASES from fixtures.ts; this page knows none of them by name.
import { createCanvasRenderer, rect } from '../../core';
import { fixtureSnapshot } from '../../core/fixtureLevels';
import { loadCanvasFont } from '../../core/fonts';
import type { LevelSnapshot, ViewPresentation } from '../../core';
import { createGameRegistry } from '..';
import { rackRowScroll } from './row';

type Cases = Readonly<Record<string, (timeMs: number) => LevelSnapshot>>;
const found = import.meta.glob<{ CASES: Cases }>('../*/fixtures.ts', { eager: true });
const all: Record<string, Cases> = {};
// This folder's own file resolves as './fixtures.ts'.
for (const [path, module] of Object.entries(found)) all[path.startsWith('./') ? 'rack' : path.split('/')[1]] = module.CASES;

const q = new URLSearchParams(location.search);
const levelId = q.get('level') ?? 'rack', caseId = q.get('case') ?? 'overview';
const cases = all[levelId] ?? {};
const make = cases[caseId] ?? Object.values(cases)[0];
const hud = document.getElementById('hud')!;
const canvas = document.getElementById('world') as HTMLCanvasElement;
if (!make) hud.textContent = `no case ${levelId}/${caseId}; have ${Object.keys(all).map(k => `${k}: ${Object.keys(all[k]).join(',')}`).join(' | ')}`;
else {
  // The renderer draws nothing until Chakra Petch is in; wait so a held zoom starts from a real first frame.
  await loadCanvasFont(document);
  const registry = await createGameRegistry(), renderer = createCanvasRenderer(canvas, registry);
  await loadCanvasFont(document);
  const top = Number(q.get('top') ?? 135), bottom = Number(q.get('bottom') ?? 150);
  const paused = q.has('paused'), fixedT = q.get('t');
  const view: ViewPresentation = { selectedId: q.get('sel'), picked: q.get('pick'), quotes: null, reducedMotion: q.has('rm') };
  const partnerCase = q.get('partner'), hold = q.get('hold'), scroll = q.get('scroll');
  rackRowScroll.setStep(Number(q.get('step') ?? 8));
  const [pLevel, pCase] = partnerCase?.split('/') ?? [];
  const resize = () => renderer.resize(innerWidth, innerHeight, devicePixelRatio, rect(0, top, innerWidth, innerHeight - top - bottom));
  addEventListener('resize', resize); resize();
  const start = performance.now();
  let epoch = 1;
  const frame = (now: number) => {
    const t = fixedT !== null ? Number(fixedT) : 5_000 + (now - start);
    const focus = make(t);
    if (scroll !== null) rackRowScroll.scrollTo(Number(scroll));
    const partner = pLevel && all[pLevel]?.[pCase] ? all[pLevel][pCase](t) : null;
    if (partner && hold !== null) {
      // Draw the partner once at rest, then switch focus so the core starts the zoom, frozen at `hold`.
      renderer.hold(Number(hold));
      if (epoch === 1) { renderer.draw(fixtureSnapshot(partner, null, { simTimeMs: t, round: paused ? 'between' : 'running' }), view, { nowS: now / 1000, sincePublishMs: 0 }); epoch = 2; }
    }
    renderer.draw(fixtureSnapshot(focus, partner, { simTimeMs: t, round: paused ? 'between' : 'running' }), view, { nowS: now / 1000, sincePublishMs: 0 });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.addEventListener('click', e => {
    const hit = renderer.hit(e.clientX, e.clientY);
    hud.textContent = hit ? `${hit.kind} ${hit.id}${hit.drill ? ` → ${hit.drill.level}:${hit.drill.id}` : ''}` : 'no target';
  });
  (window as unknown as { __r3: unknown }).__r3 = { renderer, levels: Object.keys(all), cases: Object.keys(cases) };
}
