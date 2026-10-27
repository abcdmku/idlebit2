import { clockText } from './hooks/format';
import { shallowEqual, useGameSelector, useShell } from './storeHooks';
import './styles/autoReturn.css';

/** The saved, free auto-return switch. Paused research remains a player choice. */
export function AutoReturnControl() {
  const shell = useShell();
  const r = useGameSelector(s => ({ available: s.round.autoReturn.available, on: s.round.autoReturn.on,
    seconds: s.round.autoReturn.inMs === null ? null : Math.ceil(s.round.autoReturn.inMs / 1000) }), shallowEqual, 250);
  if (!r.available) return null;
  return <button type="button" className="auto-return-control" role="switch" aria-checked={r.on}
    aria-label={`Auto return ${r.on ? 'on' : 'off'}`} data-testid="auto-return-control" data-qa-target
    onClick={() => shell.dispatch({ type: 'setAutoReturn', on: !shell.store.getSnapshot().round.autoReturn.on })}>
    <span>Auto return</span>
    <span className="auto-return-time">{r.on && r.seconds !== null ? `in ${clockText(r.seconds * 1000)}` : ''}</span>
    <b>{r.on ? 'On' : 'Off'}</b>
  </button>;
}
