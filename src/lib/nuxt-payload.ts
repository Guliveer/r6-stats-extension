// Nuxt CompactSerializer is a flat array where every value can be either a literal
// (string/number/bool/null) or an index pointing at another element. Object values are
// indices into the array. Some entries are wrapped as ["TypeTag", innerIdx]
// (e.g. ShallowReactive) — we treat those as transparent refs.
//
// We don't fully deserialize the graph (too many shapes, cycles). Instead we walk only
// the paths the caller asks about via the deref helpers below.

// Resolve a typed wrapper like ["ShallowReactive", 3] → arr[3]. Otherwise returns the
// element unchanged.
export function unwrapTyped(arr: unknown[], value: unknown): unknown {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') {
    const inner = arr[value[1]];
    return inner === undefined ? value : inner;
  }
  return value;
}

// Given an index that should point to a string, return that string (or null).
export function derefString(arr: unknown[], idx: unknown): string | null {
  if (typeof idx !== 'number') return typeof idx === 'string' ? idx : null;
  const v = arr[idx];
  return typeof v === 'string' ? v : null;
}

// Given an index that should point to a number, return that number (or null).
export function derefNumber(arr: unknown[], idx: unknown): number | null {
  if (typeof idx === 'number' && Number.isFinite(idx)) {
    const v = arr[idx];
    if (typeof v === 'number') return v;
  }
  return null;
}

// Given an index that should point to an object, return that object (or null).
export function derefObject(arr: unknown[], idx: unknown): Record<string, unknown> | null {
  if (typeof idx !== 'number') return null;
  const v = arr[idx];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}
