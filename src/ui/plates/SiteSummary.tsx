import type { SiteView, PartRef } from '../../game';
import { bitRate, watts } from './format';

/** The site's existing infrastructure, opened through its nameplate. */
export function SiteSummary({ site, onOpen }: { site: SiteView; onOpen: (part: PartRef) => void }) {
  if (site.siteId === null) return null;
  const unit = { kind: 'site', id: site.siteId } as const;
  return <ul className="sys-summary" aria-label="Site infrastructure">
    {site.grid && <li><button type="button" className="sum-row" data-qa-target onClick={() => onOpen({ unit, slot: { kind: 'grid' } })}>
      <b>Grid supply</b><span>{watts(site.grid.deliveredW)} of {watts(site.grid.capacityW)}</span></button></li>}
    {site.dataPlane && <li><button type="button" className="sum-row" data-qa-target onClick={() => onOpen({ unit, slot: { kind: 'dataPlane' } })}>
      <b>Data plane</b><span>{bitRate(site.dataPlane.bitsPerSec)}</span></button></li>}
  </ul>;
}
