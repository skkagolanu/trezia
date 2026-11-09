// Supabase's generated types model an embedded to-one relation (e.g. `units(flat_number)`)
// as an array even when the foreign key guarantees a single row, so consumers otherwise
// cast `row.units as unknown as {...}` at every call site. This unwraps that shape once:
// an array yields its first row, a bare object is returned as-is, null/undefined → null.
export function firstRelation<T>(rel: unknown): T | null {
  if (rel == null) return null;
  if (Array.isArray(rel)) return (rel[0] as T) ?? null;
  return rel as T;
}
