// Content scripts run in an isolated JS execution context (ADR-011 -- see
// entrypoints/content.ts's own header comment) and cannot import
// background/logging/handler.ts's module directly. reportLog() is the one
// way a content script gets an event into the SAME persisted log
// background code writes to, via a fire-and-forget RECORD_LOG_ENTRY
// message -- mirroring every other content -> background send in
// entrypoints/content.ts.
//
// Deliberately does NOT replace this file's callers' own direct
// console.debug/console.error calls -- those already print into the
// PAGE's own devtools console, a separate console from the background
// service worker's. Calling background's log() from here (if it were
// reachable) would print the same event a second time, in the wrong
// console. reportLog() only adds the missing persisted copy; callers keep
// consoling directly as they already do.
import { browser } from 'wxt/browser';
import { serializeLogDetail } from '../shared/logSerialize';
import type { LogLevel, RecordLogEntryMessage } from '../shared/messages';

export function reportLog(level: LogLevel, message: string, detail?: unknown): void {
  const recordMessage: RecordLogEntryMessage = {
    type: 'RECORD_LOG_ENTRY',
    payload: { level, message, detail: serializeLogDetail(detail) },
  };
  browser.runtime.sendMessage(recordMessage).catch(() => {});
}
