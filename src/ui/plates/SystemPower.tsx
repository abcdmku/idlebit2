import { researchId, selectSystemPower, type ResearchId, type SystemId } from '../../game';
import { useGameSelector, useShell } from '../storeHooks';
import { LockIcon } from './icons';
import { Toggle } from './widgets';

/** A power setting: a switch once researched, and before that a locked row that opens its research. */
function Setting({ label, note, on, needs, project, onToggle, onResearch, researchName }: {
  label: string; note: string; on: boolean; needs: ResearchId | null; /** The project's name, where the plate's name table has none. */ project: string; onToggle: () => void;
  onResearch?: (id: ResearchId) => void; researchName?: (id: ResearchId) => string;
}) {
  if (!needs) return <Toggle label={label} note={note} on={on} onToggle={onToggle} />;
  const listed = researchName?.(needs), name = listed && listed !== needs ? listed : project;
  return <button type="button" className="cx-tog lock" disabled={!onResearch} aria-label={`${label}, locked. Research ${name}`}
    onClick={(e) => { e.stopPropagation(); onResearch?.(needs); }}>
    <i className="lock-well"><LockIcon /></i><span>{label}<small>Research {name}</small></span>
  </button>;
}

/**
 * The system's free operating choices (spec §9.3), shown open on its plate: tap the system, then a setting.
 * Each says what it does while on; a setting research has not opened reads as locked and leads to that project.
 */
export function SystemPower({ system, onResearch, researchName }: { system: SystemId; onResearch?: (id: ResearchId) => void; researchName?: (id: ResearchId) => string }) {
  const shell = useShell();
  useGameSelector(s => `${s.epoch}|${shell.store.getState().build.revision}|${shell.store.getState().research.completed.join(',')}`);
  const p = selectSystemPower(shell.store.getState(), system);
  if (!p) return null;
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  const sleep = p.sleepStates.find(c => c.depth === 1)!, research = { onResearch, researchName };
  return <section className="system-power">
    <div role="group" aria-label="System power settings">
      <Setting label="Idle sleep" project="C-state" note={`Idle cores draw ${percent(sleep.idleFactor)}`} needs={p.maxCState ? null : researchId('cstate1')} {...research}
        on={p.maxCState > 0 && p.cStateLimit > 0} onToggle={() => shell.dispatch({ type: 'setCStateLimit', system, limit: p.cStateLimit ? 0 : 1 })} />
      <Setting label="Idle clock" project="P-states" note={`Queue empty: ${percent(p.dvfsClock)} clock, ${percent(p.dvfsWatts)} power`} needs={p.dvfsAvailable ? null : researchId('dvfs')} {...research}
        on={p.dvfs} onToggle={() => { shell.dispatch({ type: 'setSystemSetting', system, setting: 'dvfs', on: !p.dvfs }); }} />
      <Setting label="Turbo" project="Turbo boost" note={`${percent(p.turboClock)} clock, ${percent(p.turboWatts)} power`} needs={p.turboAvailable ? null : researchId('turbo')} {...research}
        on={p.turbo} onToggle={() => { shell.dispatch({ type: 'setSystemSetting', system, setting: 'turbo', on: !p.turbo }); }} />
    </div>
  </section>;
}
