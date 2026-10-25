import { P } from '../../render/core/palette';
import { R, px } from '../../render/core/px';

/** Which unit a configuration plate adds. A zone is a room. */
export type ConfigKind = 'system' | 'rack' | 'room' | 'site';

const TIER_LINES = [P.op, P.amber, P.bit, P.gpu, P.led];

/** 16 × 12 art-px tier icons (mockup core/config-plate.js drawTierIcon). */
export function drawTierIcon(g: CanvasRenderingContext2D, kind: ConfigKind, tier: number, locked: boolean): void {
  g.clearRect(0, 0, 16, 12);
  const c = locked ? P.silkLo : TIER_LINES[tier % TIER_LINES.length];
  if (kind === 'system') {
    for (let i = 0; i < 6; i++) { px(g, 3 + i * 2, 0, P.pad); px(g, 3 + i * 2, 11, P.pad); }
    R(g, 1, 1, 14, 10, P.ink); R(g, 2, 2, 12, 8, locked ? P.wafer : P.logic); R(g, 2, 2, 12, 1, locked ? P.waferHi : P.logicHi);
    for (let i = 0; i <= tier; i++) R(g, 4 + i * 2, 5, 1, 3, c);
  } else if (kind === 'rack') {
    R(g, 3, 0, 10, 12, P.ink); R(g, 4, 1, 8, 10, locked ? P.wafer : P.substrateHi);
    for (let i = 0; i < 4; i++) { R(g, 5, 2 + i * 2, 6, 1, P.steelLo); px(g, 10, 2 + i * 2, i <= tier ? c : P.ledOff); }
  } else {
    R(g, 0, 3, 16, 9, P.ink); R(g, 1, 4, 14, 7, locked ? P.wafer : P.substrateHi);
    for (let i = 0; i < 4; i++) R(g, 2 + i * 3, 5, 2, 5, i <= tier ? c : P.steelLo);
    R(g, 0, 1, 16, 2, kind === 'site' ? P.steel : P.steelLo);
  }
}

/** Mini preview size in art px, shaped like the unit (servers wide, racks tall). */
export const MINI_SIZE: Readonly<Record<ConfigKind, readonly [number, number]>> = { system: [44, 16], rack: [14, 16], room: [28, 16], site: [28, 16] };
