import { selectFleetHealth, type FleetHealthView } from '../../game';
import { shallowEqual, useGameSelector, useShell } from '../storeHooks';

type Faults = Pick<FleetHealthView, 'fault' | 'levels'> & { readonly faults: number };
const same = (a: Faults, b: Faults) => a.fault === b.fault && a.faults === b.faults && shallowEqual(a.levels, b.levels);

/** Whether a rack runs hot now, how many do, and the fault per ladder level. No rows are built. */
export function useFleetFaults(): Faults {
  const shell = useShell();
  return useGameSelector(() => {
    const h = selectFleetHealth(shell.store.getState(), 0);
    return { fault: h.fault, faults: h.counts.risk, levels: h.levels };
  }, same, 250);
}
