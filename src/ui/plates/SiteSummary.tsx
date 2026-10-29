import type { SiteView, PartRef } from '../../game';
import { bitRate, watts } from './format';
import { ComponentRow } from './ComponentRow';

/** The site's existing infrastructure, opened through its nameplate. */
export function SiteSummary({ site, onOpen }: { site: SiteView; onOpen: (part: PartRef) => void }) {
  if (site.siteId === null) return null;
  const unit = { kind: 'site', id: site.siteId } as const;
  return <ul className="sys-summary" aria-label="Site infrastructure">
    <li><ComponentRow label="Generation" value={site.generation ? watts(site.generation.outputW) : 'None'}
      part={{ unit, slot: { kind: 'generation' } }} onOpen={() => onOpen({ unit, slot: { kind: 'generation' } })} /></li>
    {site.grid && <li><ComponentRow label="Grid supply" value={watts(site.grid.deliveredW) + ' of ' + watts(site.grid.capacityW)}
      part={{ unit, slot: { kind: 'grid' } }} onOpen={() => onOpen({ unit, slot: { kind: 'grid' } })} /></li>}
    {site.dataPlane && <li><ComponentRow label="Data plane" value={bitRate(site.dataPlane.bitsPerSec)}
      part={{ unit, slot: { kind: 'dataPlane' } }} onOpen={() => onOpen({ unit, slot: { kind: 'dataPlane' } })} /></li>}
  </ul>;
}
