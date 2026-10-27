// D31 optional parts (rack Power control, room and global start controllers, site generation), from
// `quote({ kind: 'power', unit })`: an empty scope offers one install per generation; an installed part
// its level upgrade and one replace per other generation.
import type { ReactNode } from 'react';
import type { Quote } from '../../game';
import { routine } from './OptionRow';
import { effectText } from './PartKeys';
import { changeNote, QuoteKey } from './widgets';
import type { PlateCommon } from './types';

/** D31.2: a start controller's wake latency by level (L1–5: 2, 1.5, 1, 0.5, 0.25 s; 0.25 s above). */
export const wakeS = (level: number) => [2, 1.5, 1, 0.5, 0.25][Math.max(1, Math.min(5, level)) - 1]!;

export interface PowerKeysProps extends Pick<PlateCommon, 'quotes' | 'onAction' | 'onResearch' | 'researchName'> {
  installed: boolean;
  level: number;
  /** Start controllers (no capacity effect): the upgrade reads its wake latency. */
  wake?: boolean;
  /** What the part is called on an install key ("Start controller", "Generation"). */
  noun: string;
}

export function PowerKeys({ quotes, installed, level, wake = false, noun, onAction, onResearch, researchName }: PowerKeysProps) {
  const list = quotes?.quotes ?? [];
  const fire = (q: Quote) => onAction(q.action);
  const key = (q: Quote, label: string, detail: ReactNode, tone: '' | 'replace' = '') => <section className="power-option" key={JSON.stringify(q.action)}>
    {!q.locked && detail && <p className="option-values">{detail}</p>}
    <QuoteKey quote={q} label={label} tone={tone} onAction={fire} onResearch={onResearch} researchName={researchName} />
  </section>;
  if (!installed) {
    const installs = list.filter(q => q.action.type === 'replacePart');
    return <div className="keys power-keys">{installs.length ? routine(installs.map(quote => ({ quote }))).map(({ quote: q }) => key(q, `Add ${q.label || noun}`, effectText(q.effect)))
      : <p className="key-slot">{quotes ? `No ${noun.toLowerCase()} to add yet` : ''}</p>}</div>;
  }
  const up = list.find(q => q.action.type === 'upgradePart');
  const replaces = list.filter(q => q.action.type === 'replacePart');
  const upDetail = up?.effect ? effectText(up.effect) : wake ? `Wake in ${wakeS(level)} s → ${wakeS(level + 1)} s` : '';
  return <div className="keys power-keys">
    {routine([...(up && up.locked?.code !== 'ceiling' ? [{ quote: up }] : []), ...replaces.map(quote => ({ quote }))]).map(({ quote: q }) =>
      q === up ? key(q, `Upgrade · L${level + 1}`, <>{upDetail}{q.cold && <em className="cold">{changeNote(q)}</em>}</>)
        : key(q, `Replace ${q.label}`, <>{effectText(q.effect)}{q.cold && <em className="cold">{changeNote(q)}</em>}</>, 'replace'))}
  </div>;
}
