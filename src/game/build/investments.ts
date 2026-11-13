import { amount } from '../amount';
import type { GameAction } from '../types/actions';
import type { BuildState, HardwarePayment } from '../types/build';
import type { PartSlot } from '../types/ids';
import { assetKey, assetPurchaseSteps, changedAssets, type HardwareAsset } from './assets';
import { CREDITS_PER_DATA_PART, isDataAsset, splitCost, type Cost } from './currency';

const paid = (payments: readonly HardwarePayment[]) => payments.reduce((sum, p) => sum + BigInt(p.credits), 0n);

/** Removed indexed parts compact; their surviving neighbours keep their own cost histories. */
function destination(asset: HardwareAsset, before: BuildState, action?: GameAction): string | null {
  if (action?.type !== 'removePart' || !asset.ref || action.part.unit.kind !== 'system'
    || asset.ref.unit.kind !== 'system' || action.part.unit.id !== asset.ref.unit.id) return asset.key;
  const removed = action.part.slot, slot = asset.ref.slot;
  const suffix = asset.key.slice(assetKey(asset.ref).length);
  if (removed.kind === 'cpu' && 'socket' in slot) {
    const index = removed.socket ?? Math.max(0, (before.systems[action.part.unit.id]?.spec.cpuCount ?? 1) - 1);
    if (slot.socket === index) return null;
    return assetKey({ ...asset.ref, slot: { ...slot, socket: slot.socket > index ? slot.socket - 1 : slot.socket } }) + suffix;
  }
  if ('index' in removed && 'index' in slot && removed.kind === slot.kind) {
    if (slot.index === removed.index) return null;
    return assetKey({ ...asset.ref, slot: { ...slot, index: slot.index > removed.index ? slot.index - 1 : slot.index } as PartSlot }) + suffix;
  }
  return asset.key;
}

/**
 * Half the paid cost being relinquished, never half a newly inflated replacement price. Payments are kept in
 * Credit value; D83 Data parts are paid and refunded at that value ÷ CREDITS_PER_DATA_PART in Data.
 */
export function investmentChange(before: BuildState, after: BuildState, price: bigint, action?: GameAction): {
  readonly investments: Record<string, readonly HardwarePayment[]>; readonly cost: Cost; readonly refund: Cost;
} {
  const maintenance = action?.type === 'downgradePart' || action?.type === 'removePart' || action?.type === 'removeUnit';
  const refunding = maintenance || action?.type === 'applyConfig';
  const have = changedAssets(before, after), want = changedAssets(after, before);
  const investments: Record<string, readonly HardwarePayment[]> = { ...before.investments };
  const oldAt = new Map<string, { asset: HardwareAsset; history: readonly HardwarePayment[] }>();
  let lostCredits = 0n, lostData = 0n;
  const lose = (asset: HardwareAsset, value: bigint) => { if (isDataAsset(asset)) lostData += value; else lostCredits += value; };
  for (const asset of have.values()) delete investments[asset.key];
  for (const asset of have.values()) {
    const history = before.investments[asset.key] ?? [{ version: asset.version, credits: amount('0') }];
    const key = destination(asset, before, action);
    if (key && want.has(key)) oldAt.set(key, { asset, history });
    else if (refunding) lose(asset, paid(history));
  }
  const purchases: { key: string; asset: HardwareAsset; old?: HardwareAsset; history: readonly HardwarePayment[]; weight: bigint }[] = [];
  for (const asset of want.values()) {
    const old = oldAt.get(asset.key);
    if (old?.asset.version === asset.version) { if (paid(old.history) > 0n) investments[asset.key] = old.history; continue; }
    if (old && maintenance) {
      let prior = old.history.length - 1;
      while (prior >= 0 && old.history[prior]!.version !== asset.version) prior--;
      if (prior >= 0) { lose(asset, paid(old.history.slice(prior + 1))); investments[asset.key] = old.history.slice(0, prior + 1); }
      else {
        const basis = paid(old.history), reduction = old.asset.value > asset.value ? old.asset.value - asset.value : 0n;
        const removed = old.asset.value > 0n ? basis * reduction / old.asset.value : basis;
        lose(asset, removed);
        investments[asset.key] = [{ version: asset.version, credits: amount((basis - removed).toString()) }];
      }
    } else {
      const delta = asset.value - (old?.asset.value ?? 0n);
      purchases.push({ key: asset.key, asset, old: old?.asset, history: old?.history ?? [], weight: delta > 0n ? delta : asset.value });
    }
  }
  const weight = purchases.reduce((sum, p) => sum + p.weight, 0n);
  let remaining = price, dataValue = 0n;
  purchases.forEach((p, i) => {
    const cost = i === purchases.length - 1 ? remaining : weight > 0n ? price * p.weight / weight : 0n;
    remaining -= cost;
    if (isDataAsset(p.asset)) dataValue += cost;
    if (cost > 0n || paid(p.history) > 0n) {
      const steps = assetPurchaseSteps(after, p.asset, p.old), total = steps.reduce((sum, step) => sum + step.weight, 0n);
      let unassigned = cost;
      investments[p.key] = [...p.history, ...steps.map((step, j) => {
        const credits = j === steps.length - 1 ? unassigned : total > 0n ? cost * step.weight / total : 0n;
        unassigned -= credits;
        return { version: step.version, credits: amount(credits.toString()) };
      })];
    }
  });
  return { investments, cost: splitCost(price, dataValue), refund: { credits: lostCredits / 2n, data: lostData / (2n * CREDITS_PER_DATA_PART) } };
}
