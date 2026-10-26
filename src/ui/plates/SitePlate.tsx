// An empty CPU or board site ("Add Core 3", "Add queue", "Add RAM") as a compact plate: one tap shows
// what it adds and the key that buys it (user, 26 Oct), placed like every plate so it never covers the site.
import type { LevelSnapshot, QuoteResult } from '../../game';
import type { HitTarget } from '../../render/core';
import { calloutModel } from '../callout/model';
import { useShellOffers } from '../deck/useOffers';
import { useSavingUp } from '../deck/SavingUp';
import { PlateFrame } from './PlateFrame';
import { QuoteKey, Status } from './widgets';
import type { PlateCommon } from './types';

export interface SitePlateProps extends Omit<PlateCommon, 'quotes'> {
  target: HitTarget;
  focus: LevelSnapshot;
  quotes: QuoteResult | null;
}

export function SitePlate({ target, focus, quotes, onAction, onResearch, researchName, ...frame }: SitePlateProps) {
  const m = calloutModel(target, focus, quotes, useShellOffers());
  const q = m.offer?.quote ?? null, lock = q?.locked;
  const saving = useSavingUp(m.offer?.price ?? null, !!m.offer?.affordable);
  return <PlateFrame {...frame} title={m.name} className="part site">
    <Status text={m.change || ' '} tone={m.research ? 'warn' : ''} />
    <div className="keys">
      {lock?.code === 'research' && lock.node && onResearch
        ? <button type="button" className="key locked-action" data-qa-target onClick={() => onResearch(lock.node!)}>
          Research {researchName?.(lock.node) ?? lock.text.replace(/^Needs /, '')}</button>
        : q ? <QuoteKey quote={q} label={m.change ? `Buy · ${m.change}` : 'Buy'} reason={saving ?? undefined} onAction={x => onAction(x.action)} onResearch={onResearch} researchName={researchName} />
        : <p className="key-slot">{lock?.text ?? 'Nothing to add here yet'}</p>}
    </div>
  </PlateFrame>;
}
