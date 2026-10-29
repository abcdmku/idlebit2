import { useMemo, useState } from 'react';
import { selectRoundRewards, type RoundRewardView } from '../../game';
import { drawFamilyIcon } from '../../render/core/familyIcons';
import { ArtCanvas } from '../art/ArtCanvas';
import { PlateFrame } from '../plates/PlateFrame';
import { CoinIcon, GemIcon } from '../plates/icons';
import { useLayout } from '../shell/geometry';
import { useGameSelector, useShell, useViewState } from '../storeHooks';
import { wholeText } from '../hooks/format';
import '../styles/round-rewards.css';

function Contents() {
  const shell = useShell(), L = useLayout(), [later, setLater] = useState(false);
  const data = useGameSelector(() => selectRoundRewards(shell.store.getState()), (a, b) =>
    a.current === b.current && a.ready === b.ready && a.rows.length === b.rows.length
    && a.rows.every((r, i) => r.status === b.rows[i]?.status && r.credits === b.rows[i]?.credits && r.data === b.rows[i]?.data), 200);
  const area = useMemo(() => ({ x: L.view.x + 8, y: L.view.y + 8, w: L.view.w - 16, h: L.view.h - 16 }), [L]);
  const spill = useMemo(() => [{ x: 8, y: L.band.y + L.band.h + 8, w: L.w - 16, h: L.h - L.band.y - L.band.h - 24 }], [L]);
  const firstLocked = data.rows.findIndex(r => r.status === 'locked');
  const rows = later || firstLocked < 0 ? data.rows : data.rows.slice(0, firstLocked + 2);
  const claim = (row: RoundRewardView) => shell.dispatch({ type: 'claimRoundReward', milestone: row.milestone });
  return <PlateFrame title="Round rewards" className="round-rewards-plate" bounds={area} spill={spill}
    onClose={() => shell.view.dispatch({ type: 'back' })}>
    <div className="reward-list">{rows.map(row => <button type="button" className={`reward-item ${row.status}`} key={row.milestone}
      data-qa-target data-testid={row.status === 'ready' ? 'reward-claim' : undefined} disabled={row.status !== 'ready'}
      title={[row.effect, row.limit].filter(Boolean).join('. ')}
      aria-description={[row.effect, row.limit].filter(Boolean).join('. ')}
      aria-label={`${wholeText(row.milestone)} tasks. ${row.name}. ${row.status === 'ready' ? `Claim ${wholeText(row.credits)} Credits and ${wholeText(row.data)} Data` : row.status}`}
      onClick={() => claim(row)}>
      <ArtCanvas w={16} h={16} n={L.N} artKey={row.icon} draw={g => drawFamilyIcon(g, row.icon, 0, 0)} />
      <span className="reward-list-name"><b>{wholeText(row.milestone)} tasks</b><span>{row.summary}</span></span>
      <span className="reward-result">{row.status === 'ready' ? <><b>Claim</b><span className="reward-amounts"><span className="pz"><CoinIcon />{wholeText(row.credits)}</span><span className="pz d"><GemIcon />{wholeText(row.data)}</span></span></>
        : row.status === 'claimed' ? 'Claimed' : 'Locked'}</span>
    </button>)}</div>
    {!later && rows.length < data.rows.length && <button type="button" className="component-link" data-qa-target onClick={() => setLater(true)}>Later milestones</button>}
  </PlateFrame>;
}

export function RoundRewardsScreen() {
  return useViewState().sheet === 'roundRewards' ? <Contents /> : null;
}
