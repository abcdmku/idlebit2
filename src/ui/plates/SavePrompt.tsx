import { useRef, useState } from 'react';
import type { GameAction, UnitRef } from '../../game';
import { UNIT_NOUN } from './copy';
import { PlateFrame, type PlatePosition } from './PlateFrame';

export const SAVE_NAME_MAX = 24;

/** "Rack A 1", "Rack A 2": the first base name not already saved. */
export function nextDefaultName(base: string, taken: readonly string[]): string {
  const names = new Set(taken);
  for (let i = 1; ; i++) { const n = `${base} ${i}`; if (!names.has(n)) return n; }
}

export interface SavePromptProps extends Omit<PlatePosition, 'pinTop' | 'readAnchor'> {
  unit: UnitRef;
  /** Suggested name, e.g. "Server 3 1". */
  defaultName: string;
  sub?: string;
  /** Saved names of this kind: saving over one replaces it, so the key says so. */
  taken?: readonly string[];
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

/**
 * Save-name prompt (mockup core/save-prompt.js): a small plate pinned to the top of the world, so an
 * on-screen keyboard rising from the bottom never covers it or moves it.
 */
export function SavePrompt({ unit, defaultName, sub, taken = [], onAction, onClose, ...position }: SavePromptProps) {
  const [name, setName] = useState(defaultName.slice(0, SAVE_NAME_MAX));
  const input = useRef<HTMLInputElement>(null);
  const noun = UNIT_NOUN[unit.kind], trimmed = name.trim(), replaces = taken.includes(trimmed);
  const submit = () => { if (!trimmed) return; onAction({ type: 'saveConfig', unit, name: trimmed }); onClose(); };
  return <PlateFrame {...position} pinTop as="form" onSubmit={submit} closeKey initialFocus={input}
    title={`Save ${noun}`} sub={sub} className="save" onClose={onClose}>
    <label className="save-field">
      <span className="save-lab">Name</span>
      <input ref={input} type="text" value={name} maxLength={SAVE_NAME_MAX} autoComplete="off" spellCheck={false} enterKeyHint="done"
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.currentTarget.value)} />
    </label>
    <p className="p-line muted">{replaces ? `Replaces the saved “${trimmed}”.` : `Shows only when you add a new ${noun}.`}</p>
    <div className="save-keys">
      <button type="submit" className="key go" disabled={!trimmed}>{replaces ? 'Replace' : 'Save'}</button>
      <button type="button" className="key ghost" onClick={onClose}>Cancel</button>
    </div>
  </PlateFrame>;
}
