import type { GpuPowerPreview } from '../../game';
import { watts } from './format';

/** Full-load system and supply figures are authored by the quote, including environment and losses. */
export function GpuPower({ power, hot = false }: { power: GpuPowerPreview | undefined; hot?: boolean }) {
  const over = power !== undefined && power.after.headroomW < 0;
  const rows = [
    ['Delivered', 'deliveredW'], ['Supply cap', 'capacityW'], ['Headroom', 'headroomW'],
    ['Supply loss', 'lossW'], ['Supply input', 'inputW'],
  ] as const;
  return <div className={`gpu-power${hot ? ' gpu-hot-power' : ''}`}>
    <table className="gpu-comparison" aria-label={hot ? 'Hot upgrade full system power' : 'Selected model full system power'}>
      <caption>{hot ? 'Hot upgrade · full system' : 'Full system · full load'}</caption>
      <thead><tr><th>Power</th><th>Before</th><th>{hot ? 'After push' : 'After install'}</th></tr></thead>
      <tbody>{rows.map(([label, key]) => <tr key={key}><th scope="row">{label}</th>
        <td className={key === 'headroomW' && power && power.before.headroomW < 0 ? 'gpu-over' : ''}>{power ? watts(power.before[key]) : '—'}</td>
        <td className={key === 'headroomW' && over ? 'gpu-over' : ''}>{power ? watts(power.after[key]) : '—'}</td>
      </tr>)}</tbody>
    </table>
    <p className={`gpu-power-warning${over ? ' gpu-over' : ''}`} aria-live="polite">
      {over ? 'Over supply capacity at full load.' : power ? 'Supply headroom shown at full load.' : 'System power preview unavailable.'}
    </p>
  </div>;
}
