// One label per site. The UI claims a target when its DOM control stands on it (name, price, lock); a
// level draws no label or "+" of its own on a claimed target (`view.sourceActions`). The renderer holds
// the claims and redraws at once when one changes, so the canvas and the DOM agree in every painted frame.
import type { ViewPresentation } from './types';

export class SiteClaims {
  private ids: readonly string[] = [];
  private source: ViewPresentation | null = null;
  private merged: ViewPresentation | null = null;
  /** True when the claim changed. */
  set(id: string, on: boolean): boolean {
    if (this.ids.includes(id) === on) return false;
    this.ids = on ? [...this.ids, id] : this.ids.filter(x => x !== id);
    this.merged = null;
    return true;
  }
  /** `view` with the claimed targets as its `sourceActions`; the same object until the view or a claim changes. */
  view(view: ViewPresentation): ViewPresentation {
    if (view !== this.source || !this.merged) { this.source = view; this.merged = { ...view, sourceActions: this.ids }; }
    return this.merged;
  }
}
