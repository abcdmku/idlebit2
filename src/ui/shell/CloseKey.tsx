// One close everywhere (A21): a 48 × 48 key with a 2·N "×", top-right, inset by the lattice.
import type { CSSProperties } from 'react';
import type { ShellLayout } from '../layout';

export function CloseKey({ L, w, onClose, label = 'Close' }: { L: ShellLayout; w: number; onClose: () => void; label?: string }) {
  const inset = L.kind === 'desktop' ? L.lat : 8;
  return <button type="button" className="skey off close-key" aria-label={label} data-qa-target data-testid="close-key"
    style={{ left: w - inset - 48, top: inset, width: 48, height: 48 }} onClick={onClose}>
    <i className="x-glyph" aria-hidden="true" style={{ width: 6 * L.N, height: 6 * L.N, '--x-w': `${L.N}px` } as CSSProperties} />
  </button>;
}
