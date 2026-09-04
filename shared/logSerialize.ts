// Pure, no I/O -- shared between background/logging/handler.ts's log()
// (developer-authored Error/detail objects) and content/log.ts's
// reportLog() (a content script has no access to background/logging/
// handler.ts's module, a separate JS execution context, but needs the
// exact same Error-to-string/passthrough/JSON.stringify behavior so a
// LogEntry.detail round-trips identically regardless of which side wrote
// it).
export function serializeLogDetail(detail: unknown): string | undefined {
  if (detail === undefined) return undefined;
  if (detail instanceof Error) return detail.stack ?? detail.message;
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}
