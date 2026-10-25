// The offline bench on any fixture and span (diagnostic only; the budget case is run.ts --only=offline).
// npx tsx scripts/bench/offlineSpan.ts [fleetMax|roomFull|...] [hours=2]
// Example: roomFull 48 is the researched 48 h offline cap (offline48) at the Room era.
import type { FleetName } from '../../src/game/testkit/fleets';
import { benchOffline } from './offline';

const fleet = (process.argv[2] ?? 'fleetMax') as FleetName, hours = Number(process.argv[3] ?? 2);
const r = await benchOffline('G4', fleet, hours * 3_600_000);
console.log(`${fleet} ${hours} h offline: ${r.value} s (${r.status} against the 10 s budget), ${r.note}`);
process.exit(0);
