// The die's labels (L2 syncWorldLabels): every block names itself and shows its value. Text only;
// the core draws it at the body size. Values come straight from the ChipSnapshot.
import { familyId } from '../../../game';
import type { ChipSnapshot } from '../../../game';
import { bitsText, familyName, hertz, whole } from '../../core';
import type { LabelWriter, WorldFrame, WorldForm } from '../../core';
import { coreSites, coreText, floorOf } from './layout';
import { isLive, lentCore, siteCount, siteLocked } from './world';

const CORE_NAMES = Array.from({ length: 32 }, (_, i) => `Core ${i + 1}`);
const LABEL_IDS = Array.from({ length: 32 }, (_, i) => `core${i}`);
export function chipLabels(chip: ChipSnapshot, frame: WorldFrame, out: LabelWriter, form: WorldForm): void {
  const f = floorOf(form), desk = form !== 'phone', live = isLive(chip, frame), pad = desk ? 8 : 4;
  const sc = chip.scheduler;
  out.label('queue', f.queue.x + pad, f.queue.y + 3).text('Queue', 'name', true);
  if (sc) out.text(`${whole(live ? sc.queued : 0)} / ${whole(sc.q)}`, 'value'); else out.text('none', 'dim');
  out.label('cache', f.cache.x + pad, f.cache.y + 3).text('Cache', 'name', true).text(bitsText(chip.cache.capacityBits), 'cyan');
  if (desk) out.text(`· ${bitsText(live ? chip.cache.usedBits : 0)} in use`, 'dim');
  out.label('clock', f.clock.x + pad, f.clock.y + pad).text('Clock', 'name', true).br().text(hertz(chip.clock.hz), 'value');

  const n = siteCount(chip), sites = coreSites(f, n);
  if (sites.length > 2) {
    let busy = 0;
    for (const c of chip.cores) if (live && c.busy > 0) busy++;
    out.label('cores', f.cores.x, f.cores.y - 8, 'left', true).text('Cores', 'name', true).text(`${busy} / ${whole(chip.cores.length)} busy`, 'value');
    return;
  }
  let landing = live && chip.pipe.waiting && chip.pipe.transfer !== null;
  for (let i = 0; i < sites.length; i++) {
    const r = sites[i]!, core = chip.cores[i], x = r.x + pad;
    if (!core) {
      out.label(LABEL_IDS[i]!, x, r.y + pad, 'left').text(CORE_NAMES[i]!, 'dim').br().text(siteLocked(chip, i) ? 'locked' : 'empty', 'dim');
      continue;
    }
    out.label(LABEL_IDS[i]!, x, r.y + pad, 'left').text(CORE_NAMES[i]!, 'name', true);
    if (desk) out.text(hertz(chip.clock.hz), 'mute'); else out.br().text(hertz(chip.clock.hz), 'mute');
    const busy = live && core.busy > 0, lent = live && lentCore(core), idle = !busy && !lent;
    // The running task: its family icon and name, and its progress (task numbers are never shown).
    const c = coreText(r, form);
    if (busy && core.family !== null) {
      const name = familyName(familyId(core.family)), pct = `${Math.floor(core.progress * 100)}%`;
      if (desk) { out.label(`${LABEL_IDS[i]}s`, c.id.x, c.id.y, 'left').text(name, 'value'); out.label(`${LABEL_IDS[i]}f`, c.line.x, c.line.y, 'left').text(pct, 'mute'); }
      else out.label(`${LABEL_IDS[i]}s`, c.line.x, c.line.y, 'left').text(name, 'value');
      continue;
    }
    const status = busy ? 'running' : lent ? 'research' : landing && idle ? 'landing' : 'idle';
    const tone = busy ? 'value' : lent ? 'rnd' : status === 'landing' ? 'net' : 'dim';
    if (status === 'landing') landing = false;
    out.label(`${LABEL_IDS[i]}s`, c.icon.x, c.icon.y, 'left').text(status, tone);
  }
}
