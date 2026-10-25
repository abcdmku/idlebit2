// D31.2 start controllers: the same Start row at every scope (rack Power control, room UPS, global
// scheduler). Three fixed controls: "Start with n", "Wake when the head waits X s" (plus "or busy ≥ Y %"
// at generation 1, reserved and greyed before), and the order. Geometry never changes with state.
import type { GameAction, ScopeRef, StartCtlView, StartOrder } from '../../game';

/** Spec D31.2 ranges. */
export const HEAD_WAIT_S = [1, 9] as const;
export const BUSY_PCT = [50, 95] as const;
const BUSY_STEP = 5;

export const ORDER_NAMES: Readonly<Record<StartOrder, string>> = {
  slot: 'Slot', fastest: 'Fastest', coolest: 'Coolest', cheapest: 'Cheapest', nearest: 'Nearest',
};
export const SCOPE_ORDERS: Readonly<Record<'rack' | 'room' | 'global', readonly StartOrder[]>> = {
  rack: ['slot', 'fastest'], room: ['slot', 'coolest'], global: ['slot', 'cheapest', 'nearest'],
};
const WORDS: Readonly<Record<'rack' | 'room' | 'global', [string, string]>> = {
  rack: ['system', 'systems'], room: ['rack', 'racks'], global: ['site', 'sites'],
};

type Config = Pick<StartCtlView, 'startWith' | 'headWaitS' | 'busyPct' | 'order'>;

/** The action for a changed configuration, clamped to the spec ranges and the unit count. */
export function startAction(unit: ScopeRef, v: Config, total: number, change: Partial<Config>): GameAction {
  const c = { ...v, ...change };
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  return {
    type: 'setStartConfig', unit, startWith: clamp(c.startWith, 1, Math.max(1, total)),
    headWaitS: clamp(c.headWaitS, HEAD_WAIT_S[0], HEAD_WAIT_S[1]), busyPct: c.busyPct === null ? null : clamp(c.busyPct, BUSY_PCT[0], BUSY_PCT[1]), order: c.order,
  };
}

/** "6 / 12 awake · next in 1 s", the controller's live state. */
export function startStatus(v: StartCtlView, scope: 'rack' | 'room' | 'global'): string {
  const word = scope === 'rack' ? 'awake' : scope === 'room' ? 'powered' : 'online';
  const next = v.nextWakeInMs !== null ? ` · next in ${Math.max(1, Math.ceil(v.nextWakeInMs / 1000))} s` : '';
  return `${v.awake} / ${v.total} ${word}${next}`;
}

function Stepper({ label, name, value, lower, raise, disabled, onLower, onRaise }: {
  label: string; name: string; value: string; lower: string; raise: string; disabled?: boolean; onLower: (() => void) | null; onRaise: (() => void) | null;
}) {
  return <div className={`setpoint start-step${disabled ? ' off' : ''}`} role="group" aria-label={label}>
    <span>{name}</span>
    <button type="button" className="step" aria-label={lower} disabled={disabled || !onLower} onClick={() => onLower?.()}>−</button>
    <b aria-live="polite">{value}</b>
    <button type="button" className="step" aria-label={raise} disabled={disabled || !onRaise} onClick={() => onRaise?.()}>+</button>
  </div>;
}

export interface StartRowProps {
  unit: ScopeRef;
  scope: 'rack' | 'room' | 'global';
  view: StartCtlView;
  onAction: (action: GameAction) => void;
}

export function StartRow({ unit, scope, view: v, onAction }: StartRowProps) {
  const set = (change: Partial<Config>) => onAction(startAction(unit, v, v.total, change));
  const [one, many] = WORDS[scope], gen1 = v.generation >= 1;
  const busy = v.busyPct;
  return <div className="start-row" data-testid="start-row">
    <p className="start-head"><b>Start</b><span>{startStatus(v, scope)}</span></p>
    <Stepper label={`Start with, of ${v.total} ${v.total === 1 ? one : many}`} name="Start with" value={`${v.startWith} of ${v.total}`}
      lower="Start with fewer" raise="Start with more"
      onLower={v.startWith > 1 ? () => set({ startWith: v.startWith - 1 }) : null}
      onRaise={v.startWith < v.total ? () => set({ startWith: v.startWith + 1 }) : null} />
    <Stepper label="Wake when the head waits" name="Head waits" value={`${v.headWaitS} s`} lower="Wake sooner" raise="Wake later"
      onLower={v.headWaitS > HEAD_WAIT_S[0] ? () => set({ headWaitS: v.headWaitS - 1 }) : null}
      onRaise={v.headWaitS < HEAD_WAIT_S[1] ? () => set({ headWaitS: v.headWaitS + 1 }) : null} />
    {/* Generation 1 (predictive): or when the awake units are this busy. Reserved, greyed before. */}
    <Stepper label={gen1 ? 'or when busy over' : 'or when busy over, generation 1'} name={gen1 ? 'Or busy' : 'Or busy · gen 1'} value={!gen1 ? '—' : busy === null ? 'off' : `${busy}%`} disabled={!gen1}
      lower="Busy trigger lower" raise="Busy trigger higher"
      onLower={busy === null ? null : () => set({ busyPct: busy - BUSY_STEP < BUSY_PCT[0] ? null : busy - BUSY_STEP })}
      onRaise={busy === null ? () => set({ busyPct: BUSY_PCT[0] }) : busy < BUSY_PCT[1] ? () => set({ busyPct: busy + BUSY_STEP }) : null} />
    <div className="start-order" role="radiogroup" aria-label="Wake order">
      <span>Order</span>
      {SCOPE_ORDERS[scope].map(o => <button key={o} type="button" role="radio" aria-checked={v.order === o} className={`opt${v.order === o ? ' on' : ''}`}
        onClick={() => v.order !== o && set({ order: o })}>{ORDER_NAMES[o]}</button>)}
    </div>
  </div>;
}
