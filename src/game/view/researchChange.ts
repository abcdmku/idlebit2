import { capacity2, partName, PARTS } from '../build/catalog';
import { lossFraction } from '../build/catalog/curves';
import { RESEARCH } from '../build/research/tree';
import { newestGen } from '../build/research/unlocks';
import { TICK_MS } from '../core/constants';
import type { CeilingId, PartId, ResearchDef, ResearchEffect } from '../types/catalog';
import type { GameState } from '../types/state';
import type { ResearchChangeView } from '../types/views';

/*
 * The concrete before → after a research node makes to the part it upgrades, against the current
 * unlocks (ResearchNodeView.change). Only effects with one clean scalar: a ceiling, one part's
 * generation, or a rule with a single number (C-state idle power, offline cap, boot time). Fabs and
 * structure nodes (several generations at once) and rules without a scalar give null.
 */

const CEILING_LABEL: Partial<Record<CeilingId, string>> = {
  coreSites: 'Cores per CPU', threadsPerCore: 'Threads per core', cpuSockets: 'CPUs per board',
  ramSlots: 'RAM slots', gpuSlots: 'GPU slots', driveSlots: 'Drive slots', rackPorts: 'Rack ports', roomPorts: 'Room ports',
  uplinks: 'Uplinks', researchQueue: 'Research queue', roomRows: 'Room rows', siteZones: 'Zones per site', sites: 'Sites', regions: 'Regions',
};
const GEN_LABEL: Partial<Record<PartId, string>> = {
  core: 'Cores', clock: 'Clock', l1: 'L1 cache', l2: 'L2 cache', l3: 'L3 cache', ram: 'RAM', gpu: 'GPU', npu: 'NPU',
  storage: 'Drive', storageNode: 'Storage node', psu: 'Power supply', switch: 'Switch', lb: 'Load balancer', pdu: 'PDU', ups: 'UPS',
  rackCooler: 'Rack cooling', roomCooler: 'Room cooling', dataPlane: 'Data plane', backbone: 'Backbone', grid: 'Grid feed',
};

const percent = (f: number): string => `${Math.round(f * 100)}%`;
const change = (label: string, before: string, after: string): ResearchChangeView => ({ label, before, after });

/** The scheduler's queue at level 1 of generation g, as the board prints it. */
const queueText = (g: number): string => (g < 0 ? 'No queue' : `${capacity2(PARTS.scheduler, g, 1)} tasks`);
/** Before for a part with no generation researched yet: a dash, never "none → Hz L2". */
const NOT_YET = '—';

function genChange(state: GameState, e: Extract<ResearchEffect, { kind: 'gen' }>): ResearchChangeView | null {
  const u = state.research.unlocks;
  const row = PARTS[e.part as keyof typeof PARTS];
  const have = row ? newestGen(u, e.part, row.base.length) : -1;
  if (e.part === 'scheduler') return change('Queue', queueText(have), queueText(e.gen));
  if (e.part === 'psu') return psuChange(state, have, e.gen);
  const label = GEN_LABEL[e.part];
  if (!label) return null;
  return change(label, have < 0 ? NOT_YET : partName(e.part, have), partName(e.part, e.gen));
}

/**
 * A power supply generation: its loss at typical load (×1 up to 90% usage). Before: the installed
 * supply of the player's first system (its level adds loss), else the best researched generation
 * at L1. After: the new generation at L1, as a replace installs it.
 */
function psuChange(state: GameState, have: number, gen: number): ResearchChangeView {
  const psu = state.build.systems.find((s) => s !== null)?.spec.psu ?? null;
  const before = psu ? percent(lossFraction(PARTS.psu, psu.gen, psu.level)) : have >= 0 ? percent(lossFraction(PARTS.psu, have, 1)) : NOT_YET;
  return change('Power supply loss', before, percent(lossFraction(PARTS.psu, gen, 1)));
}

/** Idle power of a sleeping core: the deepest researched C-state's factor, or full power. */
function idleCoreFactor(state: GameState): number {
  const done = new Set(state.research.completed);
  let factor = 1;
  for (const def of RESEARCH) {
    if (!done.has(def.id)) continue;
    for (const e of def.effects) if (e.kind === 'rule' && e.id === 'coreIdle' && e.params?.factor !== undefined) factor = Math.min(factor, e.params.factor);
  }
  return factor;
}

function ruleChange(state: GameState, e: Extract<ResearchEffect, { kind: 'rule' }>): ResearchChangeView | null {
  const u = state.research.unlocks, p = e.params ?? {};
  switch (e.id) {
    case 'coreIdle': return p.factor === undefined ? null : change('Idle core power', percent(idleCoreFactor(state)), percent(p.factor));
    case 'offlineCap': return p.hours === undefined ? null : change('Offline cap', `${u.offlineCapHours} h`, `${p.hours} h`);
    case 'bootSeconds': return p.seconds === undefined ? null : change('Boot time', `${(u.bootTicks * TICK_MS) / 1000} s`, `${p.seconds} s`);
    default: return null;
  }
}

/** The node's before → after, or null when it has no clean scalar. */
export function researchChange(state: GameState, def: ResearchDef): ResearchChangeView | null {
  const gens = def.effects.filter((e) => e.kind === 'gen');
  // Several generations at once (fabs, structure nodes): no single part to show.
  if (gens.length > 1 || def.effects.some((e) => e.kind === 'view')) return null;
  if (gens.length === 1) return genChange(state, gens[0] as Extract<ResearchEffect, { kind: 'gen' }>);
  for (const e of def.effects) {
    if (e.kind === 'ceiling') {
      const label = CEILING_LABEL[e.key];
      return label ? change(label, String(state.research.unlocks.ceilings[e.key] ?? 0), String(e.value)) : null;
    }
    if (e.kind === 'rule') { const c = ruleChange(state, e); if (c) return c; }
  }
  return null;
}
