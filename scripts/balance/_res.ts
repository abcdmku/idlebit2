import { readFileSync } from 'node:fs';
import { deserializeSave } from '../../src/game';
import { creditReserve, nextCpuSave, income } from '../../src/game/probes/bot';
const l = deserializeSave((JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { save: string }).save); if (!l.ok) throw new Error(l.error);
const s = l.state; console.log('reserve', creditReserve(s), 'cpuSave', nextCpuSave(s), 'income', income(s), 'credits', s.wallet.credits, 'data', s.wallet.data, 'active', s.research.active, 'ports', s.build.racks[0]?.switch.ports.length, 'filters', s.build.racks[0]?.lb.filters);
