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
  return <section className="system-power">
    <div role="group" aria-label="System power settings">
    <Toggle label="Idle sleep" note={p.maxCState ? `${percent(selected.idleFactor)} idle power` : 'Research C-state'}
      disabled={!p.maxCState} on={p.maxCState > 0 && p.cStateLimit > 0} onToggle={() => shell.dispatch({ type: 'setCStateLimit', system, limit: p.cStateLimit ? 0 : 1 })} />
    <Toggle label="Idle clock" note={p.dvfsAvailable ? `${percent(p.dvfsClock)} speed` : 'Research DVFS'}
      disabled={!p.dvfsAvailable} on={p.dvfs} onToggle={() => { shell.dispatch({ type: 'setSystemSetting', system, setting: 'dvfs', on: !p.dvfs }); }} />
    <Toggle label="Turbo" note={p.turboAvailable ? `${percent(p.turboClock)} speed · ${percent(p.turboWatts)} power` : 'Research Turbo'}
      disabled={!p.turboAvailable} on={p.turbo} onToggle={() => { shell.dispatch({ type: 'setSystemSetting', system, setting: 'turbo', on: !p.turbo }); }} />
  </div></section>;
}
