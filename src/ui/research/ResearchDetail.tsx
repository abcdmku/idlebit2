// The research detail: a side panel on desktop, a bottom sheet on phone (concept C2). Name, the
// effect, what it needs and answers, its Data and work, and the one key. D27: Start puts the
// project next in the market line, with how long it holds the hardware.
import { formatOps, type GameAction, type ResearchId, type ResearchNodeView, type ResearchTreeView } from '../../game';
import { typeColor, typeName } from '../../render/core';
import { CoinIcon, GemIcon, LockIcon } from '../plates/icons';
import { wholeText } from '../plates/format';
import { holdText } from './estimate';
import { detailKey, isReady, PART_NAMES, rowStatus, TAB_NAMES, type LineState, type Wallet } from './model';

export interface DetailProps {
  node: ResearchNodeView | null;
  tree: ResearchTreeView;
  line: LineState;
  names: ReadonlyMap<ResearchId, string>;
  wallet: Wallet;
  onAction: (action: GameAction) => void;
}

const REQ_TONE: Readonly<Record<ResearchNodeView['state'], string>> = {
  done: 'req-done', active: 'req-active', parked: 'req-active', queued: 'req-active', available: 'req-avail', locked: 'req-locked',
};

/** The name, where it hangs and its state. */
export function DetailHead({ node, line, names, wallet }: Omit<DetailProps, 'tree' | 'onAction'> & { node: ResearchNodeView }) {
  const status = rowStatus(node, line, names, wallet), running = node.state === 'active';
  const tone = running ? (line.running ? 'running' : 'queued') : isReady(node, wallet) && !line.id ? 'available' : node.state === 'done' ? 'done' : 'wait';
  return <div className="ld-head">
    <h3>{node.name}</h3>
    <p className="ld-where"><span>{node.part === 'structure' ? 'Next level' : PART_NAMES[node.part]}, {TAB_NAMES[node.tab]}</span>
      <b className={`ld-state ${tone}`}>{status}</b></p>
    {running && <i className="ld-bar"><i style={{ width: `${Math.floor(node.progress * 100)}%` }} /></i>}
  </div>;
}

/** Needs, Answers, Data and Work. */
export function DetailFacts({ node, tree }: { node: ResearchNodeView; tree: ResearchTreeView }) {
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  return <dl className="ld-facts">
    <dt>Needs</dt>
    <dd>{node.requires.length ? node.requires.map(id => {
      const r = byId.get(id);
      return <span key={id} className={r ? REQ_TONE[r.state] : 'req-locked'}>{r?.state === 'done' ? '✓ ' : r?.state === 'locked' ? <LockIcon /> : null}{r?.name ?? id}</span>;
    }) : <span className="req-done">Nothing</span>}</dd>
    {node.answers.length > 0 && <><dt>Answers</dt>
      <dd>{node.answers.map(t => <span key={t} className="ld-chip" data-task-type={t}><i style={{ background: typeColor(t) }} />{typeName(t)}</span>)}</dd></>}
    <dt>Data</dt>
    <dd><span className="ld-data"><GemIcon />{wholeText(node.dataCost)}</span>
      {node.creditCost && node.creditCost !== '0' && <span className="ld-credits"><CoinIcon />{wholeText(node.creditCost)}</span>}</dd>
    <dt>Work</dt>
    <dd>{formatOps(node.workOps)}</dd>
  </dl>;
}

/** The key, and the line under it. */
export function DetailKey({ node, tree, line, names, wallet, onAction }: DetailProps & { node: ResearchNodeView }) {
  const k = detailKey(node, tree, line, names, wallet, holdText(node.workOps, tree.holdOpsPerSec));
  return <div className="ld-buy">
    <button type="button" className={`ld-key ${k.tone}`} data-qa-target disabled={!k.action} onClick={() => k.action && onAction(k.action)}>
      {k.label === 'Start' ? <>Start <GemIcon />{wholeText(node.dataCost)}</> : k.label}</button>
    <p className="ld-note">{k.note || ' '}</p>
  </div>;
}

/** Desktop: the side panel. */
export function DetailPanel(p: DetailProps) {
  const { node, tree, line } = p;
  const other = line.id && node && line.id !== node.id ? tree.nodes.find(n => n.id === line.id) : undefined;
  return <aside className="ld-panel" aria-label="Project">
    {!node ? <p className="ld-empty">Pick a project to see what it does.</p> : <>
      <DetailHead {...p} node={node} />
      {node.effect && <p className="ld-effect">{node.effect}</p>}
      <DetailFacts node={node} tree={tree} />
      <div className="ld-foot">
        {other && <div className="ld-line"><span>In line</span><b>{other.name} {line.running ? `${Math.floor(other.progress * 100)}%` : ''}</b></div>}
        <DetailKey {...p} node={node} />
      </div>
    </>}
  </aside>;
}

/** Phone: the bottom sheet. Folded it shows the name, Data and the key; the grip opens the rest. */
export function DetailSheet(p: DetailProps & { open: boolean; onToggle: () => void; height: number }) {
  const { node, tree, open, onToggle, height } = p;
  return <aside className={`ld-sheet${open ? ' open' : ''}`} style={{ height }} aria-label="Project">
    <button type="button" className="ld-grip" data-qa-target aria-expanded={open} aria-label={open ? 'Show less' : 'Show more'} onClick={onToggle}><i /></button>
    {!node ? <p className="ld-empty">Pick a project to see what it does.</p> : <>
      <div className="ld-scroll">
        <DetailHead {...p} node={node} />
        {open && <>{node.effect && <p className="ld-effect">{node.effect}</p>}<DetailFacts node={node} tree={tree} /></>}
      </div>
      <DetailKey {...p} node={node} />
    </>}
  </aside>;
}
