import { LOC, type CompiledBuffers } from '../core/buffers';
import { ACCEL_CLOCKS, ACCEL_DOMAINS, MAX_ACCELS, POOL_DOMAIN } from '../core/constants';
import type { World } from '../core/world';
import { accelClockAt, accelClockIndex, anchorAccelDomain } from './accelerators';
import { sortedInsert } from './lists';
import { shapeOf, stageWorkAt, vramOf } from './shape';

interface RebasedStage { readonly s: number; readonly r: number; readonly remaining: number }

/**
 * Call after a build/research recompile and syncHotSizes, once against the final inventory.
 * Cold scopes must already have been killed against oldCompiled, even between rounds.
 * Pass inventoryChangedSystems for add/remove/replace/config edits, including hot-swap edits.
 * Hardware upgrade/research calls omit it. Inventory edits clear already-billed card duty.
 * rack.effClock is the boundary in both action and post-thermal research calls.
 */
export function reconcileAccelerators(w: World, oldCompiled: CompiledBuffers, inventoryChangedSystems: readonly number[] = []): void {
  const c = w.compiled.sys, h = w.hot.sys, rec = w.hot.rec;
  const changed = new Set(inventoryChangedSystems), converting = new Uint8Array(c.len);
  const stages: RebasedStage[] = [];
  let conversions = 0;
  for (let s = 0; s < c.len; s += 1) {
    let inventory = changed.has(s);
    for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
      const p = s * MAX_ACCELS + slot;
      if (oldCompiled.sys.accelKind[p] !== c.accelKind[p]) inventory = true;
    }
    // Recompile boundaries occur after billing. Never attribute old duty to shifted/new cards.
    for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
      const p = s * MAX_ACCELS + slot;
      if (inventory || c.accelKind[p] === 0) { h.accelTaskS[p] = 0; h.accelResearchS[p] = 0; }
    }
    if (c.alive[s] !== 1) continue;
    const linkChanged = s < oldCompiled.sys.len && oldCompiled.sys.gpuLinked[s] !== c.gpuLinked[s];
    if (!linkChanged) continue;
    if (c.gpuLinked[s] !== 1) {
      if (h.accelHolders[s * ACCEL_DOMAINS + POOL_DOMAIN]! > 0) throw new Error('reconcileAccelerators: unlink requires a cold kill against the old inventory');
      continue;
    }
    converting[s] = 1; conversions += 1;
    const e = w.hot.rack.effClock[c.rack[s]!]!;
    // Collect in old system/domain/mode/list order before any record links are changed.
    for (let d = 0; d < MAX_ACCELS; d += 1) {
      if (oldCompiled.sys.accelKind[s * MAX_ACCELS + d] !== 1) continue;
      for (let t = 0; t < 2; t += 1) {
        const i = s * ACCEL_CLOCKS + 2 * d + t, now = accelClockAt(w, i, e);
        for (let r = h.accelHead[i]!; r >= 0; r = rec.next[r]!) stages.push({ s, r, remaining: Math.max(0, rec.finish[r]! - now) });
        h.accelHead[i] = -1; h.accelActive[i] = 0;
      }
    }
    for (let d = 0; d < ACCEL_DOMAINS; d += 1) {
      h.accelUsedVram[s * ACCEL_DOMAINS + d] = 0; h.accelHolders[s * ACCEL_DOMAINS + d] = 0;
    }
    h.usedVram[s] = 0;
  }
  // One global pool pass, never one pass per system. Accumulate holds in fixed record order.
  if (conversions > 0) for (let r = 0; r < rec.len; r += 1) {
    if (rec.loc[r] !== LOC.running) continue;
    const s = rec.owner[r]!, d = rec.accelDomain[r]!;
    if (converting[s] !== 1 || d < 0) continue;
    if (d < MAX_ACCELS && oldCompiled.sys.accelKind[s * MAX_ACCELS + d] === 1) rec.accelDomain[r] = POOL_DOMAIN;
    const i = s * ACCEL_DOMAINS + rec.accelDomain[r]!, k = rec.count[r]!;
    const bits = vramOf(shapeOf(rec.family[r]!), rec.scale[r]!) * k;
    h.accelHolders[i] = h.accelHolders[i]! + k;
    h.accelUsedVram[i] = h.accelUsedVram[i]! + bits;
    h.usedVram[s] = h.usedVram[s]! + bits;
  }
  for (const { s, r, remaining } of stages) {
    const shape = shapeOf(rec.family[r]!), e = w.hot.rack.effClock[c.rack[s]!]!;
    const i = accelClockIndex(s, POOL_DOMAIN, shape.tensor);
    rec.finish[r] = accelClockAt(w, i, e) + remaining;
    rec.start[r] = rec.finish[r]! - stageWorkAt(shape, rec.stage[r]!, rec.scale[r]!);
    sortedInsert(w.hot, h.accelHead, i, r);
    h.accelActive[i] = h.accelActive[i]! + rec.count[r]!;
  }
  for (let s = 0; s < c.len; s += 1) {
    if (c.alive[s] !== 1) continue;
    const e = w.hot.rack.effClock[c.rack[s]!]!;
    // Hardware upgrades affect future rates while keeping W and every finish continuous.
    for (let d = 0; d < ACCEL_DOMAINS; d += 1) anchorAccelDomain(w, s, d, e);
  }
}
