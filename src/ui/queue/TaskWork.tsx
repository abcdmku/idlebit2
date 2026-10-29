import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FAMILIES, selectTaskBreakdown, type FamilyId, type QueueEntryView } from '../../game';
import { drawFamilyIcon, drawTypeIcon, type TaskType } from '../../render/core';
import { ArtCanvas } from '../art/ArtCanvas';
import { wholeText } from '../hooks/format';

function WorkIcon({ icon }: { icon: string }) {
  const type = icon.startsWith('type:') ? icon.slice(5) as TaskType : null;
  return <ArtCanvas w={16} h={16} n={1} artKey={icon} draw={g => type
    ? drawTypeIcon(g, type, 0, 0) : drawFamilyIcon(g, icon, 0, 0)} />;
}

/** The complete recipe is visible. Only the long catalog and recipe list scroll. */
export function TaskWork({ task }: { task: QueueEntryView }) {
  const section = useRef<HTMLElement>(null);
  const [library, setLibrary] = useState(false), [search, setSearch] = useState('');
  const [preview, setPreview] = useState<FamilyId | null>(null);
  const family = preview ?? task.family, def = FAMILIES[family]!;
  const rows = useMemo(() => selectTaskBreakdown(family, preview === null ? task.size : 1), [family, preview, task.size]);
  useLayoutEffect(() => { section.current?.dispatchEvent(new Event('plate-layout', { bubbles: true })); }, [library, preview, search]);
  return <section ref={section} className="task-work" data-testid="task-work">
    <div className="tw-head"><strong>{preview === null ? 'Work' : def.name}</strong>
      <button type="button" className="tw-key" aria-pressed={library} onClick={() => setLibrary(!library)}>{library ? 'Recipe' : 'Task library'}</button>
      {preview !== null && <button type="button" className="tw-key" onClick={() => { setPreview(null); setLibrary(false); }}>Offered task</button>}</div>
    {library ? <div className="tw-library">
      <input aria-label="Find a task" placeholder="Find a task…" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="tw-catalog-list scroll-list">{FAMILIES.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item =>
        <button key={item.id} type="button" className={`tw-catalog${family === item.id ? ' on' : ''}`}
          onClick={() => { setPreview(item.id); setLibrary(false); }}><WorkIcon icon={item.key} /><span>{item.name}</span></button>)}</div>
    </div> : <>
      <div className="tw-columns muted"><span>Operation</span><span>Count</span><span>CPU ops</span></div>
      <ul className="tw-breakdown scroll-list">{rows.map(row => <li key={row.key} className={row.primitive ? 'primitive' : 'recipe'}>
        <span className="tw-operation" style={{ paddingLeft: Math.min(2, Math.max(0, row.depth - 1)) * 6 }} title={row.label}><WorkIcon icon={row.icon} /><span>{row.label}</span></span>
        <span title={row.count}>{wholeText(row.count)}</span><span title={row.ops}>{wholeText(row.ops)}</span>
      </li>)}</ul>
    </>}
  </section>;
}
