// Test-only helpers for U2's jsdom tests: a React root, quote builders and click helpers.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { Amount, GameAction, LockReason, Quote, QuoteResult, ResearchId } from '../../game';

export interface Mounted { host: HTMLElement; root: Root; render(node: ReactNode): void; unmount(): void }
export function mount(): Mounted {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return {
    host, root,
    render(node) { act(() => root.render(node)); },
    unmount() { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); },
  };
}

export function q(action: GameAction, cost: number | string, extra: Partial<Quote> = {}): Quote {
  return { action, label: '', cost: String(cost) as Amount, currency: 'credits', affordable: true, locked: null, cold: false,
    downtimeMs: 0, effect: null, workOps: null, ...extra };
}
export const result = (quotes: Quote[]): QuoteResult => ({ configRevision: 1, quotes });
export const researchLock = (node: string, text: string): LockReason => ({ code: 'research', node: node as ResearchId, text });

export function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  act(() => { (el as HTMLElement).click(); });
}
export function buttons(host: ParentNode): HTMLButtonElement[] { return Array.from(host.querySelectorAll('button')); }
export function button(host: ParentNode, text: string | RegExp): HTMLButtonElement {
  const b = buttons(host).find((x) => (typeof text === 'string' ? x.textContent?.includes(text) : text.test(x.textContent ?? '')));
  if (!b) throw new Error(`no button "${text}" in: ${buttons(host).map((x) => x.textContent).join(' | ')}`);
  return b;
}
