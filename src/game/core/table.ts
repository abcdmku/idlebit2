/**
 * Struct-of-arrays tables. A table is one typed array per column plus `len` (rows in use) and
 * `cap` (rows allocated). A column with stride s holds s values per row at [row * s + j].
 * Growth doubles capacity. Tables hold no functions, so they survive structuredClone and JSON.
 */
export interface ArrayKinds {
  u8: Uint8Array; i8: Int8Array; u16: Uint16Array; i16: Int16Array;
  u32: Uint32Array; i32: Int32Array; f32: Float32Array; f64: Float64Array;
}
export type ArrayKind = keyof ArrayKinds;
export type AnyTypedArray = ArrayKinds[ArrayKind];
export const ARRAY_CTORS = {
  u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array,
  u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array,
} as const;

export interface ColSpec { readonly t: ArrayKind; readonly stride?: number; readonly fill?: number }
export type Layout = { readonly [column: string]: ColSpec } & { readonly len?: never; readonly cap?: never };
export type Cols<L extends Layout> = { [K in Exclude<keyof L, 'len' | 'cap'>]: ArrayKinds[NonNullable<L[K]>['t']] };
export type Table<L extends Layout> = Cols<L> & { len: number; cap: number };

const makeColumn = (spec: ColSpec, rows: number): AnyTypedArray => {
  const column = new ARRAY_CTORS[spec.t](rows * (spec.stride ?? 1));
  if (spec.fill !== undefined && spec.fill !== 0) column.fill(spec.fill);
  return column;
};

/**
 * An empty table object per layout, as JSON. An object given this many properties one computed key
 * at a time becomes a hash table in V8, and every column read a hash probe; a parsed object keeps
 * fixed slots, and every table of a layout shares one shape. Key order is len, cap, then the columns.
 */
const TEMPLATES = new WeakMap<Layout, string>();
function emptyTable(layout: Layout): Record<string, unknown> {
  let json = TEMPLATES.get(layout);
  if (json === undefined) {
    json = JSON.stringify(Object.fromEntries([['len', 0], ['cap', 0], ...Object.keys(layout).map((key) => [key, null])]));
    TEMPLATES.set(layout, json);
  }
  return JSON.parse(json) as Record<string, unknown>;
}

export function allocTable<L extends Layout>(layout: L, cap: number, len = 0): Table<L> {
  const table = emptyTable(layout);
  table.len = len; table.cap = cap;
  for (const key of Object.keys(layout)) table[key] = makeColumn(layout[key]!, cap);
  return table as Table<L>;
}

/** Grows in place (callers own the table: a World clone or a fresh action copy). */
export function growTable<L extends Layout>(layout: L, table: Table<L>, minCap: number): Table<L> {
  if (table.cap >= minCap) return table;
  let cap = Math.max(1, table.cap);
  while (cap < minCap) cap *= 2;
  const writable = table as unknown as Record<string, AnyTypedArray | number>;
  for (const key of Object.keys(layout)) {
    const old = writable[key] as AnyTypedArray;
    const column = makeColumn(layout[key]!, cap);
    column.set(old as never);
    writable[key] = column;
  }
  table.cap = cap;
  return table;
}

/** Ensures room for `rows` rows and sets len to at least that. */
export function ensureRows<L extends Layout>(layout: L, table: Table<L>, rows: number): Table<L> {
  growTable(layout, table, rows);
  if (table.len < rows) table.len = rows;
  return table;
}

/** Deep copy of every column. Needs no layout, so it serves any table. */
export function cloneTable<T extends { len: number; cap: number }>(table: T): T {
  // A spread keeps the source's shape (see emptyTable); the columns are then replaced in place.
  const out: Record<string, unknown> = { ...table };
  for (const key in out) {
    const value = out[key];
    if (ArrayBuffer.isView(value)) out[key] = (value as unknown as AnyTypedArray).slice();
  }
  return out as T;
}

/**
 * A layout's reset plan: its one-value columns grouped by array kind (each loop below then stores
 * into one array type), and its wider columns. Derived from the layout once.
 */
interface ResetPlan {
  readonly keys: Readonly<Record<ArrayKind, readonly string[]>>;
  readonly fills: Readonly<Record<ArrayKind, readonly number[]>>;
  readonly wide: readonly { readonly key: string; readonly stride: number; readonly fill: number }[];
}
const RESET_PLANS = new WeakMap<Layout, ResetPlan>();
function resetPlan(layout: Layout): ResetPlan {
  const hit = RESET_PLANS.get(layout);
  if (hit) return hit;
  const group = (): Record<ArrayKind, never[]> => ({ u8: [], i8: [], u16: [], i16: [], u32: [], i32: [], f32: [], f64: [] });
  const keys: Record<ArrayKind, string[]> = group(), fills: Record<ArrayKind, number[]> = group();
  const wide: { key: string; stride: number; fill: number }[] = [];
  for (const key in layout) {
    const spec = layout[key]!, stride = spec.stride ?? 1, fill = spec.fill ?? 0;
    if (stride === 1) { keys[spec.t].push(key); fills[spec.t].push(fill); } else wide.push({ key, stride, fill });
  }
  const plan: ResetPlan = { keys, fills, wide };
  RESET_PLANS.set(layout, plan);
  return plan;
}

/** Writes every column's fill value (default 0) into row `row`. */
export function resetRow<L extends Layout>(layout: L, table: Table<L>, row: number): void {
  const cols = table as unknown as Record<string, AnyTypedArray>;
  const { keys, fills, wide } = resetPlan(layout);
  let k = keys.f64, f = fills.f64;
  for (let i = 0; i < k.length; i += 1) (cols[k[i]!] as Float64Array)[row] = f[i]!;
  k = keys.i32; f = fills.i32;
  for (let i = 0; i < k.length; i += 1) (cols[k[i]!] as Int32Array)[row] = f[i]!;
  k = keys.u16; f = fills.u16;
  for (let i = 0; i < k.length; i += 1) (cols[k[i]!] as Uint16Array)[row] = f[i]!;
  k = keys.u8; f = fills.u8;
  for (let i = 0; i < k.length; i += 1) (cols[k[i]!] as Uint8Array)[row] = f[i]!;
  k = keys.u32; f = fills.u32;
  for (let i = 0; i < k.length; i += 1) (cols[k[i]!] as Uint32Array)[row] = f[i]!;
  k = keys.f32; f = fills.f32;
  for (let i = 0; i < k.length; i += 1) (cols[k[i]!] as Float32Array)[row] = f[i]!;
  k = keys.i16; f = fills.i16;
  for (let i = 0; i < k.length; i += 1) (cols[k[i]!] as Int16Array)[row] = f[i]!;
  k = keys.i8; f = fills.i8;
  for (let i = 0; i < k.length; i += 1) (cols[k[i]!] as Int8Array)[row] = f[i]!;
  for (let i = 0; i < wide.length; i += 1) {
    const { key, stride, fill } = wide[i]!;
    cols[key]!.fill(fill, row * stride, row * stride + stride);
  }
}

/** Copies every column of row `from` into row `to` of the same table. */
export function copyRow<L extends Layout>(layout: L, table: Table<L>, from: number, to: number): void {
  const cols = table as unknown as Record<string, AnyTypedArray>;
  for (const key in layout) {
    const stride = layout[key]!.stride ?? 1;
    const column = cols[key]!;
    column.copyWithin(to * stride, from * stride, from * stride + stride);
  }
}

export function tableBytes(table: { len: number; cap: number }): number {
  let bytes = 0;
  for (const value of Object.values(table)) if (ArrayBuffer.isView(value)) bytes += value.byteLength;
  return bytes;
}
