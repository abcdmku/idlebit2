// Part versions for the purchase flash (A10): one number per part that rises with every upgrade.
/** Generation first, then level: a replacement or an upgrade both raise it. */
export const partVersionOf = (v: { readonly generation: number; readonly level?: number } | null | undefined): number | null =>
  v ? v.generation * 1024 + (v.level ?? 0) : null;
/** A part made of several (cache levels): the sum of their versions, plus how many there are. */
export function sumVersions(list: readonly { readonly generation: number; readonly level: number }[]): number {
  let n = list.length * 1_048_576;
  for (const v of list) n += v.generation * 1024 + v.level;
  return n;
}
