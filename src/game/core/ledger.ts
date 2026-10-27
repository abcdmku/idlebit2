import { G } from './buffers';
import type { EnergyBreakdown } from '../types/report';
import { type Amount } from '../amount';
import type { GameState, LedgerSample } from '../types/state';
import { MAX_FAMILIES, NET_WINDOW_TICKS, REGIONS, DT_S, TICKS_PER_SECOND } from './constants';
import { pushEvent } from './events';
import { toAmount, type World } from './world';
import { FAMILIES, payoutCreditsAt } from '../market/families';

/**
 * Ledger phase (spec §9.8), once per tick:
 * 1. Credits: Σ count × exact recipe reward over this tick's completed descriptors (bigint).
 * 2. Data: dataMeter += Σ per-family data in family order; whole Data credited.
 * 3. Energy: energyMeter += Σ region W × dt × price in region order; whole Credits debited.
 * Then insolvency (spec §11.4) and the net/min change-point ring.
 * Reads and clears hot.tally, hot.fam.dataTick and hot.bill.
 */
export function ledgerPhase(w: World): void {
  const { hot, ledger: l } = w;

  let gross = 0n;
  const tally = hot.tally;
  for (let i = 0; i < tally.len; i += 1) {
    gross += BigInt(payoutCreditsAt(FAMILIES[tally.family[i]!]!, tally.units[i]!)) * BigInt(tally.count[i]!);
  }
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
  l.energyMeter = energyMeter;
  settleLedger(w, gross, BigInt(wholeData));
}

/** Settles accumulated energy and tick earnings, or a between-tick battery refill, immediately. */
export function settleLedger(w: World, gross = 0n, data = 0n): void {
  const l = w.ledger;
  const wholeEnergy = Math.floor(l.energyMeter);
  l.energyMeter -= wholeEnergy;
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
  } else if (l.credits >= 0n && research.stoppedInsolvent) {
    // QA-04: a project stopped for insolvency resumes by itself once Credits are back at 0 or above.
    research.stoppedInsolvent = false;
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
  // The rounded stamp may be up to a second ahead of the simulation. Keep the predecessor
  // of the actual query boundary, or netAt can find no base and report lifetime net as /min.
  const windowStart = w.tick - NET_WINDOW_TICKS;
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

/**
 * D31 round energy lines (Credits at the region price): billed is the ledger's round energy, which
 * includes the refill and fuel; fromBattery and fromGeneration were not billed.
 */
export function energyBreakdown(w: World): EnergyBreakdown {
  const g = w.hot.g, whole = (x: number): Amount => String(Math.max(0, Math.round(x))) as Amount;
  return {
    billed: toAmount(w.ledger.roundEnergy), fromBattery: whole(g[G.roundFromBattery]!), batteryRefill: whole(g[G.roundBatteryRefill]!),
    fromGeneration: whole(g[G.roundFromGeneration]!), fuel: whole(g[G.roundFuel]!),
  };
}

export function resetRoundTotals(w: World): void {
  const g = w.hot.g;
  g[G.roundFromBattery] = 0; g[G.roundBatteryRefill] = 0; g[G.roundFromGeneration] = 0; g[G.roundFuel] = 0;
  w.ledger.roundGross = 0n; w.ledger.roundData = 0n; w.ledger.roundEnergy = 0n;
}
