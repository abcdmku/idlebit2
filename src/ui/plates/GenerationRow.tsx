// D31.4 a site's off-grid generation, on the site plate: what kind, its output and how much of it the
// site uses now, and what a joule costs at the margin (0 with renewable headroom).
import type { GenerationView } from '../../game';
import { watts } from './format';

export const GENERATION_NAMES: Readonly<Record<GenerationView['kind'], string>> = {
  solar: 'Solar farm', wind: 'Wind farm', fuelCell: 'Fuel cell', ownPlant: 'Own plant',
};
const FUELLED = new Set<GenerationView['kind']>(['fuelCell', 'ownPlant']);

/** "Solar farm L2", "40 kW of 64 kW used", "No fuel" or "Fuel billed". */
export function generationLines(g: GenerationView | null): [string, string] {
  if (!g) return ['Generation: none', 'Grid only: every watt at the region price'];
  const use = `${watts(g.usedW)} of ${watts(g.outputW)} used`;
  return [`${GENERATION_NAMES[g.kind]} L${g.level}`, `${use} · ${FUELLED.has(g.kind) ? 'fuel billed' : 'no fuel'}`];
}

export function GenerationRow({ generation }: { generation: GenerationView | null }) {
  const [head, sub] = generationLines(generation);
  const used = generation && generation.outputW > 0 ? Math.min(1, generation.usedW / generation.outputW) : 0;
  return <div className="gen-row" data-testid="generation-row" data-kind={generation?.kind ?? 'none'}>
    <p className="gen-head"><b>{head}</b></p>
    <p className="gen-sub">{sub}</p>
    <i className="gen-bar" aria-hidden="true"><b style={{ width: `${Math.round(used * 100)}%` }} /></i>
  </div>;
}
