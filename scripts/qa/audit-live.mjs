// The live alignment audit for the game, ported from the L2 mockup's audit.js (its "Audit" rules 1
// and 2). It runs in the page, over the shell's
// `.stage`, and checks:
// - DOM boxes: every absolutely placed element has its left/top (and right/bottom when sized) on the
//   8 px grid of the stage; text line heights keep the 8 px rhythm.
// - Sprites: every shell art canvas shows exactly N CSS px per art px, pixelated; the world canvas
//   covers the stage 1:1.
// - Text fit: every text run stays inside its placed box; no two runs collide; nothing shows
//   through an open sheet, drawer or callout.
// - Type: Chakra Petch everywhere, at the body size or one of the three larger sizes (D2.1, D11).
// - Currencies: Credits and Data never show a fraction (D2.2, D3.3).
// - Clipped values: a capped run that ends in an ellipsis is listed in `clipped` (not a violation:
//   it stays inside its box), so long copy is visible in the report.
// Elements marked [data-free] (art lines, plates that place themselves) are skipped, as in L2.
//
// Use: `import { auditPage } from './audit-live.mjs'; await auditPage(browser)` with the CDP
// browser from cdp.mjs (capture.mjs runs it for every case), or paste `liveAudit` into a console.

/** Runs in the page. Returns { N, lattice, stage, violations, checked }. */
export function liveAudit() {
  const stage = document.querySelector('.stage');
  if (!stage) return { violations: [{ rule: 'setup', what: 'stage', detail: 'no .stage in the page' }], checked: {} };
  const N = Number(stage.dataset.n), lat = Number(stage.dataset.lat), sr = stage.getBoundingClientRect();
  const v = [], clipped = [], ok = { dom: 0, text: 0, sprites: 0, runs: 0 };
  const fail = (rule, what, detail) => v.push({ rule, what, detail });
  const on8 = (n) => Math.abs(n - Math.round(n / 8) * 8) < 0.01;
  const modal = [...stage.querySelectorAll('[aria-modal="true"]')].at(-1);
  const visible = (e) => (!modal || modal.contains(e) || e.contains(modal))
    && !!(e.offsetParent || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
  const free = (e) => !!e.closest('[data-free], .v3-plate');
  const name = (e) => e.dataset.k || e.dataset.testid || (typeof e.className === 'string' ? e.className.split(' ')[0] : '') || e.tagName.toLowerCase();
  const say = (e) => `"${(e.textContent || '').trim().slice(0, 32)}"`;
  const rel = (r) => ({ x0: r.left - sr.left, y0: r.top - sr.top, x1: r.right - sr.left, y1: r.bottom - sr.top });

  // ---- rule 2: one art pixel size ----
  const world = stage.querySelector('canvas.world');
  if (world) {
    const r = world.getBoundingClientRect();
    if (Math.abs(r.width - sr.width) > 0.01 || Math.abs(r.height - sr.height) > 0.01) fail(2, 'world', `world canvas ${r.width}x${r.height} does not cover the stage ${sr.width}x${sr.height}`);
    if (getComputedStyle(world).imageRendering !== 'pixelated') fail(2, 'world', 'world canvas is not image-rendering: pixelated');
  } else fail(2, 'world', 'no world canvas');
  for (const c of stage.querySelectorAll('canvas.art')) {
    if (!visible(c)) continue;
    const r = c.getBoundingClientRect();
    // User, 27 Oct: work-tree icons use native 16px art to keep large recipes compact.
    const scale = c.closest('.task-work') ? 1 : N;
    if (Math.abs(r.width - c.width * scale) > 0.01 || Math.abs(r.height - c.height * scale) > 0.01) fail(2, `sprite ${name(c.closest('[data-k],[data-testid]') || c)}`, `${c.width}x${c.height} art px shown at ${r.width}x${r.height} CSS px, not x${scale}`);
    else ok.sprites++;
    if (getComputedStyle(c).imageRendering !== 'pixelated') fail(2, 'sprite', 'sprite is not pixelated');
  }

  // ---- rule 1: one layout grid ----
  for (const e of stage.querySelectorAll('*')) {
    if (!visible(e) || free(e) || e.tagName === 'canvas' || e.tagName === 'CANVAS') continue;
    const cs = getComputedStyle(e);
    if (cs.position !== 'absolute') continue;
    const b = rel(e.getBoundingClientRect());
    const xs = e.style.right !== '' && e.style.left === '' ? [['right', b.x1]] : [['left', b.x0]];
    if (e.style.width) xs.push(['right', b.x1]);
    const ys = [['top', b.y0]]; if (e.style.height) ys.push(['bottom', b.y1]);
    for (const [edge, val] of [...xs, ...ys]) if (!on8(val)) fail(1, `dom ${name(e)}`, `${edge} edge at ${val.toFixed(2)} px is off the 8 px grid: ${say(e)}`);
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText && !on8(parseFloat(cs.lineHeight))) fail(1, `text ${name(e)}`, `line-height ${cs.lineHeight} breaks the 8 px rhythm: ${say(e)}`);
    if (e.textContent.trim()) ok.text++; else ok.dom++;
  }

  // ---- text fits its box, never collides, never shows through a sheet ----
  const runs = [...stage.querySelectorAll('.t, button.skey, button.x, .rung-label')].filter((e) => visible(e) && !free(e) && e.textContent.trim() && !e.querySelector('.t'));
  const ink = (e) => {
    const g = document.createRange(); g.selectNodeContents(e); const r = rel(g.getBoundingClientRect());
    return { x0: r.x0, y0: r.y0 + 2, x1: r.x1, y1: r.y1 - 2 };
  };
  for (const e of runs) {
    ok.runs++;
    if (e.classList.contains('clip')) {   // capped: it ends in an ellipsis instead of overflowing
      if (e.scrollWidth > e.clientWidth + 1) clipped.push({ what: name(e.parentElement.closest('[data-k],[data-testid]') || e), text: e.textContent.trim(), width: e.clientWidth });
      continue;
    }
    const host = e.parentElement && e.parentElement.closest('[style*="width"]');
    if (!host || !stage.contains(host)) continue;
    const h = rel(host.getBoundingClientRect()), b = ink(e);
    if (b.x0 < h.x0 - 0.5 || b.x1 > h.x1 + 0.5) fail('fit', `text ${name(host)}`, `${say(e)} runs past its box (${b.x0.toFixed(0)}-${b.x1.toFixed(0)} vs ${h.x0.toFixed(0)}-${h.x1.toFixed(0)})`);
  }
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    if (runs[i].contains(runs[j]) || runs[j].contains(runs[i])) continue;
    const a = ink(runs[i]), b = ink(runs[j]);
    if (a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1) fail('fit', 'text collision', `${say(runs[i])} overlaps ${say(runs[j])}`);
  }
  for (const cover of stage.querySelectorAll('[data-k="sheet"], [data-k="callout"]')) {
    if (!visible(cover)) continue;
    const s0 = rel(cover.getBoundingClientRect());
    for (const e of runs) {
      if (cover.contains(e)) continue;
      const b = ink(e);
      if (!(b.x0 < s0.x1 && s0.x0 < b.x1 && b.y0 < s0.y1 && s0.y0 < b.y1)) continue;
      // inside the cover's rect: the run shows through if it, not the cover, is on top there
      const x = sr.left + Math.max(b.x0, s0.x0) + 1, y = sr.top + (Math.max(b.y0, s0.y0) + Math.min(b.y1, s0.y1)) / 2;
      const top = document.elementFromPoint(x, y);
      if (top && !cover.contains(top)) fail('fit', `under ${cover.dataset.k}`, `${say(e)} shows through the open ${cover.dataset.k}`);
    }
  }

  // ---- type: one face, one body size (plus Credits, Data and titles) ----
  const body = parseFloat(getComputedStyle(stage).fontSize), sizes = new Set([body]);
  for (const k of ['--big', '--mid', '--head']) sizes.add(parseFloat(getComputedStyle(stage).getPropertyValue(k)));
  for (const e of stage.querySelectorAll('*')) {
    if (!visible(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(e);
    if (!/Chakra Petch/.test(cs.fontFamily)) fail('type', `face ${name(e)}`, `${cs.fontFamily} on ${say(e)}`);
    if (!sizes.has(parseFloat(cs.fontSize))) fail('type', `size ${name(e)}`, `${cs.fontSize} on ${say(e)} (allowed ${[...sizes].join(', ')} px)`);
  }

  // ---- whole-number currencies ----
  for (const id of ['credits', 'data']) {
    const t = stage.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
    if (/\.\d+$/.test(t)) fail('currency', id, `"${t}" shows a fraction`);
  }
  return { N, lattice: lat, stage: [sr.width, sr.height], violations: v, clipped, checked: ok };
}

/** Runs the audit in the page behind a cdp.mjs browser. */
export async function auditPage(browser) {
  return browser.evaluate(`(${liveAudit.toString()})()`);
}
