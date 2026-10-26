// D34, user 26 Oct: the cores are one component. One tap opens the Cores plate: how many and how fast,
// each core's state, and first the key that adds the next core (the deck's Cores row, so they agree).
import { FAMILIES, type LevelSnapshot } from '../../game';
import { hertz } from './format';
import { CoreKey } from './CoreKey';
import { PlateFrame } from './PlateFrame';
import { Status } from './widgets';
import type { PlateCommon } from './types';

type Chip = Extract<LevelSnapshot, { level: 'chip' }>;

/** One core in a word: its task and progress, or idle, or asleep. */
export function coreState(c: Chip['cores'][number]): string {
  if (c.family !== null) return `${FAMILIES[c.family]?.name ?? 'Task'} ${Math.floor(c.progress * 100)}%`;
  return c.sleep ? `Asleep (${c.sleep})` : 'Idle';
}

export function CoresPlate({ focus, quotes: _q, onAction, onResearch, researchName, ...frame }: PlateCommon & { focus: Chip }) {
  const n = focus.cores.length, busy = focus.cores.filter(c => c.family !== null).length;
  return <PlateFrame {...frame} title="Cores" sub={`${n} ${n === 1 ? 'core' : 'cores'} · up to ${focus.coreSites}`} className="part cores">
    <Status text={`${hertz(focus.clock.effectiveHz)} each · ${busy} of ${n} busy`} />
    <CoreKey onAction={onAction} onResearch={onResearch} researchName={researchName} />
    <ol className="core-list" aria-label="Each core">
      {focus.cores.map((c, i) => <li key={i} className={c.family !== null ? 'busy' : ''}><b>{i + 1}</b><span>{coreState(c)}</span></li>)}
    </ol>
  </PlateFrame>;
}
