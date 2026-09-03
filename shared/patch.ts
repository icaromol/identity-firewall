// A /code-review finding (flagged independently across multiple review
// passes as it kept getting copy-pasted): Zod preserves an explicit
// `undefined`-valued key as a real own-enumerable property through
// `Schema.parse`, so `{ ...current, ...patch }` alone silently overwrites
// a previously-saved field with `undefined` whenever a caller's patch
// object happens to carry one -- a common shape for a reactive form
// object, where an untouched field is `undefined` rather than omitted
// entirely. Stripping `undefined`-valued keys before merging treats them
// the same as a fully-absent key, so a patch can never silently clobber a
// stored value it didn't mean to touch. A real, meaningful `null` (e.g.
// AppSettings' autoLockSeconds: null, meaning "never auto-lock") is NOT
// stripped -- only `undefined` is.
export function stripUndefinedValues<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
