// Prints every tray, pipe, switch and part quote's action, label, cost and lock on the bench
// fixtures, one JSON line per quote, for diffing two source trees (diagnostic only).
// npx tsx scripts/bench/quoteEquivalence.ts > quotes.jsonl
import { advanceGame, quote, rackId, roomId, systemId, type GameState, type QuoteRequest } from '../../src/game';
import { FLEETS, type FleetName } from '../../src/game/testkit/fleets';

const requests = (s: GameState): QuoteRequest[] => {
  const out: QuoteRequest[] = [];
  for (const at of [
    { level: 'chip', id: systemId(0) }, { level: 'system', id: systemId(0) }, { level: 'rack', id: rackId(0) },
    { level: 'room', id: roomId(0) }, { level: 'global', id: 0 },
  ] as const) out.push({ kind: 'tray', at });
  out.push({ kind: 'pipe', system: systemId(0) });
  if (s.build.racks[0]) out.push({ kind: 'switch', sw: { kind: 'rack', id: rackId(0) } });
  if (s.build.rooms[0]) out.push({ kind: 'switch', sw: { kind: 'room', id: roomId(0) } });
  const unit = { kind: 'system' as const, id: systemId(0) };
  for (const slot of [{ kind: 'clock', socket: 0 }, { kind: 'l1', socket: 0 }, { kind: 'ram', index: 0 }, { kind: 'gpu', index: 0 }] as const) {
    out.push({ kind: 'part', part: { unit, slot } });
  }
  return out;
};

const names: FleetName[] = ['boot', 'rackFull', 'roomFull', 'fleetMaxHot'];
for (const name of names) {
  let state = FLEETS[name]();
  for (const ticks of [0, 300]) {
    if (ticks) state = advanceGame(state, ticks * 100).state;
    for (const r of requests(state)) {
      let quotes;
      try { quotes = quote(state, r).quotes; } catch (e) { console.log(JSON.stringify({ name, ticks, r, error: String(e) })); continue; }
      quotes.forEach((q, i) => console.log(JSON.stringify({ name, ticks, r, i, action: q.action, label: q.label, cost: q.cost,
        locked: q.locked, affordable: q.affordable, cold: q.cold, downtimeMs: q.downtimeMs })));
    }
  }
}
