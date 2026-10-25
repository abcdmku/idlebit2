import type { EffectPreview, GameAction, Quote } from '../../game';
import { quantity, span, watts } from './format';
import { changeNote, QuoteKey } from './widgets';
import type { PlateCommon } from './types';

const UNIT: Readonly<Record<EffectPreview['unit'], string>> = {
  'ops/s': 'ops/s', bits: 'b', 'bit/s': 'b/s', W: 'W', 'tasks/s': 'tasks/s', lanes: ' lanes', slots: ' slots', ports: ' ports', ops: 'ops',
};
const COUNT_UNITS = new Set<EffectPreview['unit']>(['lanes', 'slots', 'ports']);

function amountOf(n: number, unit: EffectPreview['unit']) {
  return COUNT_UNITS.has(unit) ? `${Math.round(n)}${UNIT[unit]}` : quantity(n, UNIT[unit]);
}

/** "8 kops/s → 16 kops/s · +3 W". At most 3 significant figures. */
export function effectText(e: EffectPreview | null): string {
  if (!e) return '';
  const dw = e.wattsAfter - e.wattsBefore;
  const w = Math.abs(dw) < 1e-9 ? '' : ` · ${dw > 0 ? '+' : '−'}${watts(Math.abs(dw))}`;
  return `${amountOf(e.capacityBefore, e.unit)} → ${amountOf(e.capacityAfter, e.unit)}${w}`;
}

/** Payback copy for the best of upgrade and replace. */
export function paybackText(upgrade: Quote | undefined, replace: Quote | undefined): string {
  const u = upgrade && !upgrade.locked ? upgrade.effect?.paybackS ?? null : null;
  const r = replace && !replace.locked ? replace.effect?.paybackS ?? null : null;
  if (u != null && r != null) return `Pays back: upgrade ${span(u)} · replace ${span(r)}`;
  if (u != null) return `Upgrade pays back in ${span(u)}`;
  if (r != null) return `Replace pays back in ${span(r)}`;
  return upgrade || replace ? 'No payback at this load' : '';
}

const isUpgrade = (q: Quote) => q.action.type === 'upgradePart' || q.action.type === 'upgradeAll';
const isReplace = (q: Quote) => q.action.type === 'replacePart' || q.action.type === 'replaceCpu';

export function partQuotes(quotes: readonly Quote[]) {
  const replaces = quotes.filter(isReplace);
  return {
    upgrade: quotes.find(isUpgrade),
    /** The first buildable replacement, else the first locked one. */
    replace: replaces.find((q) => !q.locked) ?? replaces[0],
    remove: quotes.find((q) => q.action.type === 'removePart'),
  };
}

const levelOf = (a: GameAction) => (a.type === 'replacePart' ? a.generation : null);

/**
 * Upgrade (hot, level + 1) against replace (cold, next generation), each with its effect and
 * whether it costs downtime, then the payback line. The rows hold their space when a quote is missing.
 */
export function PartKeys({ quotes, level, onAction, onResearch, researchName }:
  Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> & { level: number }) {
  const { upgrade, replace } = partQuotes(quotes?.quotes ?? []);
  const fire = (q: Quote) => onAction(q.action);
  return <>
    <div className="keys part-keys">
      {upgrade ? <QuoteKey quote={upgrade} label={`Upgrade · L${level + 1}`}
        detail={<>{effectText(upgrade.effect)}<em className="hot">{changeNote(upgrade)}</em></>}
        onAction={fire} onResearch={onResearch} researchName={researchName} />
        : <p className="key-slot">{quotes ? 'Top level for this generation' : ''}</p>}
      {replace ? <QuoteKey quote={replace} tone="replace" label={`Replace · ${replace.label || `Gen ${levelOf(replace.action) ?? ''}`}`}
        detail={<>{effectText(replace.effect)}<em className="cold">{changeNote(replace)}</em></>}
        onAction={fire} onResearch={onResearch} researchName={researchName} />
        : <p className="key-slot">{quotes ? 'Newest generation' : ''}</p>}
    </div>
    <p className="p-hint payback" aria-live="polite">{paybackText(upgrade, replace)}</p>
  </>;
}
