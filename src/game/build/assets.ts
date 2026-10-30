import type { BuildState } from '../types/build';
import type { PartRef, PartSlot, ScopeRef } from '../types/ids';
import { ECC_PRICE_FACTOR, EXTRA_CORE_GROWTH, LADDERS, PARTS, SHELLS, isLadder, ladderInstall, networkStepsBetween, portAddPrice, scalePrice } from './catalog';
import { gpuInstallPrice } from './catalog/gpuModels';
import { lbQueueStepsTo } from './catalog/network';
import { readPart, withSpec, writePart } from './partAccess';
import { partFromNothing, rowsPrice } from './pricing';
import { memorySteps } from './memory';

export interface HardwareAsset { readonly key: string; readonly ref: PartRef | null; readonly version: string; readonly value: bigint }
export const assetKey = ({ unit, slot }: PartRef): string =>
  `${unit.kind}:${unit.kind === 'global' ? 0 : unit.id}:${slot.kind}:${'socket' in slot ? slot.socket : 0}:${'index' in slot ? slot.index : 0}`;

/** Only enumerate changed units. Settings and an unrelated part never acquire a purchase cost. */
export function changedAssets(build: BuildState, other: BuildState): Map<string, HardwareAsset> {
  const out = new Map<string, HardwareAsset>();
  const extra = (key: string, version: string, value: bigint) => out.set(key, { key, ref: null, version, value });
  const part = (unit: ScopeRef, slot: PartSlot, opened = true) => {
    const ref = { unit, slot }, p = readPart(build, ref);
    if (!p || (isLadder(p.id) ? p.level < 0 : p.level === 0)) return;
    let version = `${opened}:${p.gen}:${p.level}`, value = 0n;
    if (unit.kind === 'system') {
      const s = build.systems[unit.id]!.spec;
      if (slot.kind === 'ram' || slot.kind === 'drive') {
        const m = (slot.kind === 'ram' ? s.ram : s.drives)[slot.index]!;
        const row = PARTS[slot.kind === 'ram' ? 'ram' : 'storage'], ecc = 'ecc' in m && m.ecc;
        version += `:${ecc}`;
        value = partFromNothing(row, { ...m, speedLevel: 1 }, slot.index);
        let speed = memorySteps(row, m.gen, 1, m.speedLevel);
        if (ecc) { value = scalePrice(value, ECC_PRICE_FACTOR); speed = scalePrice(speed, ECC_PRICE_FACTOR); }
        const key = `${assetKey(ref)}:speed`;
        out.set(key, { key, ref, version: `${opened}:${m.gen}:${m.speedLevel}:${ecc}`, value: speed });
      } else if (slot.kind === 'gpu' && p.gpu) {
        version = p.gpu.model;
        value = gpuInstallPrice(p.gpu.model, s.accels.slice(0, slot.index).filter(a => a.kind === 'gpu').length);
      } else value = partFromNothing(PARTS[p.id as keyof typeof PARTS], p,
        slot.kind === 'core' ? slot.index : slot.kind === 'gpu' ? s.accels.slice(0, slot.index).filter(a => a.kind === 'npu').length : 0,
        slot.kind === 'core' ? EXTRA_CORE_GROWTH : undefined, slot.kind === 'clock' ? s.cpu?.cores.length ?? 1 : 1);
    } else if (p.id === 'switch' || p.id === 'roomSwitch') {
      const sw = unit.kind === 'rack' ? build.racks[unit.id]!.switch : unit.kind === 'room' ? build.rooms[unit.id]!.switch : null;
      if (!sw || !sw.ports.length && !sw.uplinks.length) return;
      const row = LADDERS[p.id];
      version = `${opened}:${sw.gen}:1`; value = ladderInstall(row, sw.gen);
      for (const [kind, ports] of [['port', sw.ports], ['uplink', sw.uplinks]] as const) ports.forEach((k, index) => {
        const extra = kind === 'port' ? index + 1 - row.minPorts : index;
        const key = `${assetKey(ref)}:${kind}:${index}`;
        out.set(key, { key, ref, version: `${opened}:${sw.gen}:${k}`, value: (extra > 0 ? portAddPrice(row, sw.gen, extra) : 0n)
          + networkStepsBetween(row, row.baseK[sw.gen]!, k, kind === 'uplink') });
      });
    } else if (isLadder(p.id)) {
      const row = LADDERS[p.id], zones = unit.kind === 'site' ? Math.max(1, build.sites[unit.id]!.zones.filter(z => z !== null).length) : 1;
      value = ladderInstall(row, p.gen) + networkStepsBetween(row, row.baseK[p.gen]!, p.level, false, zones);
      if (slot.kind === 'dataPlane' && unit.kind === 'site') {
        const queue = build.sites[unit.id]!.dataPlane.router.queueLevel;
        const key = `${assetKey(ref)}:queue`;
        out.set(key, { key, ref, version: String(queue), value: lbQueueStepsTo('site', queue) });
      }
    } else {
      value = partFromNothing(PARTS[p.id as keyof typeof PARTS], p, slot.kind === 'ups' ? slot.index : 0);
      const router = slot.kind === 'lb' && unit.kind === 'rack' ? build.racks[unit.id]!.lb
        : slot.kind === 'roomLb' && unit.kind === 'room' ? build.rooms[unit.id]!.lb : null;
      if (router) {
        const key = `${assetKey(ref)}:queue`;
        out.set(key, { key, ref, version: String(router.queueLevel), value: lbQueueStepsTo(unit.kind === 'rack' ? 'rack' : 'room', router.queueLevel) });
      }
    }
    out.set(assetKey(ref), { key: assetKey(ref), ref, version, value });
  };
  for (const s of build.systems) if (s && s !== other.systems[s.id]) {
    const unit = { kind: 'system' as const, id: s.id }, spec = s.spec;
    if (spec.kind === 'storageNode') extra(`system:${s.id}:shell`, 'storageNode', BigInt(SHELLS.storageNode.price));
    if (spec.cpu) for (let socket = 0; socket < spec.cpuCount; socket++) {
      for (const kind of ['cpu', 'clock', 'cache'] as const) part(unit, { kind, socket });
      spec.cpu.cores.forEach((_, index) => part(unit, { kind: 'core', socket, index }));
    }
    part(unit, { kind: 'scheduler' });
    for (const [kind, modules] of [['ram', spec.ram], ['gpu', spec.accels], ['drive', spec.drives]] as const)
      modules.forEach((_, index) => part(unit, { kind, index }));
  }
  for (const r of build.racks) if (r && r !== other.racks[r.id]) {
    const unit = { kind: 'rack' as const, id: r.id };
    extra(`rack:${r.id}:shell`, String(r.opened), BigInt(SHELLS.rack.price));
    for (const kind of ['rackCooler', 'pdu', 'lb', 'switch', 'powerCtl'] as const) part(unit, { kind }, r.opened);
  }
  for (const r of build.rooms) if (r && r !== other.rooms[r.id]) {
    const unit = { kind: 'room' as const, id: r.id };
    extra(`room:${r.id}:shell`, String(r.opened), BigInt(SHELLS.zone.price));
    extra(`room:${r.id}:rows`, String(r.rows), rowsPrice(r.rows));
    for (const kind of ['roomCooler', 'roomLb', 'roomSwitch', 'roomStart'] as const) part(unit, { kind }, r.opened);
    r.ups.forEach((_, index) => part(unit, { kind: 'ups', index }, r.opened));
  }
  for (const s of build.sites) if (s && s !== other.sites[s.id]) {
    const unit = { kind: 'site' as const, id: s.id };
    extra(`site:${s.id}:shell`, String(s.opened), BigInt(SHELLS.site.price));
    for (const kind of ['grid', 'dataPlane', 'backbone', 'generation'] as const) part(unit, { kind }, s.opened);
  }
  if (build.global !== other.global) for (const kind of ['globalScheduler', 'globalStart'] as const) part({ kind: 'global' }, { kind });
  return out;
}

/** Keep the paid steps of bulk purchases separately so a later single downgrade is exact. */
export function assetPurchaseSteps(build: BuildState, asset: HardwareAsset, old?: HardwareAsset): readonly { version: string; weight: bigint }[] {
  const fallback = [{ version: asset.version, weight: 1n }], ref = asset.ref;
  if (!ref || asset.key.endsWith(':queue')) return fallback;
  const p = readPart(build, ref);
  if (!p || p.gpu) return fallback;
  if (isLadder(p.id)) {
    if (p.id !== 'switch' && p.id !== 'roomSwitch' || !/:(port|uplink):/.test(asset.key)) return fallback;
    const row = LADDERS[p.id], base = row.baseK[p.gen]!, level = Number(asset.version.split(':')[2]);
    const prior = old?.version.split(':'), sameGen = prior?.[1] === String(p.gen), start = sameGen ? Number(prior[2]) + 1 : base;
    const up = asset.key.includes(':uplink:'), install = asset.value - networkStepsBetween(row, base, level, up);
    let value = sameGen ? old!.value : 0n;
    const steps = [];
    for (let k = start; k <= level; k++) {
      const next = install + networkStepsBetween(row, base, k, up);
      steps.push({ version: `${asset.version.split(':')[0]}:${p.gen}:${k}`, weight: next > value ? next - value : 0n }); value = next;
    }
    return steps.length ? steps : fallback;
  }
  const speed = asset.key.endsWith(':speed'), spec = ref.unit.kind === 'system' ? build.systems[ref.unit.id]!.spec : null;
  const module = spec && (ref.slot.kind === 'ram' ? spec.ram[ref.slot.index] : ref.slot.kind === 'drive' ? spec.drives[ref.slot.index] : null);
  const level = speed && module ? module.speedLevel : p.level;
  const prior = old?.version.split(':');
  const sameGen = prior?.[1] === String(p.gen);
  const start = sameGen ? Number(prior[2]) + 1 : 1;
  if (level < start || level - start < 1) return fallback;
  let value = sameGen ? old!.value : 0n;
  const steps: { version: string; weight: bigint }[] = [];
  for (let l = start; l <= level; l++) {
    const intermediate = speed && spec && ref.unit.kind === 'system'
      ? withSpec(build, ref.unit.id, ref.slot.kind === 'ram'
        ? { ...spec, ram: spec.ram.map((m, i) => 'index' in ref.slot && i === ref.slot.index ? { ...m, speedLevel: l } : m) }
        : { ...spec, drives: spec.drives.map((m, i) => 'index' in ref.slot && i === ref.slot.index ? { ...m, speedLevel: l } : m) })
      : writePart(build, ref, p.gen, l);
    const step = l === level ? asset : intermediate && changedAssets(intermediate, build).get(asset.key);
    if (!step) return fallback;
    steps.push({ version: step.version, weight: step.value > value ? step.value - value : 1n }); value = step.value;
  }
  return steps;
}
