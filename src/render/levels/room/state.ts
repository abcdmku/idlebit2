// Small reads of the room snapshot shared by the world, mini and targets.
import type { RoomSnapshot } from '../../../game';

/** CRAC art by technology: air (fan unit, twin fan from generation 1), chilled-water CRAH, closed-loop liquid unit. */
export function coolGrade(s: RoomSnapshot): 1 | 2 | 3 | 4 {
  const c = s.cooler;
  return c.tech === 'closedLoop' ? 4 : c.tech === 'water' ? 3 : c.generation >= 1 ? 2 : 1;
}
