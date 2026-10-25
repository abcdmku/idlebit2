import { readFileSync } from 'node:fs';
import { deserializeSave, quote, systemId } from '../../src/game';
const st = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const l = deserializeSave(st.save); if (!l.ok) throw 0;
const s = l.state;
for (const req of [
  { kind: 'part', part: { unit: { kind: 'system', id: systemId(0) }, slot: { kind: 'l2', socket: 0 } } },
  { kind: 'tray', at: { level: 'system', id: systemId(0) } },
] as const) {
  for (const q of quote(s, req as never).quotes) console.log(req.kind, q.label, q.cost, q.action.type, JSON.stringify(q.action).slice(0, 80), q.locked?.text ?? '');
}
