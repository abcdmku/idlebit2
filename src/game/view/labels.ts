import type { UnitRef } from '../types/ids';
import type { GameState } from '../types/state';

const ZONE_LETTERS = 'ABC';

/** Short in-world name of a unit: "System", "Server 3", "Rack 2", "Zone B", "eu-west". */
export function unitLabel(state: GameState, unit: UnitRef): string {
  const b = state.build;
  switch (unit.kind) {
    case 'system': {
      const s = b.systems[unit.id];
      if (!s || !b.racks[s.rack]?.opened) return 'System';
      return `${s.spec.kind === 'storageNode' ? 'Storage' : 'Server'} ${s.slot + 1}`;
    }
    case 'rack': return `Rack ${(b.racks[unit.id]?.slot ?? 0) + 1}`;
    case 'room': return `Zone ${ZONE_LETTERS[b.rooms[unit.id]?.zone ?? 0] ?? 'A'}`;
    case 'site': return b.sites[unit.id]?.region ?? 'Site';
  }
}
