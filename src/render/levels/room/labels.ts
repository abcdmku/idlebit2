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
  upsTag(s, frame, out);
}
function gutterTags(s: RoomSnapshot, out: LabelWriter): void {
  const G = hallOf(s.rows), left = G.x - GAP;
  // QA-25: the room switch's port speed, the value the deck's Net rack row upgrades (the slowest port).
  // The uplink is the pipe's own tag at this level (Fiber), as the rack's is (Uplink).
  const net = NET_RECT, speed = portSpeed(s);
  out.label('net', left, net.y + 2, 'right', true).text('Net rack', 'name', true).text(formatHertz(speed), 'net')
    .leader(net.x, net.y + 6);
  const crac = CRAC_HITS[0]!;
  out.label('cooling', left, crac.y + 8, 'right', true).text('Cooling', 'name', true).text(`${whole(Math.round(s.tempF))}°F`, 'cyan')
    .leader(crac.x, crac.y + 12);
}
/** The room switch's slowest port speed (0 with no ports). */
export function portSpeed(s: RoomSnapshot): number {
  let hz = 0;
  for (const p of s.network.switch.ports) if (p.speedHz > 0 && (hz === 0 || p.speedHz < hz)) hz = p.speedHz;
  return hz;
}
function upsTag(s: RoomSnapshot, frame: WorldFrame, out: LabelWriter): void {
  let usage = 0;
  for (const u of s.ups) usage = Math.max(usage, u.usage);
  const n = upsCabinets(s.ups);
  if (!n) return;
  const first = UPS_HITS[upsIndex(0, n)]!, last = UPS_HITS[upsIndex(n - 1, n)]!;
  const x = Math.round((first.x + last.x + last.w) / 2);
  out.label('ups', x, focus.y - 12, 'center', true).text('UPS', 'name', true).text(`${whole(Math.round(usage * 100))}%`, usage > 0.9 ? 'warn' : 'value');
  // D31: the room start controller on the UPS: racks powered now of those it controls
  const st = s.power?.start ?? null;
  // a phone keeps the tag narrow: the Start line goes under the UPS line
  if (st) (frame.form === 'phone' ? out.br().text('Start', 'mute') : out.text('· Start', 'mute')).text(`${whole(st.awake)}/${whole(st.total)} racks`, 'value');
  out.leader(x, first.y);
}
