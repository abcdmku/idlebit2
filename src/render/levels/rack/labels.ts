// The rack's switch tag (D35): its port speed, "Switch 100 kHz" when every port matches, else the
// range "Switch 100–200 kHz". It sits left of the active cabinet at the switch row with a leader to
// it (desktop: over the dimmed row neighbour; phone: in the gutter the rest keeps there), off the cabinet.
import { formatHertz } from '../../../game';
import type { RackSnapshot } from '../../../game';
import type { LabelWriter, WorldFrame } from '../../core';
import { switchSpeeds } from './infra';
import { CAB, SWITCH_RECT, colX } from './layout';
import { rackCol } from './row';

const sp = { lo: 0, hi: 0 };
/** "100 kHz", or "100–200 kHz" (one unit when they share it). */
export function speedText(lo: number, hi: number): string {
  const a = formatHertz(lo), b = formatHertz(hi);
  if (a === b) return a;
  const ua = a.slice(a.lastIndexOf(' ')), ub = b.slice(b.lastIndexOf(' '));
  return ua === ub ? `${a.slice(0, a.lastIndexOf(' '))}–${b}` : `${a}–${b}`;
}
export function rackLabels(s: RackSnapshot, frame: WorldFrame, out: LabelWriter): void {
  switchSpeeds(s, sp);
  if (sp.hi <= 0) return;
  const ax = colX(rackCol(s)), x = ax + CAB.x - 4, y = SWITCH_RECT.y + 1;
  const tag = out.label('switch', x, y, 'right', true).text('Switch', 'name', true);
  (frame.form === 'phone' ? tag.br() : tag).text(speedText(sp.lo, sp.hi), 'net');
  out.leader(ax + SWITCH_RECT.x, SWITCH_RECT.y + 6);
}
