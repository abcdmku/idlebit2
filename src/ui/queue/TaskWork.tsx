import { useLayoutEffect, useRef, useState } from 'react';
import { FAMILIES, selectTaskWork, type FamilyId, type QueueEntryView, type WorkTreeNode } from '../../game';
import { drawFamilyIcon, drawTypeIcon, type TaskType } from '../../render/core';
import { ArtCanvas } from '../art/ArtCanvas';
import { wholeText } from '../hooks/format';

function WorkIcon({ icon, n }: { icon: string; n: number }) {
  const type = icon.startsWith('type:') ? icon.slice(5) as TaskType : null;
  return <ArtCanvas w={16} h={16} n={n} artKey={icon} draw={g => type
    ? drawTypeIcon(g, type, 0, 0) : drawFamilyIcon(g, icon, 0, 0)} />;
}

function WorkRow({ node, n, onOpen }: { node: WorkTreeNode; n: number; onOpen: () => void }) {
  return <li><button type="button" className="tw-child" data-qa-target data-testid="work-child" onClick={onOpen}>
    <WorkIcon icon={node.icon} n={n} />
    <span className="tw-label"><span>{node.label}</span><span className="muted">×{wholeText(node.count)}</span></span>
    <span className="tw-ops" title={`${node.ops} CPU-equivalent operations`}>{wholeText(node.ops)} ops</span>
    <span className="muted" aria-hidden="true">›</span>
  </button></li>;
}

/** Navigation is presentation state. Counts and totals come from the simulation's recipe selector. */
export function TaskWork({ task }: { task: QueueEntryView }) {
  const n = 1;
  const section = useRef<HTMLElement>(null), navigating = useRef(false);
  const [path, setPath] = useState<readonly string[]>([]);
  const [library, setLibrary] = useState(false);
  const [preview, setPreview] = useState<FamilyId | null>(null);
  const [band, setBand] = useState(FAMILIES[task.family]!.band);
  const work = selectTaskWork(preview ?? task.family, preview === null ? task.size : 1, path);
  useLayoutEffect(() => {
    if (!navigating.current) return;
    navigating.current = false;
    const frame = requestAnimationFrame(() => section.current?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [path, library, preview]);
  const reset = () => { setPath([]); setPreview(null); setLibrary(false); };
  const bands = [...new Set(FAMILIES.map(def => def.band))];
  return <section ref={section} className="task-work" data-testid="task-work">
    <div className="tw-head">{work.path.length > 0 ? <>
      <button type="button" className="tw-key" data-qa-target onClick={() => { navigating.current = true; setPath(work.path.slice(0, -1)); }}>Back</button>
      <select className="tw-parents" aria-label="Go to parent work" value="" onChange={event => { navigating.current = true; setPath(work.path.slice(0, Number(event.target.value))); }}>
        <option value="" disabled>Parents</option>
        {work.ancestors.map((ancestor, index) => <option key={index} value={index}>{ancestor.label}</option>)}
      </select>
    </> : <strong>{preview === null ? 'Work tree' : 'Library recipe'}</strong>}
      <button type="button" className="tw-key" data-qa-target onClick={() => { navigating.current = true; setLibrary(!library); setPath([]); }}>Task library</button></div>
    {library ? <div className="tw-library">
      <label>Tier<select value={band} onChange={event => setBand(event.target.value as typeof band)}>
        {bands.map(key => <option key={key} value={key}>{({ bits: 'Bits', ints: 'Integers', threads: 'Parallel', ram: 'Memory', gpu: 'GPU', storage: 'Storage', rackDist: 'Rack', roomDist: 'Room', multiAz: 'Multi-zone', region: 'Regional' })[key]}</option>)}
      </select></label>
      {FAMILIES.filter(def => def.band === band).map(def => <button key={def.id} type="button" className="tw-catalog" data-qa-target
        onClick={() => { navigating.current = true; setPreview(def.id); setPath([]); setLibrary(false); }}><WorkIcon icon={def.key} n={n} />{def.name}<span aria-hidden="true">›</span></button>)}
    </div> : <>
      <div className="tw-current"><WorkIcon icon={work.current.icon} n={n} /><span>{work.current.label}<span className="muted"> ×{wholeText(work.current.count)}</span></span>
        <span title={`${work.current.ops} CPU-equivalent operations`}>{wholeText(work.current.ops)} ops</span></div>
      {(preview !== null || work.path.length > 0) && <p className="muted">{work.note}</p>}
      <ul className="tw-children">{work.children.map(child => <WorkRow key={child.key} node={child} n={n}
        onOpen={() => { navigating.current = true; setPath([...work.path, child.key]); }} />)}</ul>
      {work.current.primitive && <p className="tw-leaf">1 CPU operation each.</p>}
      {work.current.ops.length > 4 && <p className="tw-exact">{work.current.ops.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} CPU ops</p>}
      {preview === null ? work.path.length === 0 && <p className="muted">1 Credit per CPU op · GPU work is CPU-equivalent.</p>
        : <button type="button" className="tw-key" data-qa-target onClick={reset}>Back to offered task</button>}
    </>}
  </section>;
}
