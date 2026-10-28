import { useEffect, useState } from 'react';
import type { LevelId, RenderSnapshot } from '../../game';
import { useShell } from '../storeHooks';

/** A newly researched level calls attention to its existing key until the player opens it. */
export function useNewLevels(): ReadonlySet<LevelId> {
  const { store, view } = useShell();
  const [pending, setPending] = useState<ReadonlySet<LevelId>>(new Set());
  useEffect(() => {
    let before: RenderSnapshot['unlocked'] | null = null, epoch = store.getSnapshot().epoch;
    const read = () => {
      const life = store.getLifecycle(), snapshot = store.getSnapshot();
      if (!life.hydrated || life.catchingUp) return;
      const reset = epoch !== snapshot.epoch;
      if (reset) { before = null; epoch = snapshot.epoch; }
      const previous = before;
      before = snapshot.unlocked;
      const current = view.getState(), opened = current.goal ?? current.focus.level;
      setPending(old => {
        const next = new Set(reset ? [] : old);
        if (previous) for (const level of Object.keys(snapshot.unlocked) as LevelId[])
          if (snapshot.unlocked[level] && !previous[level]) next.add(level);
        next.delete(opened);
        return next.size === old.size && [...next].every(x => old.has(x)) ? old : next;
      });
    };
    const stopStore = store.subscribe(read), stopView = view.subscribe(read);
    read();
    return () => { stopStore(); stopView(); };
  }, [store, view]);
  return pending;
}
