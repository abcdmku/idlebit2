import { useMemo, useState, type CSSProperties } from 'react';
import { amount, selectRunway, type ResearchId, type RunwayView } from '../../game';
import { wholeText } from '../hooks/format';
import { CoinIcon, GemIcon } from '../plates/icons';
import { PriceTag } from '../research/price';
import { useGameSelector, useShell } from '../storeHooks';
import { eraName, pctText } from './Reach';

/** Fuller "what it opens" lines for the structure milestones; fabs and any new milestone show their tree summary. */
const ERA_OPENS: Readonly<Record<string, string>> = {
  systemBoard: 'A board: up to 4 CPUs · RAM · GPU · drives · power supply',
  rack: '12 server slots · switch · load balancer · supply limits',
  room: 'Rows of racks · network rack · room cooling · UPS',
  dataCenter: 'A site with 2 zones · data plane · grid power',
  regions: 'Up to 4 sites in other regions · backbone links',
};

/** The runway, recomputed at most twice a second as the wallet, research and reports move. */
export function useRunway(): RunwayView {
  const { store } = useShell();
  const key = useGameSelector(s => `${s.epoch}|${s.hud.data}|${s.hud.credits}|${s.research.active}|${Math.floor(s.research.progress * 1000)}|`
    + `${s.research.queued}|${s.round.lastReport?.index ?? 0}`, Object.is, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the value identity of what the runway reads
  return useMemo(() => selectRunway(store.getState()), [store, key]);
}

/** The clock range for each CPU frequency tier. */

/**
 * Era chips, compact: CPU ✓ System ✓ kHz ✓ [Rack 71%] MHz …. The CPU frequency tiers being worked
 * through sit on one quiet line under them, so the chips stay one glance wide.
 */
function Eras({ r }: { r: RunwayView }) {
  const nodes = r.cpuTiers;
  return <>
    <ol className="rn-eras" aria-label="Eras">
      <li className="done">CPU ✓</li>
      {r.eras.map(e => <li key={e.node} className={e.node === r.next?.node ? 'now' : e.done ? 'done' : ''}>
        {eraName(e.node, r.eras)}{e.done ? ' ✓' : e.node === r.next?.node ? ` ${pctText(r.next.mark.progress)}` : ''}</li>)}
    </ol>
    {nodes.length > 0 && <p className="rn-nodes" data-testid="rn-nodes"><span className="mute">CPU tiers</span>{' '}
      {nodes.map((n, i) => <span key={n.name} className={n.done ? 'done' : 'next'}>{i ? ', ' : ''}{n.name}{n.done ? ' ✓' : ''}</span>)}</p>}
  </>;
}

/**
 * A wallet row toward the milestone's cost. Its meter ends at the balance; the last three rounds' earnings
 * are its last three blocks, brightest last, clamped at zero when spending since took the balance below them.
 */
function CostRow({ kind, have, need, earned }: { kind: 'data' | 'credits'; have: number; need: number; earned: readonly { round: number; v: number }[] }) {
  const pct = (v: number) => Math.min(Math.max(v, 0), need) / need * 100;
  let end = Math.max(0, have);
  const blocks = [...earned].reverse().map((e, i) => {
    const from = Math.max(0, end - Math.max(0, e.v)), to = end;
    end = from;
    return { from: pct(from), to: pct(to), shade: i };
  }).filter(b => b.to > b.from);
  const Icon = kind === 'data' ? GemIcon : CoinIcon, last = earned.at(-1);
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${wholeText(Math.abs(v))}`;
  return <li className="rw rn-cost" data-cost={kind}><div className={`lr rn-meter rn-${kind}`}>
    <span className="lr-nm"><Icon /><span>{kind === 'data' ? 'Data' : 'Credits'}</span></span>
    <span className="lr-benefit">{earned.length ? `Last ${earned.length === 1 ? 'round' : `${earned.length} rounds`}: ${earned.map(e => signed(e.v)).join(', ')}` : ''}</span>
    <span className="lr-st"><b className={kind === 'data' ? 'pt-d' : 'pt-c'}>{wholeText(have)}</b> <span className="mute">/ {wholeText(need)}</span></span>
    <span className="lr-pc">{last ? `Last round ${signed(last.v)}` : ''}</span>
    <span className="lr-ax">{pctText(Math.min(1, Math.max(0, have) / need))}</span>
    <i className="rn-track" aria-hidden="true" data-free="art">
      <b className="rn-fill" style={{ width: `${pct(have).toFixed(2)}%` }} />
      {blocks.map(b => <b key={b.shade} className={`rn-block s${b.shade}`} style={{ left: `${b.from.toFixed(2)}%`, width: `${(b.to - b.from).toFixed(2)}%` }} />)}
    </i>
  </div></li>;
}

/** One era strip, with the milestone and its wallet rows available on demand. */
export function RunwayPanel({ onJump }: { onJump: (id: ResearchId) => void }) {
  const r = useRunway(), shell = useShell(), next = r.next;
  const [expanded, setExpanded] = useState(false);
  const wallet = useGameSelector(s => ({ data: Number(s.hud.data), credits: Number(s.hud.credits) }), (a, b) => a.data === b.data && a.credits === b.credits, 500);
  const reports = shell.store.getState().round.reports.slice(-3);
  const then = r.eras.find(e => !e.done && e.node !== next?.node);
  return <section className="research-runway" data-testid="runway" aria-label="Next era">
    <button type="button" className="lab-era-strip" data-qa-target aria-expanded={expanded} aria-controls="research-runway-costs" onClick={() => setExpanded(v => !v)}>
      <span className="lab-era-face">
      <span className="mute">Next era</span>
      <span className="lab-era-dots" aria-hidden="true"><i className="done" />{r.eras.map(e => <i key={e.node} className={e.node === next?.node ? 'next' : e.done ? 'done' : ''} />)}</span>
      <b className="lab-era-next">{next ? `${eraName(next.node, r.eras)} ${pctText(next.mark.progress)}` : 'All open'}</b>
      <span className="lab-era-then mute">{then ? `then ${eraName(then.node, r.eras)}` : ''}</span>
      </span>
    </button>
    <Eras r={r} />
    {expanded && <div id="research-runway-costs">
    {next ? <ul className="rn-list">
      <li className="rw next"><button type="button" className={`lr${next.paid ? ' bar' : ''}`} onClick={() => onJump(next.node)}
        style={next.paid ? { '--fill': `${Math.floor(next.progressOps / next.work * 100)}%`, '--bar': 'var(--print)' } as CSSProperties : undefined}>
        <span className="lr-nm"><span>{next.name}</span></span>
        <span className="lr-benefit">{ERA_OPENS[next.node] ?? r.eras.find(e => e.node === next.node)?.summary ?? ''}</span>
        <span className="lr-st">{next.paid ? `Research ${pctText(next.mark.progress)}` : `${pctText(next.mark.progress)} saved`}</span>
        <span className="lr-pc"><PriceTag price={{ data: amount(next.data), credits: Number(next.credits) > 0 ? next.credits : null }} /></span>
        <span className="lr-ax">{next.needs.length ? `Needs ${next.needs.map(x => x.name).join(', ')}` : ''}</span>
      </button></li>
      {!next.paid && <CostRow kind="data" have={wallet.data} need={next.data} earned={reports.map(x => ({ round: x.index, v: Number(x.data) }))} />}
      {!next.paid && Number(next.credits) > 0 && <CostRow kind="credits" have={wallet.credits} need={Number(next.credits)}
        earned={reports.map(x => ({ round: x.index, v: Number(x.net) }))} />}
    </ul> : <p className="mute rn-pace">Every era is open.</p>}
    </div>}
  </section>;
}
