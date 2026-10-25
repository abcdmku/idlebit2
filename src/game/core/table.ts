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

export function allocTable<L extends Layout>(layout: L, cap: number, len = 0): Table<L> {
  const table: Record<string, unknown> = { len, cap };
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
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(table)) out[key] = ArrayBuffer.isView(value) ? (value as unknown as AnyTypedArray).slice() : value;
  return out as T;
}

/** Writes every column's fill value (default 0) into row `row`. */
export function resetRow<L extends Layout>(layout: L, table: Table<L>, row: number): void {
  const cols = table as unknown as Record<string, AnyTypedArray>;
  for (const key in layout) {
    const spec = layout[key]!;
    const stride = spec.stride ?? 1;
    cols[key]!.fill(spec.fill ?? 0, row * stride, row * stride + stride);
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
