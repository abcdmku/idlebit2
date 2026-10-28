import { useMemo, useState } from 'react';
import { selectRoundRewards, selectResearchTree, type ResearchId, type RoundRewardView } from '../../game';
import { drawFamilyIcon } from '../../render/core/familyIcons';
import { ArtCanvas } from '../art/ArtCanvas';
import { PlateFrame } from '../plates/PlateFrame';
import { CoinIcon, GemIcon } from '../plates/icons';
import { useLayout } from '../shell/geometry';
import { useGameSelector, useShell, useViewState } from '../storeHooks';
import { wholeText } from '../hooks/format';
import '../styles/round-rewards.css';

function Contents({ initial }: { initial: number | null }) {
  const shell = useShell(), L = useLayout();
  const [selected, setSelected] = useState(initial), [later, setLater] = useState(false);
  const data = useGameSelector(() => selectRoundRewards(shell.store.getState()), (a, b) =>
    a.current === b.current && a.ready === b.ready && a.rows.length === b.rows.length
    && a.rows.every((r, i) => r.status === b.rows[i]?.status && r.credits === b.rows[i]?.credits && r.data === b.rows[i]?.data), 200);
  const row = data.rows.find(r => r.milestone === selected) ?? null;
  const area = useMemo(() => ({ x: L.view.x + 8, y: L.view.y + 8, w: L.view.w - 16, h: L.view.h - 16 }), [L]);
  const spill = useMemo(() => [{ x: 8, y: L.band.y + L.band.h + 8, w: L.w - 16, h: L.h - L.band.y - L.band.h - 24 }], [L]);
  const close = () => shell.view.dispatch({ type: 'back' });
  const icon = (r: RoundRewardView) => <ArtCanvas w={16} h={16} n={L.N} artKey={r.icon} draw={g => drawFamilyIcon(g, r.icon, 0, 0)} />;
  const research = row?.research ? selectResearchTree(shell.store.getState()).nodes.find(n => n.id === row.research) : null;
  const rows = later ? data.rows : data.rows.filter((r, i) => r.status !== 'locked' || i < data.rows.findIndex(v => v.status === 'locked') + 2);
  const footer = row ? <div className="keys">
    <button type="button" className="key" data-qa-target data-testid="reward-claim" disabled={row.status !== 'ready'}
      onClick={() => shell.dispatch({ type: 'claimRoundReward', milestone: row.milestone })}>{row.status === 'claimed' ? 'Claimed' : row.status === 'ready' ? 'Claim reward' : 'Reach this milestone'}</button>
    <button type="button" className="key ghost" data-qa-target onClick={() => setSelected(null)}>All milestones</button>
  </div> : null;
  return <PlateFrame key={row?.milestone ?? 'list'} title={row ? `${wholeText(row.milestone)} tasks` : 'Round rewards'}
    className="round-rewards-plate" bounds={area} spill={spill} footer={footer} onClose={close}>
    {row ? <>
      <div className="reward-heading">{icon(row)}<b>{row.name}</b></div>
      <p className={`p-status ${row.status === 'ready' ? 'reward-ready' : row.status === 'claimed' ? 'reward-done' : ''}`}>
        {row.status === 'ready' ? 'Ready to claim' : row.status === 'claimed' ? 'Claimed' : 'First reach required'}</p>
      <p className="p-line muted">{row.status === 'locked' ? 'Minimum first-time grant' : `First-time grant · Round ${row.round}`}</p>
      <div className="reward-grant"><span className="pz"><CoinIcon />{wholeText(row.credits)}</span><span className="pz d"><GemIcon />{wholeText(row.data)}</span></div>
      <p className="p-line">{row.effect}</p><p className="p-line ben">{row.limit}.</p>
      {research && <div className="reward-project"><b>Opens research · {research.name}</b><p>{research.effect}</p>
        {row.status === 'claimed' && <button type="button" className="key row" data-qa-target onClick={() => {
          shell.view.dispatch({ type: 'openRoundRewards', milestone: row.milestone });
          shell.view.dispatch({ type: 'openResearch', project: row.research as ResearchId });
        }}>View research</button>}</div>}
      <details className="reward-calculation"><summary>Bonus calculation</summary><p>Match 100% of base task Credits and Data earned since the previous milestone. Minimum 20 Credits and 2 Data per milestone count. The grant freezes on first reach and excludes other bonuses.</p></details>
      <p className="p-line muted">{row.status === 'locked' ? `Complete ${wholeText(row.milestone)} logical tasks in one round.` : 'Earned once per save. Pending rewards survive Return and offline play.'}</p>
    </> : <>
      <p className="p-status">{data.ready ? `${data.ready} reward${data.ready === 1 ? '' : 's'} ready to claim` : `Next reward · ${wholeText(data.next)} tasks`}</p>
      <p className="p-line muted">This round {wholeText(data.current)} · Best {wholeText(data.best)}</p>
      <div className="keys reward-list">{rows.map(r => <button type="button" className="key row" data-qa-target key={r.milestone} onClick={() => setSelected(r.milestone)}>
        {icon(r)}<span className="reward-list-name"><b>{wholeText(r.milestone)} tasks</b><span>{r.name}</span></span>
        <span className={r.status === 'ready' ? 'reward-ready' : r.status === 'claimed' ? 'reward-done' : ''}>{r.status === 'ready' ? 'Claim' : r.status === 'claimed' ? 'Claimed' : 'Locked'}</span>
      </button>)}</div>
      {!later && <button type="button" className="key ghost reward-later" data-qa-target onClick={() => setLater(true)}>Later milestones</button>}
    </>}
  </PlateFrame>;
}

export function RoundRewardsScreen() {
  const view = useViewState();
  return view.sheet === 'roundRewards' ? <Contents key={view.rewardMilestone ?? 'list'} initial={view.rewardMilestone} /> : null;
}
