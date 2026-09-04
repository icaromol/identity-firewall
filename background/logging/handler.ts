// log() is the one function the rest of background/ should call instead
// of a bare console.debug/console.error -- it keeps the exact same
// console output (zero change to DevTools visibility) and additionally
// persists the entry to the bounded log (storage.ts), gated on the
// user's own logLevel threshold (default 'debug' -- persist everything).
// Never throws into its caller, matching background/badge.ts's own "never
// throws" contract for this exact class of non-critical, catch-block side
// effect.

import { serializeLogDetail } from '../../shared/logSerialize';
import type {
  ClearLogsMessage,
  ClearLogsResponse,
  GetLogsMessage,
  GetLogsResponse,
  LogLevel,
  RecordLogEntryMessage,
  RecordLogEntryResponse,
} from '../../shared/messages';
import type { LogThreshold } from '../../shared/settings';
import { getAppSettings } from '../settings/storage';
import { appendLogEntry, clearLog, getLogEntries } from './storage';

// A straight 3-branch ladder, not a rank table -- 'off' persists nothing
// (including 'error'-tagged entries: this purely gates persistence, no
// exceptions, matching ADR-019's own invariant -- a special-cased
// always-persist-errors behavior would be new, more-protective behavior
// nobody asked for), 'info' persists everything except the noisiest
// 'debug'-tagged entries, 'debug' persists everything.
function shouldPersist(threshold: LogThreshold, level: LogLevel): boolean {
  if (threshold === 'off') return false;
  if (threshold === 'info') return level !== 'debug';
  return true;
}

// Exported so handleRecordLogEntry (a content script's report, relayed via
// RECORD_LOG_ENTRY) can persist directly -- deliberately NOT via log()
// below, which would additionally console the message a second time. The
// content script already consoles its own message directly in the page's
// own devtools; only the persisted copy is missing from that context.
export async function persistLogEntry(
  level: LogLevel,
  message: string,
  detail: unknown,
): Promise<void> {
  try {
    const settings = await getAppSettings();
    if (!shouldPersist(settings.logLevel, level)) return;
    await appendLogEntry({
      timestamp: Date.now(),
      level,
      message,
      detail: serializeLogDetail(detail),
    });
  } catch {
    // Logging must never throw into its caller -- see this file's own
    // header comment.
  }
}

export function log(level: LogLevel, message: string, detail?: unknown): void {
  console[level](message, detail);
  void persistLogEntry(level, message, detail);
}

export async function handleGetLogs(_message: GetLogsMessage): Promise<GetLogsResponse> {
  return getLogEntries();
}

export async function handleClearLogs(_message: ClearLogsMessage): Promise<ClearLogsResponse> {
  await clearLog();
}

// message.payload.detail already arrives pre-serialized to a string (or
// undefined) -- content/log.ts's reportLog() runs serializeLogDetail()
// itself before sending, since it has no access to this module.
export async function handleRecordLogEntry(
  message: RecordLogEntryMessage,
): Promise<RecordLogEntryResponse> {
  await persistLogEntry(message.payload.level, message.payload.message, message.payload.detail);
}
