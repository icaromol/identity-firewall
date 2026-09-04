// log() is the one function the rest of background/ should call instead
// of a bare console.debug/console.error -- it keeps the exact same
// console output (zero change to DevTools visibility) and additionally
// persists the entry to the bounded log (storage.ts), gated on the
// user's own logsEnabled toggle (default on). Never throws into its
// caller, matching background/badge.ts's own "never throws" contract for
// this exact class of non-critical, catch-block side effect.

import type {
  ClearLogsMessage,
  ClearLogsResponse,
  GetLogsMessage,
  GetLogsResponse,
  LogLevel,
} from '../../shared/messages';
import { getAppSettings } from '../settings/storage';
import { appendLogEntry, clearLog, getLogEntries } from './storage';

function serializeDetail(detail: unknown): string | undefined {
  if (detail === undefined) return undefined;
  if (detail instanceof Error) return detail.stack ?? detail.message;
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

async function persistLogEntry(level: LogLevel, message: string, detail: unknown): Promise<void> {
  try {
    const settings = await getAppSettings();
    if (!settings.logsEnabled) return;
    await appendLogEntry({
      timestamp: Date.now(),
      level,
      message,
      detail: serializeDetail(detail),
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
