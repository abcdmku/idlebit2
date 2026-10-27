// D34, user 26 Oct: the cores are one component. One tap opens the Cores plate: how many and how fast,
// each core's state, and first the key that adds the next core (the deck's Cores row, so they agree).
import { FAMILIES, type LevelSnapshot } from '../../game';
import { hertz } from './format';
import { CoreKey } from './CoreKey';
import { useQuote } from '../storeHooks';
import { useSavingUp } from '../deck/SavingUp';
import { PlateFrame } from './PlateFrame';
import { QuoteKey, Status } from './widgets';
import type { PlateCommon } from './types';

type Chip = Extract<LevelSnapshot, { level: 'chip' }>;

/** One core in a word: its task and progress, or idle, or asleep. */
export function coreState(c: Chip['cores'][number]): string {
  if (c.family !== null) return `${FAMILIES[c.family]?.name ?? 'Task'} ${Math.floor(c.progress * 100)}%`;
  return c.sleep ? `Asleep (${c.sleep})` : 'Idle';
}

export function CoresPlate({ focus, quotes: _q, onAction, onResearch, researchName, ...frame }: PlateCommon & { focus: Chip }) {
  const n = focus.cores.length, busy = focus.cores.filter(c => c.family !== null).length;
  const clock = useQuote({ kind: 'part', part: { unit: { kind: 'system', id: focus.systemId }, slot: { kind: 'clock', socket: 0 } } })
    ?.quotes.find(q => q.action.type === 'upgradePart');
  const saving = useSavingUp(clock ? Number(clock.cost) : null, !!clock?.affordable);
  return <PlateFrame {...frame} title="Cores" sub={`${n} ${n === 1 ? 'core' : 'cores'} · up to ${focus.coreSites}`} className="part cores">
    <Status text={`${hertz(focus.clock.effectiveHz)} each · ${busy} of ${n} busy`} />
    <CoreKey onAction={onAction} onResearch={onResearch} researchName={researchName} />
    {clock && <div className="keys" data-testid="cores-clock-upgrade">
      <QuoteKey quote={clock} label="Upgrade clock" reason={saving}
        detail={clock.effect ? `${hertz(clock.effect.capacityBefore)} → ${hertz(clock.effect.capacityAfter)}` : undefined}
        onAction={q => onAction(q.action)} onResearch={onResearch} researchName={researchName} />
    </div>}
    <ol className="core-list" aria-label="Each core">
      {/* Fixed core order, never sorted by progress (user, 26 Oct). */}
      {focus.cores.map((c, i) => <li key={i} className={c.family !== null ? 'busy' : ''}><b>{i + 1}</b><span>{coreState(c)}</span></li>)}
    </ol>
  </PlateFrame>;
}
