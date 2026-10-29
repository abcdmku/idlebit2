import { useLayoutEffect, useRef, useState } from 'react';
import { selectBankruptcy } from '../../game';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useInnerBack } from '../shell/backGuard';
import { CloseKey } from '../shell/CloseKey';
import { box, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, usePlatformStatus, useShell, useViewState } from '../storeHooks';
import { BalanceChart } from './BalanceChart';
import { balanceText } from './graph';
import '../styles/wallet.css';

export function CurrencyScreen() {
  const state = useViewState();
  return state.sheet === 'creditsHistory' || state.sheet === 'dataHistory' ? <OpenCurrency /> : null;
}

function OpenCurrency() {
  const ref = useRef<HTMLElement>(null), L = useLayout(), shell = useShell();
  const [confirming, setConfirming] = useState(false), [status, setStatus] = useState('');
  const { catchingUp } = usePlatformStatus();
  const wallet = useGameSelector(s => ({ tick: s.tick, credits: s.hud.credits, data: s.hud.data, samples: s.walletHistory }), shallowEqual, 500);
  const bankruptcy = selectBankruptcy(shell.store.getState());
  const dismissConfirmation = () => {
    if (!confirming) return false;
    setConfirming(false); return true;
  };
  const close = () => { if (!dismissConfirmation()) shell.view.dispatch({ type: 'back' }); };
  useInnerBack(dismissConfirmation);
  useDialogFocus(ref, close);
  const inset = L.kind === 'desktop' ? L.lat : 8;
  const w = Math.min(680, L.w - 2 * inset);
  useLayoutEffect(() => {
    const pane = ref.current;
    if (!pane) return;
    const children = Array.from(pane.children) as HTMLElement[];
    const position = () => {
      const content = children.reduce((sum, child) => sum + child.offsetHeight, 0);
      const h = Math.min(Math.ceil(content / 8) * 8, Math.floor((L.h - 2 * inset) / 8) * 8);
      pane.style.height = `${h}px`;
      pane.style.top = `${Math.floor((L.h - h) / 16) * 8}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    children.forEach(child => observer.observe(child));
    return () => observer.disconnect();
  }, [L.h, L.w, inset]);
  const declare = () => {
    const outcome = shell.dispatch({ type: 'declareBankruptcy' });
    setConfirming(false);
    setStatus(outcome === null ? 'Bankruptcy queued.' : outcome.ok ? 'Bankruptcy declared.' : outcome.rejection.reason);
  };
  return <div className="wallet-veil" onPointerDown={e => e.stopPropagation()}>
    <section ref={ref} className="panel wallet-page" style={{ ...box({ x: Math.floor((L.w - w) / 16) * 8, y: 0, w, h: 0 }),
      height: 'auto', maxHeight: L.h - 2 * inset }}
      role="dialog" aria-modal="true" aria-labelledby="wallet-title" tabIndex={-1} data-testid="wallet-page" data-k="sheet">
      <header className="wallet-head">
        <h1 id="wallet-title">Currency history</h1>
        <CloseKey L={L} w={w} onClose={close} label="Close currency history" />
      </header>
      <div className="wallet-body">
        <BalanceChart samples={wallet.samples} tick={wallet.tick} current={wallet} />
        <div className="bankruptcy">
          <div className="bankruptcy-head"><h2>{confirming ? 'Declare bankruptcy?' : 'Bankruptcy'}</h2>
            <span className="data" title={bankruptcy.dataCost}>{balanceText(bankruptcy.dataCost)} Data</span></div>
          <p>Credits → 0 · Data −10%</p>
          <div className="bankruptcy-actions">
            {confirming ? <>
              <button type="button" className="skey off" data-qa-target onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="skey warn" data-qa-target disabled={!bankruptcy.available || catchingUp} onClick={declare}>Confirm bankruptcy</button>
            </> : <button type="button" className="skey warn" data-qa-target disabled={!bankruptcy.available || catchingUp}
              onClick={() => { setConfirming(true); setStatus(''); }}>Declare bankruptcy</button>}
          </div>
          <p className="wallet-status" role="status">{status || (!bankruptcy.available ? 'Credits are already zero.' : '')}</p>
        </div>
      </div>
    </section>
  </div>;
}
