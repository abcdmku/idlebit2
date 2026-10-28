import { ArtCanvas } from '../art/ArtCanvas';
import { box, useLayout } from '../shell/geometry';
import { useShell, useViewState } from '../storeHooks';
import { drawGear } from '../art/deckArt';

export function SettingsKey() {
  const L = useLayout(), { view } = useShell(), open = useViewState().sheet === 'settings';
  return <button type="button" className="skey settings-key" style={box(L.settings)} aria-label="Settings"
    aria-expanded={open} aria-haspopup="dialog" title="Settings" data-testid="settings-key" data-qa-target
    onClick={() => view.dispatch({ type: 'toggleSheet', sheet: 'settings' })}>
    <ArtCanvas w={16} h={16} n={L.N} artKey="settings" draw={drawGear} />
  </button>;
}
