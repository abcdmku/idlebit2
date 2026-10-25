// The die's labels (L2 syncWorldLabels): every block names itself and shows its value. Text only;
// the core draws it at the body size. Values come straight from the ChipSnapshot. The core sites
// arrange their text by the art scale the world rests at (A01): wide at N >= 3, stacked below.
// Locked sites carry no text (A25): the lock glyph and the callout say it.
import { formatHertz, formatSize } from '../../../game';
import { familyId } from '../../../game';
import type { ChipSnapshot } from '../../../game';
import { familyName, whole } from '../../core';
import type { LabelWriter, WorldFrame, WorldForm } from '../../core';
import { arrangementOf, coreSites, coreText, floorOf } from './layout';
import { coreSleep, coreSpeedText, speedRange, tileLabelFits } from './speed';
import { coreTag } from './tag';
import { firstLockedSite, isLive, lentCore, queueOpen, siteCount, siteLocked, spilledOut } from './world';

const LEVEL_NAMES: Readonly<Record<'l1' | 'l2' | 'l3', string>> = { l1: 'L1', l2: 'L2', l3: 'L3' };
const CORE_NAMES = Array.from({ length: 32 }, (_, i) => `Core ${i + 1}`);
const LABEL_IDS = Array.from({ length: 32 }, (_, i) => `core${i}`);
export function chipLabels(chip: ChipSnapshot, frame: WorldFrame, out: LabelWriter, form: WorldForm): void {
  const f = floorOf(form), wide = arrangementOf(frame.scale, form) === 'wide', live = isLive(chip, frame), pad = wide ? 8 : 4;
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
  out.label('clock', f.clock.x + pad, f.clock.y + pad).text('Clock', 'name', true).br().text(formatHertz(chip.clock.hz), 'value');

  const n = siteCount(chip), sites = coreSites(f, n);
  if (sites.length > 2) {
    let busy = 0;
    for (const c of chip.cores) if (live && c.busy > 0) busy++;
    // A clean spot (A25): inside the empty block's top-left, off the bus trace; on a full grid, over its first row.
    // Each tile shows its own speed (user): a label centred in the tile when it fits, else the
    // tile's readout (world.ts). A sleeping core shows its C-state, dimmed.
    for (let i = 0; i < Math.min(sites.length, chip.cores.length); i++) {
      const r = sites[i]!, core = chip.cores[i]!;
      if (!tileLabelFits(core, r, frame)) continue;
      out.label(LABEL_IDS[i]!, r.x + r.w / 2, r.y + 2, 'center').text(coreSpeedText(core), coreSleep(core) || !live ? 'dim' : 'value');
    }
    // The busy tag (tag.ts): in the widest empty row run, never over an installed core, the Clock or
    // the lock mark; it carries the cores' speed only when their tiles cannot and it fits.
    const tag = coreTag(chip, sites, firstLockedSite(chip, sites.length), f, frame);
    if (tag) {
      out.label('cores', tag.box.x + 2, tag.box.y + 2, 'left', true).text('Cores', 'name', true).text(`${busy} / ${whole(chip.cores.length)} busy`, 'value');
      if (tag.speedY !== null) out.label('coresHz', tag.box.x + 2, tag.speedY, 'left', true).text(speedRange(chip), 'mute');
      else if (tag.speed) out.text(`· ${speedRange(chip)}`, 'mute');
    }
    return;
  }
  let landing = live && chip.pipe.waiting && chip.pipe.transfer !== null;
  for (let i = 0; i < sites.length; i++) {
    const r = sites[i]!, core = chip.cores[i], c = coreText(r, wide ? 'wide' : 'stacked'), x = r.x + c.pad;
    if (!core) {
      if (!siteLocked(chip, i)) out.label(LABEL_IDS[i]!, x, r.y + c.pad, 'left').text(CORE_NAMES[i]!, 'dim').br().text('empty', 'dim');
      continue;
    }
    // A18: "Core 1 · 1 Hz" on one line, or name then Hz on their own lines, never "Core 11 Hz".
    out.label(LABEL_IDS[i]!, x, r.y + c.pad, 'left').text(CORE_NAMES[i]!, 'name', true);
    // A core shows its own live speed (user), or its C-state asleep.
    const sp = coreSpeedText(core), spTone = coreSleep(core) ? 'dim' : 'mute';
    if (wide) out.text(`· ${sp}`, spTone); else out.br().text(sp, spTone);
    const busy = live && core.busy > 0, lent = live && lentCore(core), idle = !busy && !lent;
    // The running task: its family icon and name, and its progress (task numbers are never shown).
    if (busy && core.family !== null) {
      const name = familyName(familyId(core.family)), pct = `${Math.floor(core.progress * 100)}%`;
      if (wide) { out.label(`${LABEL_IDS[i]}s`, c.id.x, c.id.y, 'left').text(name, 'value'); out.label(`${LABEL_IDS[i]}f`, c.line.x, c.line.y, 'left').text(pct, 'mute'); }
      else out.label(`${LABEL_IDS[i]}s`, c.line.x, c.line.y, 'left').text(name, 'value');
      continue;
    }
    const status = busy ? 'running' : lent ? 'research' : landing && idle ? 'landing' : 'idle';
    const tone = busy ? 'value' : lent ? 'rnd' : status === 'landing' ? 'net' : 'dim';
    if (status === 'landing') landing = false;
    out.label(`${LABEL_IDS[i]}s`, c.icon.x, c.icon.y, 'left').text(status, tone);
  }
}

