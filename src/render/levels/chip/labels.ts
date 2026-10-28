// The die's labels (L2 syncWorldLabels): every block names itself and shows its value. Text only;
// the core draws it at the body size. Values come straight from the ChipSnapshot. The core sites
// arrange their text by the art scale the world rests at (A01): wide at N >= 3, stacked below.
// Locked sites carry no text (A25): the lock glyph and the callout say it.
import { formatHertz, formatSize } from '../../../game';
import { formatCredits } from '../../../game/format';
import { familyId } from '../../../game';
import type { ChipSnapshot } from '../../../game';
import { familyName, whole } from '../../core';
import type { LabelWriter, ViewPresentation, WorldFrame, WorldForm } from '../../core';
import { PHONE_TYPE, typeForScale } from '../../core';
import { addMarkY } from './sprites';
import { arrangementOf, coreSites, coreText } from './layout';
import { coreActivityText, coreSleep, labelFits, readySpeedText, tileLabelFits } from './speed';
import { chipFloor, isLive, lentCore, queueOpen, siteCount, spilledOut } from './world';

const LEVEL_NAMES: Readonly<Record<'l1' | 'l2' | 'l3', string>> = { l1: 'L1', l2: 'L2', l3: 'L3' };
const CORE_NAMES = Array.from({ length: 32 }, (_, i) => `Core ${i + 1}`);
const LABEL_IDS = Array.from({ length: 32 }, (_, i) => `core${i}`);
/** The add-core quote among the tray quotes the UI holds: its price text and whether it is affordable now, or null. */
export function addCorePrice(view: ViewPresentation | null | undefined, chip: ChipSnapshot): { readonly text: string; readonly affordable: boolean } | null {
  const list = view?.quotes?.quotes;
  if (!list) return null;
  for (const q of list) {
    const a = q.action;
    if (a.type === 'addPart' && a.system === chip.systemId && a.kind === 'core' && !q.locked) return { text: formatCredits(q.cost), affordable: q.affordable };
  }
  return null;
}
export function chipLabels(chip: ChipSnapshot, frame: WorldFrame, out: LabelWriter, form: WorldForm, view?: ViewPresentation | null): void {
  const f = chipFloor(chip, form), wide = arrangementOf(frame.scale, form) === 'wide', live = isLive(chip, frame), pad = wide ? 8 : 4;
  const sc = chip.scheduler;
  if (sc) {
    out.label('queue', f.queue.x + pad, f.queue.y + 3).text('Queue', 'name', true).text(`${whole(live ? sc.queued : 0)} / ${whole(sc.q)}`, 'value');
  }
  else if (queueOpen(chip)) out.label('queue', f.queue.x + pad, f.queue.y + 3).text('Queue', 'dim', true).text('none', 'dim');
  out.label('cache', f.cache.x + pad, f.cache.y + 3).text('Cache', 'name', true).text(formatSize(chip.cache.capacityBits), 'cyan');
  const levels = chip.cache.levels;
  if (levels.length > 1) {
    // Several levels (lead ruling): the total, then each level's own size, so the deck's per-level row
    // ("L2 65.5 → 131 kb") matches a number here. Three levels don't fit one row below N = 3: they stack.
    if (levels.length > 2 && !wide) out.br();
    for (let k = 0; k < levels.length; k++) {
      const run = `${LEVEL_NAMES[levels[k]!.kind]} ${formatSize(levels[k]!.bits)}`;
      out.text(k || (levels.length > 2 && !wide) ? run : `· ${run}`, 'value');
      if (k + 1 < levels.length) out.text('·', 'mute');
    }
  } else if (form !== 'phone') out.text(`· ${formatSize(live ? chip.cache.usedBits : 0)} in use`, 'mute');
  // D26: what overflowed out of cache to RAM, as a warning, beside the cache's own numbers.
  if (live && spilledOut(chip) > 0) out.text(`· ${formatSize(spilledOut(chip))} spilled`, 'warn');
  // (One level: the in-use run fits the desktop cache row at either scale; the phone row has no room for it.)
  const clock = out.label('clock', f.clock.x + pad, f.clock.y + (f.clockAbove ? 8 : pad)).text('Clock', 'name', true);
  (f.clockAbove ? clock : clock.br()).text(formatHertz(chip.clock.hz), 'value');

  const n = siteCount(chip), sites = coreSites(f, n), price = addCorePrice(view, chip);
  if (sites.length > 2) {
    // The add site's price, dim, under its "+" when a line fits there (unaffordable: dim, never blank).
    const add = sites[chip.cores.length];
    if (add && price) {
      const scale = frame.scale ?? (form === 'phone' ? 2 : 3), t = form === 'phone' ? PHONE_TYPE : typeForScale(scale), py = addMarkY(add) + 5;
      if (labelFits(price.text, { x: add.x, y: py, w: add.w, h: add.y + add.h - py }, scale, t.body, t.line))
        out.label('addPrice', add.x + add.w / 2, py, 'center').text(price.text, price.affordable ? 'gold' : 'dim');
    }
    // Every tile shows its own speed (user): the die grows so a tile always fits its label (layout.ts).
    // A sleeping core shows its C-state, dimmed. No busy tag: each tile shows its own state.
    for (let i = 0; i < Math.min(sites.length, chip.cores.length); i++) {
      const r = sites[i]!, core = chip.cores[i]!;
      if (!tileLabelFits(core, r, frame)) continue;
      out.label(LABEL_IDS[i]!, r.x + r.w / 2, r.y + 2, 'center').text(readySpeedText(core, chip, live), coreSleep(core) || !live ? 'dim' : 'value');
      if (live) out.label(`${LABEL_IDS[i]}a`, r.x + r.w / 2, r.y + 10, 'center')
        .text(coreActivityText(core, true), core.activity === 'preload' ? 'preload' : core.activity === 'cacheLoad' || core.activity === 'cacheAccess' ? 'cyan' : core.activity ? 'value' : 'dim');
    }
    return;
  }
  let landing = live && chip.pipe.waiting && chip.pipe.transfer !== null;
  for (let i = 0; i < sites.length; i++) {
    const r = sites[i]!, core = chip.cores[i], c = coreText(r, wide ? 'wide' : 'stacked'), x = r.x + c.pad;
    if (!core) {
      // the add site: what it sells and its price (dim when unaffordable)
      out.label(LABEL_IDS[i]!, x, r.y + c.pad, 'left').text(`Add ${CORE_NAMES[i]!}`, price?.affordable ? 'name' : 'dim', !!price?.affordable);
      if (price) out.br().text(price.text, price.affordable ? 'gold' : 'dim');
      continue;
    }
    // A18: "Core 1 · 1 Hz" on one line, or name then Hz on their own lines, never "Core 11 Hz".
    out.label(LABEL_IDS[i]!, x, r.y + c.pad, 'left').text(CORE_NAMES[i]!, 'name', true);
    if (!wide && live && core.activity) out.text(`· ${coreActivityText(core, r.w < 70)}`,
      core.activity === 'preload' ? 'preload' : core.activity === 'cacheLoad' || core.activity === 'cacheAccess' ? 'cyan' : 'value');
    // A core shows its own live speed (user), or its C-state asleep.
    const sp = readySpeedText(core, chip, live), spTone = coreSleep(core) || !live ? 'dim' : 'mute';
    if (wide) out.text(`· ${sp}`, spTone); else out.br().text(sp, spTone);
    const busy = live && core.busy > 0, lent = live && lentCore(core), idle = !busy && !lent;
    // The running task: its family icon and name, and its progress (task numbers are never shown).
    if (busy && core.family !== null) {
      const phase = coreActivityText(core), tone = core.activity === 'preload' ? 'preload' : core.activity === 'cacheLoad' || core.activity === 'cacheAccess' ? 'cyan' : 'value';
      if (wide) {
        out.label(`${LABEL_IDS[i]}s`, c.id.x, c.id.y, 'left').text(familyName(familyId(core.family)), 'value');
        out.label(`${LABEL_IDS[i]}f`, x, r.y + 32, 'left').text(phase, tone);
      } else out.label(`${LABEL_IDS[i]}s`, c.line.x, c.line.y, 'left').text(familyName(familyId(core.family)), 'value');
      continue;
    }
    const status = busy ? 'running' : lent ? 'research' : landing && idle ? 'landing' : 'idle';
    const tone = busy ? 'value' : lent ? 'rnd' : status === 'landing' ? 'net' : 'dim';
    if (status === 'landing') landing = false;
    out.label(`${LABEL_IDS[i]}s`, c.icon.x, c.icon.y, 'left').text(status, tone);
  }
}

