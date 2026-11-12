import { useRef, useState } from 'react';
import { SAVED_CONFIGS_PER_KIND, type GameAction, type UnitRef } from '../../game';
import { UNIT_NOUN } from './copy';
import { PlateFrame, type PlatePosition } from './PlateFrame';

export const SAVE_NAME_MAX = 24;
/** Saved configurations kept per kind (spec §13.5). */
export const SAVED_MAX = SAVED_CONFIGS_PER_KIND;

/** The unit's own name while it is free, then "Rack A 2", "Rack A 3": the first not already saved. */
export function nextDefaultName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map(n => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) { const n = `${base} ${i}`; if (!names.has(n.toLowerCase())) return n; }
}

export interface SavePromptProps extends Omit<PlatePosition, 'pinTop' | 'readAnchor'> {
  unit: UnitRef;
  /** Suggested name, e.g. "Server 3". */
  defaultName: string;
  sub?: string;
  /** Saved names of this kind: saving over one replaces it, so the key says so. */
  taken?: readonly string[];
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

/**
 * Save-name prompt (mockup core/save-prompt.js): a small plate pinned to the top of the world, so an
 * on-screen keyboard rising from the bottom never covers it or moves it. The one status line under the
 * field is always there: how many builds of this kind are saved, or why this name cannot be saved.
 */
export function SavePrompt({ unit, defaultName, sub, taken = [], onAction, onClose, ...position }: SavePromptProps) {
  const [name, setName] = useState(defaultName.slice(0, SAVE_NAME_MAX));
  const input = useRef<HTMLInputElement>(null);
  const noun = UNIT_NOUN[unit.kind], trimmed = name.trim(), replaces = taken.some(n => n.toLowerCase() === trimmed.toLowerCase());
  const full = taken.length >= SAVED_MAX && !replaces, ok = !!trimmed && !full;
  const submit = () => { if (!ok) return; onAction({ type: 'saveConfig', unit, name: trimmed }); onClose(); };
  const note = full ? `${SAVED_MAX} saved. Use a saved name to replace it.` : replaces ? 'Replaces the saved build of this name' : `${taken.length} / ${SAVED_MAX} saved`;
  return <PlateFrame {...position} pinTop as="form" onSubmit={submit} closeKey initialFocus={input}
    title={`Save ${noun}`} sub={sub} className="save" onClose={onClose}
    actions={<button type="submit" className="p-save" disabled={!ok}>{replaces ? 'Replace' : 'Save'}</button>}>
    <label className="save-field">
      <span className="save-lab">Name</span>
      <input ref={input} type="text" value={name} maxLength={SAVE_NAME_MAX} autoComplete="off" spellCheck={false} enterKeyHint="done"
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.currentTarget.value)} />
    </label>
    <p className={`p-line ${full ? 'warn' : 'muted'}`} aria-live="polite">{note}</p>
  </PlateFrame>;
}
