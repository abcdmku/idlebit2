import { selectSystemPower, type SystemId } from '../../game';
import { useGameSelector, useShell } from '../storeHooks';
import { Toggle } from './widgets';

/**
 * Free operating choices already implemented by the simulation, next to the power supply. Shown open (user, 26 Oct:
 * one or two taps from play): tap the power supply, then a setting. Only the explanation is a disclosure.
 */
export function SystemPower({ system }: { system: SystemId }) {
  const shell = useShell();
  useGameSelector(s => `${s.epoch}|${shell.store.getState().build.revision}|${shell.store.getState().research.completed.join(',')}`);
  const p = selectSystemPower(shell.store.getState(), system);
  if (!p) return null;
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  const selected = p.sleepStates.find(c => c.depth === p.cStateLimit)!;
  return <section className="system-power"><p className="cfg-lab">Idle sleep</p>
    <div role="group" aria-label="System power settings">
    {!p.live && <p className="p-line muted">CPU power is fixed until System.</p>}
    <Toggle label="C-state" note={p.maxCState ? `Level ${p.cStateResearchLevel} · idle core power ${percent(selected.idleFactor)}` : 'Requires C-state'}
      disabled={!p.maxCState} on={p.cStateLimit > 0} onToggle={() => shell.dispatch({ type: 'setCStateLimit', system, limit: p.cStateLimit ? 0 : 1 })} />
    <Toggle label="Dynamic clock (DVFS)" note={p.dvfsAvailable ? `Idle only · ${percent(p.dvfsClock)} clock` : 'Needs research'}
      disabled={!p.dvfsAvailable} on={p.dvfs} onToggle={() => { shell.dispatch({ type: 'setSystemSetting', system, setting: 'dvfs', on: !p.dvfs }); }} />
    <Toggle label="Turbo boost" note={p.turboAvailable ? `${percent(p.turboClock)} clock · ${percent(p.turboWatts)} power` : 'Needs research'}
      disabled={!p.turboAvailable} on={p.turbo} onToggle={() => { shell.dispatch({ type: 'setSystemSetting', system, setting: 'turbo', on: !p.turbo }); }} />
    <Toggle label="Power cap" note={p.capAvailable ? 'Throttle CPU to supply headroom' : 'Needs research'}
      disabled={!p.capAvailable} on={p.capped} onToggle={() => { shell.dispatch({ type: 'setPowerCap', part: { unit: { kind: 'system', id: system }, slot: { kind: 'psu' } }, on: !p.capped }); }} />
  </div></section>;
}
