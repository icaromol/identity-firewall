// A stable identifier for one field within one form's fields array --
// shared by the approval UI (which keys its decisions map by this) and
// entrypoints/content.ts's autofill listener (which re-derives the same
// key from the live DOM to know which element a resolved value belongs
// to). Defined once, here, so the two sides can never independently drift
// on how a field is identified.
export function getFieldKey(
  field: { name: string | null; id: string | null },
  index: number,
): string {
  return field.name ?? field.id ?? `#${index}`;
}
