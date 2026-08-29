// A stable identifier for one field within one form's fields array --
// shared by the approval UI (which keys its decisions map by this) and
// entrypoints/content.ts's autofill listener (which re-derives the same
// key from the live DOM to know which element a resolved value belongs
// to). Defined once, here, so the two sides can never independently drift
// on how a field is identified.
//
// Always index-prefixed, not name/id alone -- a /code-review finding: two
// fields can legitimately share a `name` in the real world (e.g. separate
// "Billing address" / "Shipping address" fieldsets both using
// name="address"), which would otherwise collide on one decision and, at
// autofill time, write the same resolved value into both fields. `index`
// is always unique within one form's fields array by construction
// (Array.prototype.map's own index), so prefixing with it makes the key
// unique regardless of what name/id collisions the page itself has; the
// name/id suffix remains purely for human-readability in error messages.
export function getFieldKey(
  field: { name: string | null; id: string | null },
  index: number,
): string {
  return `${index}:${field.name ?? field.id ?? 'field'}`;
}
