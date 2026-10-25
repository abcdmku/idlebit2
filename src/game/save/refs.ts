/**
 * Reference-preserving JSON for plain state. `build` shares immutable sub-objects by reference
 * (a copied server shares its parts with its source), and saves keep that sharing: an object or
 * array reached twice is written once as { $id, $o | $a } and afterwards as { $ref }.
 * Typed arrays are leaves here; serialize.ts encodes them.
 */
type Json = unknown;

/** Objects and arrays reachable more than once from `root`. */
export function sharedNodes(root: Json): Set<object> {
  const seen = new Set<object>();
  const shared = new Set<object>();
  const stack: Json[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v !== 'object' || v === null || ArrayBuffer.isView(v)) continue;
    if (seen.has(v)) { shared.add(v); continue; }
    seen.add(v);
    if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i -= 1) stack.push(v[i]); }
    else for (const key in v) stack.push((v as Record<string, Json>)[key]);
  }
  return shared;
}

/** A JSON.stringify replacer that writes shared nodes once. `encodeLeaf` handles typed arrays. */
export function refReplacer(root: Json, encodeLeaf: (value: ArrayBufferView) => Json): (key: string, value: Json) => Json {
  const shared = sharedNodes(root);
  const ids = new Map<object, number>();
  let pending: object | null = null;
  return (_key, value) => {
    if (typeof value !== 'object' || value === null) return value;
    if (ArrayBuffer.isView(value)) return encodeLeaf(value);
    if (value === pending) { pending = null; return value; }
    if (!shared.has(value)) return value;
    const id = ids.get(value);
    if (id !== undefined) return { $ref: id };
    ids.set(value, ids.size);
    pending = value;
    return Array.isArray(value) ? { $id: ids.size - 1, $a: value } : { $id: ids.size - 1, $o: value };
  };
}

/**
 * Resolves a parsed document in place: { $id } definitions, { $ref } references and leaves that
 * `decodeLeaf` recognises (typed arrays). A pre-order walk in key order visits nodes in document
 * order, and a definition's subtree never refers to itself, so every definition is registered
 * before any reference to it.
 */
export function resolveRefs(root: Json, decodeLeaf: (value: Record<string, Json>) => Json | undefined): Json {
  const nodes: Json[] = [];
  const visit = (value: Json): Json => {
    if (typeof value !== 'object' || value === null) return value;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) value[i] = visit(value[i]);
      return value;
    }
    const v = value as Record<string, Json>;
    if ('$ref' in v) {
      const node = nodes[v.$ref as number];
      if (node === undefined) throw new Error(`save: dangling $ref ${String(v.$ref)}`);
      return node;
    }
    if ('$id' in v) {
      const id = v.$id as number;
      const resolved = visit('$a' in v ? v.$a : v.$o);
      nodes[id] = resolved;
      return resolved;
    }
    const leaf = decodeLeaf(v);
    if (leaf !== undefined) return leaf;
    for (const key in v) v[key] = visit(v[key]);
    return v;
  };
  return visit(root);
}
