// Phone: the build rows as a sheet anchored to the deck, sized to its rows (L2 syncSheet 'build', A30).
// An affordable row carries its own Buy key; the rest show why not in the right column.
import type { PhoneLayout } from '../layout';
import { CloseKey } from '../shell/CloseKey';
import { box, T } from '../shell/geometry';
import { useShell } from '../storeHooks';
import type { Offers } from './offers';
import { offerAction, PriceText, RightText, useTapOffer } from './offerUi';

const HEAD = 64, ROW = 48, KEY_W = 96;

export function BuildSheet({ L, offers }: { L: PhoneLayout; offers: Offers }) {
  const { view } = useShell(), tap = useTapOffer(), pad = 16;
  const h = Math.min(HEAD + ROW * offers.rows.length + 8, L.build.y - 8 - L.view.y);
  const s = { x: L.drawer.x, y: L.build.y - 8 - h, w: L.drawer.w, h };
  return <section className="panel sheet" style={box(s)} data-k="sheet" role="dialog" aria-label="Build" data-testid="build-sheet">
    <T x={pad} y={pad} className="head">Build</T>
    <CloseKey L={L} w={s.w} onClose={() => view.dispatch({ type: 'cancel' })} />
    {offers.rows.map((o, i) => {
      // The best row's accent sits at the row's left edge; its text starts 2·N past it (A30).
      const buy = o.affordable && o.price !== null, tx = 8, rw = s.w - 16;
      return <div key={o.key} className={`srow${i === offers.best ? ' best' : ''}`} data-row={o.key}
        style={{ left: 8, top: HEAD + ROW * i, width: rw, height: ROW }}>
        <button type="button" className="srow-hit" data-qa-target disabled={!offerAction(o)} onClick={() => tap(o)}
          aria-label={`${o.name}${o.change ? ` ${o.change}` : ''}`} style={{ left: 0, top: 0, width: rw - (buy ? KEY_W + 8 : 0), height: ROW }}>
          <T x={tx} y={8} w={s.w - 2 * pad - KEY_W - 16}><b className={o.lock && !o.where ? 'mute' : ''}>{o.name}</b></T>
          <T x={tx} y={8 + L.lh} w={s.w - 2 * pad - KEY_W - 16} className={o.where ? 'net' : 'mute'}>{o.change}</T>
          {!buy && <T right={8} y={16}><RightText offer={o} n={L.N} /></T>}
        </button>
        {buy && <button type="button" className="skey buy" data-qa-target data-testid={`sheet-buy-${o.key}`}
          style={{ right: 0, top: 0, width: KEY_W, height: ROW }} onClick={() => tap(o)}><PriceText offer={o} n={L.N} />&nbsp;Buy</button>}
      </div>;
    })}
  </section>;
}
