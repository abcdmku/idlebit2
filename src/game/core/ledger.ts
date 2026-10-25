import { type Amount } from '../amount';
import type { GameState, LedgerSample } from '../types/state';
import { MAX_FAMILIES, NET_WINDOW_TICKS, REGIONS, DT_S, TICKS_PER_SECOND } from './constants';
import { pushEvent } from './events';
import { toAmount, type World } from './world';

/**
 * Ledger phase (spec §9.8), once per tick:
 * 1. Credits: Σ count × payout over this tick's tally pairs (exact bigint).
 * 2. Data: dataMeter += Σ per-family data in family order; whole Data credited.
 * 3. Energy: energyMeter += Σ region W × dt × price in region order; whole Credits debited.
 * Then insolvency (spec §11.4) and the net/min change-point ring.
 * Reads and clears hot.tally, hot.fam.dataTick and hot.bill.
 */
export function ledgerPhase(w: World): void {
  const { hot, ledger: l } = w;

  let gross = 0n;
  const tally = hot.tally;
  for (let i = 0; i < tally.len; i += 1) gross += BigInt(tally.pay[i]!) * BigInt(tally.count[i]!);
  tally.len = 0;

  let dataMeter = l.dataMeter;
  const dataTick = hot.fam.dataTick;
  for (let f = 0; f < MAX_FAMILIES; f += 1) {
    const d = dataTick[f]!;
    if (d !== 0) { dataMeter += d; dataTick[f] = 0; }
  }
  const wholeData = Math.floor(dataMeter);
  l.dataMeter = dataMeter - wholeData;

  let energyMeter = l.energyMeter;
  const bill = hot.bill;
  for (let r = 0; r < bill.length; r += 1) {
    const watts = bill[r]!;
    if (watts !== 0) { energyMeter += watts * DT_S * REGIONS[r]!.energyPrice; bill[r] = 0; }
  }
  const wholeEnergy = Math.floor(energyMeter);
  l.energyMeter = energyMeter - wholeEnergy;

  const data = BigInt(wholeData);
  const energy = BigInt(wholeEnergy);
  if (gross !== 0n || data !== 0n || energy !== 0n) {
    l.credits += gross - energy;
    l.data += data;
    l.gross += gross; l.energy += energy; l.dataEarned += data;
    l.callGross += gross; l.callEnergy += energy; l.callData += data;
    if (w.round.phase === 'running') { l.roundGross += gross; l.roundEnergy += energy; l.roundData += data; }
  }

  const research = w.research;
  if (l.credits < 0n && research.active !== null && !research.stoppedInsolvent) {
    research.stoppedInsolvent = true;
    pushEvent(w, { kind: 'researchStopped', project: research.active });
  }

  if (gross !== 0n || energy !== 0n) recordNet(w);
}

/**
 * Records a net change point stamped with the end of the second it happened in; changes within
 * one second overwrite that second's sample. Recording at the change (not at the boundary) means
 * a quiescent skip over the boundary loses nothing.
 */
function recordNet(w: World): void {
  const l = w.ledger;
  const ring = l.netRing;
  const stamp = (Math.floor(w.tick / TICKS_PER_SECOND) + 1) * TICKS_PER_SECOND;
  const sample = { tick: stamp, gross: toAmount(l.gross), energy: toAmount(l.energy) };
  if (ring.length > 0 && ring[ring.length - 1]!.tick === stamp) { ring[ring.length - 1] = sample; return; }
  ring.push(sample);
  const windowStart = stamp - NET_WINDOW_TICKS;
  let keepFrom = 0;
  for (let i = 0; i < ring.length; i += 1) if (ring[i]!.tick <= windowStart) keepFrom = i;
  if (keepFrom > 0) ring.splice(0, keepFrom);
}

const netAt = (ring: readonly LedgerSample[], tick: number): bigint => {
  let value = 0n;
  for (const sample of ring) {
    if (sample.tick > tick) break;
    value = BigInt(sample.gross) - BigInt(sample.energy);
  }
  return value;
};

/** Whole Credits per minute over the trailing 60 s (or since tick 0 if shorter), truncated. */
export function netPerMinute(state: GameState): Amount {
  const now = state.clock.tick;
  if (now <= 0) return toAmount(0n);
  const current = BigInt(state.ledger.gross) - BigInt(state.ledger.energy);
  const span = Math.min(now, NET_WINDOW_TICKS);
  const base = now >= NET_WINDOW_TICKS ? netAt(state.ledger.netRing, now - NET_WINDOW_TICKS) : 0n;
  return toAmount(((current - base) * BigInt(NET_WINDOW_TICKS)) / BigInt(span));
}

/** Round totals as Amounts, for the round phase freezing a report mid-advance. */
export function roundTotals(w: World): { gross: Amount; data: Amount; energy: Amount; net: Amount } {
  const l = w.ledger;
  return { gross: toAmount(l.roundGross), data: toAmount(l.roundData), energy: toAmount(l.roundEnergy), net: toAmount(l.roundGross - l.roundEnergy) };
}

export function resetRoundTotals(w: World): void {
  w.ledger.roundGross = 0n; w.ledger.roundData = 0n; w.ledger.roundEnergy = 0n;
}
