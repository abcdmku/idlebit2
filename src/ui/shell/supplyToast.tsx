// A buy that went over a supply (user, 26 Oct): it still runs, and a brief toast says so, with a key to the
// supply's plate. One toast at a time; a newer one replaces it. It sits where the version banner sits, at the
// bottom of the world, so nothing in the world or the deck moves.
import { useEffect, useSyncExternalStore } from 'react';
import type { OverSupply } from '../../game';
import { pointAt } from '../input/pointAt';
import { SUPPLY_NAME, SUPPLY_POINT } from '../plates/overSupply';
import { useShell } from '../storeHooks';
import { useLayout } from './geometry';

/** How long the warning stays up. A notice, not a timer the game runs on. */
export const SUPPLY_TOAST_MS = 5000;

let current: { readonly os: OverSupply; readonly seq: number } | null = null, seq = 0;
const listeners = new Set<() => void>();
const publish = () => { for (const l of [...listeners]) l(); };

export function showSupplyToast(os: OverSupply): void { current = { os, seq: ++seq }; publish(); }
export function hideSupplyToast(): void { if (current) { current = null; publish(); } }
export const supplyToastNow = () => current;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** "Over the power supply · upgrade it first". */
export const supplyToastText = (os: OverSupply): string => `Over the ${SUPPLY_NAME[os.part]} · upgrade it first`;

export function SupplyToast() {
  const shell = useShell(), L = useLayout(), t = useSyncExternalStore(subscribe, supplyToastNow, supplyToastNow);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(hideSupplyToast, SUPPLY_TOAST_MS);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return <div className="platform-line version supply-toast" role="status" data-testid="supply-toast"
    style={{ left: L.view.x + L.lat, top: L.view.y + L.view.h - L.lat - 48, maxWidth: L.view.w - 2 * L.lat, height: 48 }}>
    <span>{supplyToastText(t.os)}</span>
    <button type="button" className="skey" data-qa-target style={{ position: 'relative', width: 96, height: 48 }}
      onClick={() => { hideSupplyToast(); pointAt(shell, SUPPLY_POINT[t.os.part]); }}>Open</button>
  </div>;
}
