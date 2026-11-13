// Pixel art for the market feed: the 5×5 failure-cause marks. The strip itself is DOM and belongs to the UI.
import { P } from './palette';
import { px } from './px';
import type { FailCause } from '../../game';

type G = CanvasRenderingContext2D;
export type CauseMark = FailCause;

const CAUSE: Readonly<Record<CauseMark, readonly string[]>> = {
  cantRun: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  misroute: ['###..', '...#.', '....#', '..#.#', '...##'],
  timeout: ['#####', '.#.#.', '..#..', '.#.#.', '#####'],
  swap: ['.#...', '#####', '.#..#', '#..#.', '#####'],
  // D26.5: missed its completion window: a clock face with its hands at the deadline.
  late: ['.###.', '#.#.#', '#.###', '#...#', '.###.'],
  // A tripped supply: a bolt.
  power: ['...#.', '..#..', '.###.', '..#..', '.#...'],
};
/** A 5×5 failure-cause mark. */
export function drawCause(g: G, cause: CauseMark, x: number, y: number, color: string = P.paper): void {
  const rows = CAUSE[cause];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) if (rows[j][i] === '#') px(g, x + i, y + j, color);
}
