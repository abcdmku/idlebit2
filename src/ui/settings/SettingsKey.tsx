import { ArtCanvas } from '../art/ArtCanvas';
import { box, useLayout } from '../shell/geometry';
import { useShell, useViewState } from '../storeHooks';

export function SettingsKey() {
  const L = useLayout(), { view } = useShell(), open = useViewState().sheet === 'settings';
  return <button type="button" className="skey settings-key" style={box(L.settings)} aria-label="Settings"
    aria-expanded={open} aria-haspopup="dialog" title="Settings" data-testid="settings-key" data-qa-target
    onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'settings' })}>
    <ArtCanvas w={12} h={12} n={L.N} artKey="settings" draw={g => {
      g.clearRect(0, 0, 12, 12);
      g.fillStyle = '#a99be6';
      const rows = ['000011110000', '011011110110', '011111111110', '001111111100',
        '111100001111', '111100001111', '111100001111', '111100001111',
        '001111111100', '011111111110', '011011110110', '000011110000'];
      rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === '1') g.fillRect(x, y, 1, 1); }));
    }} />
  </button>;
}
