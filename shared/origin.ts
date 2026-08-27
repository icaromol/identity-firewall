// The single canonical origin-normalization function. Used everywhere an
// origin is a storage key, a KDF input (docs/identity-model.md, ADR-010),
// or a comparison value. Attestto's own codebase had five independent
// copies of equivalent logic before consolidating into one branded type
// (docs/research/attestto-teardown.md §7) -- this project starts with one.
//
// Reduces to `protocol//host`: lowercased, punycoded (via the WHATWG URL
// parser), default ports (:443/:80) stripped, non-default ports kept
// (load-bearing for local dev against e.g. http://localhost:5173).

export type CanonicalOrigin = string & { readonly __brand: 'CanonicalOrigin' };

export function normalizeOrigin(input: string): CanonicalOrigin {
  const url = new URL(input);
  return `${url.protocol}//${url.host}` as CanonicalOrigin;
}
