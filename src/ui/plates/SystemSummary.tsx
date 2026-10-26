// The system at a glance (user, 26 Oct: never an empty plate): what is in the box, one row per part, each
// opening that part's own plate. Tapping the CPU in the world goes inside.
import type { LevelSnapshot, PartRef, SystemId } from '../../game';
import { bits, hertz, watts } from './format';

type Sys = Extract<LevelSnapshot, { level: 'system' }>;

export interface SummaryRow { readonly key: string; readonly label: string; readonly value: string; readonly part: PartRef | null }

/** CPU, cache, RAM, storage, GPU and power supply load, in words. */
export function summaryRows(f: Sys): SummaryRow[] {
  const unit = { kind: 'system', id: f.systemId as SystemId } as const;
  const tier = (t: 'cache' | 'ram' | 'disk') => f.memory.tiers.find(x => x.tier === t);
  const mem = (t: 'cache' | 'ram' | 'disk') => { const x = tier(t); return x && x.capacityBits > 0 ? `${bits(x.usedBits)} of ${bits(x.capacityBits)}` : 'none'; };
  const cores = f.chip.cores.length;
  return [
    { key: 'cpu', label: 'CPU', value: `${hertz(f.chip.clock.effectiveHz)} · ${cores} ${cores === 1 ? 'core' : 'cores'}`, part: { unit, slot: { kind: 'cpu', socket: 0 } } },
    { key: 'cache', label: 'Cache', value: mem('cache'), part: { unit, slot: { kind: 'l1', socket: 0 } } },
    { key: 'ram', label: 'RAM', value: mem('ram'), part: f.ram.length ? { unit, slot: { kind: 'ram', index: 0 } } : null },
    { key: 'drive', label: 'Storage', value: mem('disk'), part: f.storage.length ? { unit, slot: { kind: 'drive', index: 0 } } : null },
    { key: 'gpu', label: 'GPU', value: f.gpu.length ? `${f.gpu.length} ${f.gpu.length === 1 ? 'card' : 'cards'}` : 'none', part: f.gpu.length ? { unit, slot: { kind: 'gpu', index: f.gpu[0]!.slot } } : null },
    { key: 'psu', label: 'Power supply', value: `${watts(f.psu.deliveredW)} of ${watts(f.psu.capacityW)}`, part: { unit, slot: { kind: 'psu' } } },
  ] as SummaryRow[];
}

export function SystemSummary({ focus, onOpenPart }: { focus: Sys; onOpenPart: (part: PartRef, key: string) => void }) {
  return <>
    <ul className="sys-summary" aria-label="In this system">
      {summaryRows(focus).map(r => <li key={r.key}>
        <button type="button" className="sum-row" disabled={!r.part} data-qa-target onClick={() => r.part && onOpenPart(r.part, r.key)}>
          <b>{r.label}</b><span>{r.value}</span></button>
      </li>)}
    </ul>
  </>;
}
