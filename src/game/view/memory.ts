import { LOC, type HotBuffers } from '../core/buffers';
import { ACCEL_DOMAINS } from '../core/constants';
import type { MemTier } from '../types/catalog';
import type { GameState } from '../types/state';
import type { MemTierView } from '../types/views';
import { forEachRunning } from './tasks';

/**
 * D26.7 views of the memory hierarchy: tier bars per system, cache spill on the CPU, a shard's placement
 * and the tier its current mem part reads, and unified-memory VRAM overflow per GPU domain.
 */

/** Bits system s's running shards placed outside cache (RAM, disk, the storage node). */
export function spilledOutOfCache(state: GameState, s: number): number {
  const rec = state.hot.rec;
  let bits = 0;
  forEachRunning(state, s, (r) => { bits += (rec.memR[r]! + rec.memD[r]!) * rec.count[r]!; });
  return bits;
}

/** Bits system s's running shards hold on its rack's storage node. */
function onNode(state: GameState, s: number): number {
  const rec = state.hot.rec;
  let bits = 0;
  forEachRunning(state, s, (r) => { bits += (rec.memN[r]! + rec.vramN[r]!) * rec.count[r]!; });
  return bits;
}

/** Cache, RAM, disk. Every RAM and disk bit sits there because a faster tier was full: spilled = used. */
export function memoryTiers(state: GameState, s: number): MemTierView[] {
  const c = state.compiled.sys, h = state.hot.sys, node = c.diskNode[s] ?? -1;
  const diskCap = (c.storageCap[s] ?? 0) + (node >= 0 ? c.storageCap[node] ?? 0 : 0);
  const diskUsed = (h.usedDisk[s] ?? 0) + (node >= 0 ? onNode(state, s) : 0);
  const ioRate = (c.ioRate[s] ?? 0) + (node >= 0 ? c.ioRate[node] ?? 0 : 0);
  return [
    { tier: 'cache', capacityBits: c.cacheBits[s] ?? 0, usedBits: h.usedCache[s] ?? 0, spilledBits: 0, rateBits: null },
    { tier: 'ram', capacityBits: c.ramCap[s] ?? 0, usedBits: h.usedRam[s] ?? 0, spilledBits: h.usedRam[s] ?? 0, rateBits: c.ramBw[s] ?? 0 },
    { tier: 'disk', capacityBits: diskCap, usedBits: diskUsed, spilledBits: diskUsed, rateBits: ioRate },
  ];
}

/** Unified-memory VRAM overflow of the shards holding domain `domain` of system s (D26.4). */
export function unifiedSpill(state: GameState, s: number, domain: number): number {
  const rec = state.hot.rec;
  let bits = 0;
  forEachRunning(state, s, (r) => {
    if (rec.accelDomain[r] === domain) bits += (rec.vramR[r]! + rec.vramD[r]!) * rec.count[r]!;
  });
  return domain >= 0 && domain < ACCEL_DOMAINS ? bits : 0;
}

/** A record's placement (bits per task) and the tier its current part reads: clock RAM → ram, IO → disk. */
export function placementOf(hot: HotBuffers, r: number, res: number): { placement: { cache: number; ram: number; disk: number }; memTier: MemTier | null } {
  const running = hot.rec.loc[r] === LOC.running;
  return {
    placement: running ? { cache: hot.rec.memC[r] ?? 0, ram: hot.rec.memR[r] ?? 0, disk: hot.rec.memD[r] ?? 0 } : { cache: 0, ram: 0, disk: 0 },
    memTier: !running ? null : res === 1 ? 'ram' : res === 3 ? 'disk' : null,
  };
}
