import { sfxPreferences } from '../../platform';
import { useSfxPreferences } from './useSfx';

/** Effects switch and volume, in the Music rows' markup and classes. */
export function SfxSettings() {
  const { enabled, volume } = useSfxPreferences();
  return <>
    <div className="music-heading">
      <h2>Effects</h2>
      <button type="button" className="skey music-play" data-qa-target aria-pressed={enabled}
        aria-label={enabled ? 'Turn effects off' : 'Turn effects on'}
        onClick={() => sfxPreferences.update({ enabled: !enabled })}>{enabled ? 'On' : 'Off'}</button>
    </div>
    <div className="music-volume">
      <label htmlFor="sfx-volume">Volume</label>
      <output htmlFor="sfx-volume">{volume}%</output>
      <input id="sfx-volume" type="range" min="0" max="100" step="1" value={volume} data-qa-target
        aria-valuetext={`${volume}%`} onChange={e => sfxPreferences.update({ volume: Number(e.target.value) })} />
    </div>
  </>;
}
