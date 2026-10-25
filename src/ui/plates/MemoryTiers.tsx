// The system's memory hierarchy (D26.1, D26.7): cache, then RAM, then disk. Every bit on disk is
// there because RAM was full, so only disk is hatched and reads "spilled" (lead ruling, matching the
// board); cache and RAM read plainly as used of capacity.
import type { MemTier, MemTierView } from '../../game';
import { formatHertz, formatSize } from '../../game';

const TIER_NAME: Readonly<Record<MemTier, string>> = { cache: 'Cache', ram: 'RAM', disk: 'Disk' };

/** "64 kb / 128 kb", or for disk "1.2 Mb spilled" (warning) or its free capacity when nothing spilled. */
export function tierText(t: MemTierView): { text: string; tone: '' | 'warn' | 'dim' } {
  if (t.capacityBits <= 0) return { text: 'none', tone: 'dim' };
  if (t.tier === 'disk') return t.usedBits > 0 ? { text: `${formatSize(t.usedBits)} spilled`, tone: 'warn' } : { text: formatSize(t.capacityBits), tone: 'dim' };
  return { text: `${formatSize(t.usedBits)} / ${formatSize(t.capacityBits)}`, tone: '' };
}

export function MemoryTiers({ tiers }: { tiers: readonly MemTierView[] }) {
  return <div className="mem-tiers" role="group" aria-label="Memory" data-testid="mem-tiers">
    {tiers.map(t => {
      const used = Math.min(1, t.usedBits / Math.max(1, t.capacityBits)), disk = t.tier === 'disk', v = tierText(t);
      return <div key={t.tier} className="mem-tier" data-tier={t.tier}>
        <span className="k">{TIER_NAME[t.tier]}</span>
        <span className={`v ${v.tone}`}>{v.text}</span>
        <i className="mem-bar" aria-hidden="true">{disk ? (t.usedBits > 0 && <s style={{ width: `${used * 100}%` }} />) : <b style={{ width: `${used * 100}%` }} />}</i>
        {t.rateBits !== null && t.capacityBits > 0 && <span className="mem-note">{disk ? 'Spill speed' : 'Bandwidth'} {formatHertz(t.rateBits)}</span>}
      </div>;
    })}
  </div>;
}
