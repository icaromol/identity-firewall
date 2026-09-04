// Phase 7 Part A M4 -- an ephemeral, get-and-clear per-origin flag
// (chrome.storage.session, never the encrypted vault -- same storage tier
// pendingCapture.ts uses and for the same reason: this is throwaway UI
// state, not a durable record) so the popup can show a one-time "Login
// saved automatically." confirmation if it happens to be open, or gets
// opened shortly after, a credential was captured under
// credentialSaveMode: 'auto'. Unlike pendingCapture.ts's PendingCredential
// (which the user must explicitly confirm or discard), this holds no
// data of its own and is consumed the first time anything asks for it --
// there's nothing to confirm, only something to have shown once.

import { browser } from 'wxt/browser';
import type { CanonicalOrigin } from '../../../shared/origin';
import { log } from '../../logging/handler';

const AUTO_SAVE_NOTICE_STORAGE_KEY = 'if_auto_save_notice_v1';

interface AutoSaveNoticeState {
  origins: Record<string, true>;
}

async function readState(): Promise<AutoSaveNoticeState> {
  const stored = await browser.storage.session.get(AUTO_SAVE_NOTICE_STORAGE_KEY);
  return (
    (stored[AUTO_SAVE_NOTICE_STORAGE_KEY] as AutoSaveNoticeState | undefined) ?? { origins: {} }
  );
}

// Same single in-memory write-queue pattern as pendingCapture.ts's own --
// see that file's header comment for why this is safe across a service-
// worker restart (the queue only orders writes made while one worker
// instance is alive; it holds no state correctness depends on). Two
// origins auto-saving in close succession would otherwise be a plain
// read-modify-write race on this same blob, exactly the shape
// pendingCapture.ts already solved once.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(mutate: (state: AutoSaveNoticeState) => AutoSaveNoticeState): Promise<void> {
  const result = writeQueue.then(async () => {
    const state = await readState();
    await browser.storage.session.set({ [AUTO_SAVE_NOTICE_STORAGE_KEY]: mutate(state) });
  });
  writeQueue = result.catch(() => {});
  return result;
}

// Never throws -- this is a cosmetic confirmation, matching background/
// badge.ts's own updateBadgeForTab convention ("a failure updating it
// must never turn an otherwise-successful save... into a reported
// failure"). Without this, a failed chrome.storage.session write here
// would propagate out of handleFormSubmitted's auto-save branch and
// report the whole request as failed even though the credential itself
// was already saved successfully moments earlier.
export async function setAutoSaveNotice(origin: CanonicalOrigin): Promise<void> {
  try {
    await enqueueWrite((state) => ({ origins: { ...state.origins, [origin]: true } }));
  } catch (err) {
    log('debug', 'Identity Firewall: failed to set the auto-save notice', err);
  }
}

export async function takeAutoSaveNotice(origin: CanonicalOrigin): Promise<boolean> {
  const before = await readState();
  if (!before.origins[origin]) return false;

  await enqueueWrite((state) => {
    const { [origin]: _taken, ...rest } = state.origins;
    return { origins: rest };
  });
  return true;
}
