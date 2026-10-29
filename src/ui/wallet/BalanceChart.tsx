import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { TICK_MS, type Amount, type WalletSample } from '../../game';
import { clockText } from '../hooks/format';
import { axisText, balanceGraph, balanceText } from './graph';

export function BalanceChart({ samples, tick, current }: {
  samples: readonly WalletSample[]; tick: number; current: { credits: Amount; data: Amount };
}) {
  const graph = balanceGraph(samples, tick, current);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const index = Math.min(selectedIndex ?? graph.points.length - 1, graph.points.length - 1);
  const point = graph.points[index]!;
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const tick = graph.start + ratio * (graph.end - graph.start);
    setSelectedIndex(graph.points.reduce((best, point, i) => Math.abs(point.tick - tick) <= Math.abs(graph.points[best]!.tick - tick) ? i : best, 0));
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? graph.points.length - 1
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'ArrowRight' ? Math.min(graph.points.length - 1, index + 1) : null;
    if (next !== null) { event.preventDefault(); setSelectedIndex(next); }
  };
  return <figure className="balance-chart" aria-label="Credits and Data balance history">
    <div className="balance-chart-labels">
      <span className="credits"><i aria-hidden="true" />Credits <b title={point.credits}>{balanceText(point.credits)}</b></span>
      <span className="data"><i aria-hidden="true" />Data <b title={point.data}>{balanceText(point.data)}</b></span>
    </div>
    <div className="balance-chart-body">
      <div className="balance-chart-y credits" aria-label="Credits axis">{graph.credits.ticks.map(label => <span key={label} title={label}>{axisText(label)}</span>)}</div>
      <svg viewBox="-4 -4 1008 248" preserveAspectRatio="none" role="img" tabIndex={0}
        aria-label={`Credits and Data over simulation time. Current Credits ${current.credits}, Data ${current.data}. Use left and right arrows to inspect history.`}
        onPointerMove={inspect} onPointerDown={inspect} onPointerLeave={() => setSelectedIndex(null)} onKeyDown={key} onBlur={() => setSelectedIndex(null)}>
        <title>Credits and Data over simulation time</title>
        <desc>Credits use the left axis. Data uses the right axis. {clockText(graph.start * TICK_MS)} to {clockText(graph.end * TICK_MS)}.</desc>
        {[0, 60, 120, 180, 240].map(y => <line key={y} className="balance-grid" x1="0" x2="1000" y1={y} y2={y} />)}
        {graph.credits.y('0' as Amount) < 240 && <line className="balance-zero" x1="0" x2="1000" y1={graph.credits.y('0' as Amount)} y2={graph.credits.y('0' as Amount)} />}
        <path className="balance-line credits" d={graph.credits.path} />
        <path className="balance-line data" d={graph.data.path} />
        {selectedIndex !== null && <line className="balance-cursor" x1={graph.x(point.tick)} x2={graph.x(point.tick)} y1="0" y2="240" />}
        <circle className="balance-point credits" cx={graph.x(point.tick)} cy={graph.credits.y(point.credits)} r="3" vectorEffect="non-scaling-stroke" />
        <circle className="balance-point data" cx={graph.x(point.tick)} cy={graph.data.y(point.data)} r="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="balance-chart-y data" aria-label="Data axis">{graph.data.ticks.map(label => <span key={label} title={label}>{axisText(label)}</span>)}</div>
    </div>
    <div className="balance-chart-times"><span>{clockText(graph.start * TICK_MS)}</span><span>{clockText(graph.end * TICK_MS)}</span></div>
    <figcaption>{selectedIndex !== null ? clockText(point.tick * TICK_MS) : samples.length > 1 ? 'Simulation time' : 'History starts when your balance changes'}</figcaption>
  </figure>;
}
