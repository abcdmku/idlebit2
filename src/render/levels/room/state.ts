// Small reads of the room snapshot shared by the world, mini and targets.
import type { RoomSnapshot } from '../../../game';

/** The room has power: not dark, and at least one UPS feed is up. */
export function roomPowered(s: RoomSnapshot): boolean {
  if (s.online === 'dark') return false;
  if (s.ups.length === 0) return true;
  for (let i = 0; i < s.ups.length; i++) if (!s.ups[i].failed) return true;
  return false;
}
/** CRAC art by technology: air (fan unit, twin fan from generation 1), chilled-water CRAH, closed-loop liquid unit. */
export function coolGrade(s: RoomSnapshot): 1 | 2 | 3 | 4 {
  const c = s.cooler;
  return c.tech === 'closedLoop' ? 4 : c.tech === 'water' ? 3 : c.generation >= 1 ? 2 : 1;
}
