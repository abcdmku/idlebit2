// Pixel art for the market feed (mockup core/market.js, feed-view.js).
// The strip itself (SLA gauge, rail grid, mouth button, labels) is DOM and belongs to
// the UI. These helpers draw the canvas parts: cartridges, family glyphs, requirement
// pips, cause marks and the mouth chevrons. Countdown bars are real deadlines.
import { KIND, P } from './palette';
import { R, px } from './px';
import { countdownWidth } from './activity';
import { HEAD_TICKS, TICK_MS, familyKey } from '../../game';
import type { FailCause, FamilyId, TaskIcon } from '../../game';

type G = CanvasRenderingContext2D;
export type CauseMark = FailCause;
/** Stage resources, then gates (FeedEntryView.icons). */
export type ReqIcon = TaskIcon;

/** The head's pickup window in seconds (D10.3: 100 ticks). */
export const PICKUP_S = HEAD_TICKS * TICK_MS / 1000;
/** Sim ms at which the head fails: the end of its deadline tick (D10.3). */
export function deadlineMs(deadlineTick: number): number { return (deadlineTick + 1) * TICK_MS; }

// 7×7 family glyphs: '#' work colour, '+' paper, keyed by FamilyDef.key. The keys are the mockup's
// placeholder families until S2's catalog lands; unknown keys draw the parity glyph.
const GLYPH: Readonly<Record<string, readonly string[]>> = {
  parity: ['#.#.#.#', '.......', '#.#.#.#', '.......', '#.#.#.#', '.......', '+++++++'],
  crc32: ['..###..', '.#...#.', '#.....#', '#..+..#', '#.....#', '.#...#.', '..###..'],
  intsort: ['......#', '......#', '....#.#', '....#.#', '..#.#.#', '..#.#.#', '#.#.#.#'],
  regex: ['...#...', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '...#...'],
  json: ['.##.##.', '.#...#.', '.#...#.', '#..+..#', '.#...#.', '.#...#.', '.##.##.'],
  sql: ['.#####.', '#.....#', '.#####.', '#.....#', '.#####.', '#.....#', '.#####.'],
  scan: ['#######', '.......', '#####..', '.......', '######.', '.......', '###....'],
  thumb: ['#######', '#.....#', '#..+..#', '#.#...#', '##.#.##', '#######', '.......'],
  transcode: ['#.###.#', '#######', '#.....#', '#.....#', '#.....#', '#######', '#.###.#'],
  infer: ['#.....#', '.#...#.', '..#+#..', '...#...', '..#+#..', '.#...#.', '#.....#'],
  repl: ['###.###', '#.#.#.#', '###.###', '.......', '..###..', '..#.#..', '..###..'],
  mapreduce: ['#.#.#.#', '.#.#.#.', '..#.#..', '...#...', '...#...', '..###..', '.#####.'],
  shard: ['###.###', '#+#.#+#', '###.###', '.......', '###.###', '#+#.#+#', '###.###'],
  llm: ['#######', '#+#+#+#', '#######', '#+#+#+#', '#######', '#+#+#+#', '#######'],
  geo: ['..###..', '.#.#.#.', '#######', '#..#..#', '#######', '.#.#.#.', '..###..'],
};
export const FEED_GLYPHS: readonly string[] = Object.freeze(Object.keys(GLYPH));
/** Unknown families draw the parity glyph rather than nothing. */
export function drawFamilyGlyph(g: G, family: FamilyId | string, x: number, y: number, color: string = KIND.compute): void {
  const rows = GLYPH[typeof family === 'string' ? family : familyKey(family)] ?? GLYPH.parity;
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
    const ch = rows[j][i];
    if (ch === '#') px(g, x + i, y + j, color); else if (ch === '+') px(g, x + i, y + j, P.paper);
  }
}

const REQ: Readonly<Record<ReqIcon, readonly string[]>> = {
  cpu: ['###', '#.#', '###'], ram: ['#.#', '#.#', '###'], gpu: ['###', '###', '#.#'], io: ['###', '...', '###'],
  vram: ['#.#', '#.#', '.#.'], storageCap: ['###', '###', '###'], ecc: ['.#.', '###', '.#.'], tensor: ['#.#', '.#.', '#.#'],
  gang: ['#.#', '...', '#.#'], zones: ['##.', '...', '.##'], region: ['.#.', '#.#', '.#.'],
};
export const REQ_COLOR: Readonly<Record<ReqIcon, string>> = {
  cpu: KIND.compute, ram: P.ram, gpu: P.gpu, io: P.stor, vram: P.gpu, storageCap: P.stor, ecc: P.ram, tensor: P.rnd,
  gang: P.bit, zones: P.cool, region: P.coolHi,
};
/** A 3×3 requirement pip. */
export function drawReq(g: G, req: ReqIcon, x: number, y: number): void {
  const rows = REQ[req];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (rows[j][i] === '#') px(g, x + i, y + j, REQ_COLOR[req]);
}

const CAUSE: Readonly<Record<CauseMark, readonly string[]>> = {
  cantRun: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  misroute: ['###..', '...#.', '....#', '..#.#', '...##'],
  timeout: ['#####', '.#.#.', '..#..', '.#.#.', '#####'],
  power: ['..##.', '.##..', '#####', '..##.', '.##..'],
  heat: ['..#..', '.##..', '.###.', '#####', '.###.'],
  swap: ['.#...', '#####', '.#..#', '#..#.', '#####'],
};
/** A 5×5 failure-cause mark (D4.1's six causes). */
export function drawCause(g: G, cause: CauseMark, x: number, y: number, color: string = P.paper): void {
  const rows = CAUSE[cause];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) if (rows[j][i] === '#') px(g, x + i, y + j, color);
}

export const CART = 18;
export type CartState = 'wait' | 'picked' | 'failed';
/** Everything one cartridge draws. Reuse one object per slot. */
export interface CartArt {
  family: FamilyId | string; color: string; reqs: readonly ReqIcon[];
  state: CartState; cause: CauseMark | null;
  /** Seconds to the real pickup deadline, and the full window. */
  leftS: number; totalS: number;
  /** Group mode: one cartridge per family, no pips (the count is a DOM label). */
  group: boolean;
}
/** One 18×18 cartridge. The bar is the real countdown; it turns amber under 4 s and red under 2 s. */
export function drawCart(g: G, x: number, y: number, art: CartArt): void {
  const failed = art.state === 'failed';
  R(g, x, y, CART, CART, P.ink);
  R(g, x + 1, y + 1, CART - 2, CART - 2, failed ? P.faultLo : P.substrateHi);
  R(g, x + 1, y + 1, CART - 2, 1, failed ? P.fault : art.color);
  if (failed && art.cause) drawCause(g, art.cause, x + 3, y + 4, P.fault);
  else if (!failed) drawFamilyGlyph(g, art.family, x + 2, y + 3, art.color);
  if (!art.group && !failed) for (let i = 0; i < art.reqs.length && i < 3; i++) drawReq(g, art.reqs[i], x + 12, y + 3 + i * 4);
  R(g, x + 2, y + 14, CART - 4, 2, P.ink);
  if (failed || art.state === 'picked') return;
  const w = countdownWidth(art.leftS, art.totalS, CART - 4);
  R(g, x + 2, y + 14, w, 2, art.leftS < 2 ? P.fault : art.leftS < 4 ? P.amber : P.bit);
}
/** An empty rail slot. */
export function drawCartWell(g: G, x: number, y: number): void {
  R(g, x, y, CART, CART, P.well); R(g, x + 1, y + CART - 2, CART - 2, 1, P.wellHi);
}
/** The group-mode fail bin: the dominant cause, if any. The rate is a DOM label. */
export function drawFailBin(g: G, x: number, y: number, cause: CauseMark | null): void {
  R(g, x, y, CART, CART, P.ink); R(g, x + 1, y + 1, CART - 2, CART - 2, P.binLo); R(g, x + 1, y + 1, CART - 2, 1, P.fault);
  if (cause) drawCause(g, cause, x + 6, y + 6, P.fault);
}
/** The 12×9 mouth chevrons: steady, amber while the market warms up 8×. */
export function drawMouth(g: G, x: number, y: number, warm: boolean): void {
  const c = warm ? P.amber : P.silkLo;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) { px(g, x + 1 + j * 4 + i, y + 4 - i, c); px(g, x + 1 + j * 4 + i, y + 4 + i, c); }
}
