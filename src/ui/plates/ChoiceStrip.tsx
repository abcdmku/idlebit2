import type { ReactNode } from 'react';

export interface StripChoice {
  readonly id: string; readonly label: string; readonly disabled?: boolean; readonly title?: string;
  /** A second line under the label (a price). */
  readonly note?: ReactNode; readonly className?: string;
}
/** Visible choices. Lists may scroll; operating controls never hide behind a picker. */
export function ChoiceStrip({ choices, value, onPick, label }: {
  choices: readonly StripChoice[]; value: string; onPick: (value: string) => void; label: string;
}) {
  return <div className="choice-strip" role="group" aria-label={label}>{choices.map(c =>
    <button key={c.id} type="button" className={`${c.id === value ? 'on' : ''} ${c.className ?? ''}`} aria-pressed={c.id === value}
      title={c.title} disabled={c.disabled} onClick={() => onPick(c.id)}><span>{c.label}</span>{c.note}</button>)}</div>;
}
