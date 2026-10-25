// Phone: the build rows as a sheet over the lower world (L2 syncSheet 'build').
import type { PhoneLayout } from '../layout';
import { box, T } from '../shell/geometry';
import { useShell } from '../storeHooks';
import type { Offers } from './offers';
import { lockWord, offerAction, PriceText, useTapOffer } from './offerUi';

export function BuildSheet({ L, offers }: { L: PhoneLayout; offers: Offers }) {
  const { view } = useShell(), tap = useTapOffer(), s = L.drawer, pad = 16;
  return <section className="panel sheet" style={box(s)} data-k="sheet" role="dialog" aria-label="Build" data-testid="build-sheet">
    <T x={pad} y={pad} className="head">Build</T>
    <button type="button" className="x" style={{ right: pad - 8, top: pad - 8, width: 48, height: 48 }} data-qa-target
      onClick={() => view.dispatch({ type: 'cancel' })}>Close</button>
    {offers.rows.map((o, i) => <button key={o.key} type="button" className={`srow${i === offers.best ? ' best' : ''}`} data-row={o.key} data-qa-target
      style={{ left: pad, top: 56 + 48 * i, width: s.w - 2 * pad, height: 3 * L.lh }} disabled={!offerAction(o)} onClick={() => tap(o)}>
      <T x={0} y={8}><b className={o.lock ? 'dim' : ''}>{o.name}</b></T>
      <T x={0} y={8 + L.lh} w={s.w - 2 * pad} className={`${o.where ? 'net' : o.lock ? 'dim' : 'mute'}`}>{o.change}</T>
      <T right={0} y={8}>{o.price !== null ? <PriceText offer={o} n={L.N} /> : o.lock ? <span className="dim">{lockWord(o)}</span> : null}</T>
    </button>)}
  </section>;
}
