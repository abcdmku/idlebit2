// Room fixture tags (A20): plate-language tags in the gutters, each with a 1·N leader to its fixture.
// The left gutter names the network rack and the cooling; the UPS bank is tagged above the back
// wall's east end, clear of the right gutter (the UI docks its callout there). The phone has no
// side gutters, so it keeps only the UPS tag. Values are snapshot fields, formatted.
import { formatHertz } from '../../../game';
import type { RoomSnapshot } from '../../../game';
import { whole } from '../../core';
import type { LabelWriter, Rect, WorldFrame } from '../../core';
import { CRAC_HITS, NET_RECT, UPS_HITS, focusRect, hallOf, upsIndex } from './layout';
import { upsCabinets } from './infra';

const focus: Rect = { x: 0, y: 0, w: 0, h: 0 };
/** Art px between a gutter tag and the hall. */
const GAP = 8;
export function roomLabels(s: RoomSnapshot, frame: WorldFrame, out: LabelWriter): void {
  focusRect(s.rows, focus);
  if (frame.form !== 'phone') gutterTags(s, out);
  upsTag(s, out);
}
function gutterTags(s: RoomSnapshot, out: LabelWriter): void {
  const G = hallOf(s.rows), left = G.x - GAP;
  const net = NET_RECT, speed = s.network.switch.uplinks[0]?.speedHz ?? 0;
  out.label('net', left, net.y + 2, 'right', true).text('Net rack', 'name', true).text(formatHertz(speed), 'net')
    .leader(net.x, net.y + 6);
  const crac = CRAC_HITS[0]!;
  out.label('cooling', left, crac.y + 8, 'right', true).text('Cooling', 'name', true).text(`${whole(Math.round(s.tempF))}°F`, 'cyan')
    .leader(crac.x, crac.y + 12);
}
function upsTag(s: RoomSnapshot, out: LabelWriter): void {
  let usage = 0;
  for (const u of s.ups) usage = Math.max(usage, u.usage);
  const n = upsCabinets(s.ups);
  if (!n) return;
  const first = UPS_HITS[upsIndex(0, n)]!, last = UPS_HITS[upsIndex(n - 1, n)]!;
  const x = Math.round((first.x + last.x + last.w) / 2);
  out.label('ups', x, focus.y - 12, 'center', true).text('UPS', 'name', true).text(`${whole(Math.round(usage * 100))}%`, usage > 0.9 ? 'warn' : 'value')
    .leader(x, first.y);
}
