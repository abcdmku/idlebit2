import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GpuPower } from './GpuPower';
import { mount, type Mounted } from './testkit';

let m: Mounted;
beforeEach(() => { m = mount(); });
afterEach(() => m.unmount());

describe('GPU whole-system supply preview', () => {
  const before = { deliveredW: 300, capacityW: 500, headroomW: 200, lossW: 15, inputW: 315 };
  const after = { deliveredW: 700, capacityW: 500, headroomW: -200, lossW: 90, inputW: 790 };
  it('shows the quote-provided delivered load, supply, headroom, loss and input before buying', () => {
    m.render(<GpuPower power={{ before, after }} />);
    const rows = Array.from(m.host.querySelectorAll('tbody tr')).map(r => Array.from(r.children).map(c => c.textContent));
    expect(rows).toEqual([
      ['Delivered', '300 W', '700 W'], ['Supply cap', '500 W', '500 W'], ['Headroom', '200 W', '−200 W'],
      ['Supply loss', '15 W', '90 W'], ['Supply input', '315 W', '790 W'],
    ]);
    expect(m.host.textContent).toContain('Full system · full load');
    expect(m.host.querySelector('.gpu-power-warning.gpu-over')?.textContent).toBe('Over supply capacity at full load.');
  });

  it('labels the hot-upgrade preview and removes the over-capacity warning for positive quoted headroom', () => {
    m.render(<GpuPower hot power={{ before: after, after: before }} />);
    expect(m.host.querySelector('table')?.getAttribute('aria-label')).toBe('Hot upgrade full system power');
    expect(m.host.querySelector('.gpu-power-warning.gpu-over')).toBeNull();
    expect(m.host.querySelector('.gpu-power-warning')?.textContent).toBe('Supply headroom shown at full load.');
    expect(m.host.querySelectorAll('tbody tr')).toHaveLength(5);
  });
});
