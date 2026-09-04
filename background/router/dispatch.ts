// Guarantees sendResponse fires exactly once, even when a handler throws.
// This is the direct fix for a real, shipped Attestto bug: "an unhandled
// promise rejection meant the page or approval window waited on a reply
// that would never come, indistinguishable from a user walking away"
// (docs/research/attestto-teardown.md §7/§8.3). Every code path through
// handleRuntimeMessage ends in exactly one sendResponse call: the
// schema-rejection and no-handler-registered branches both return
// synchronously, and the .then/.catch pair are mutually exclusive
// outcomes of the same promise -- nothing can call sendResponse twice or
// zero times.
//
// handleRuntimeMessage is exported separately from installMessageRouter so
// it can be unit-tested directly, without depending on the fidelity of a
// fake browser.runtime.onMessage dispatch mechanism.

import type { Browser } from 'wxt/browser';
import { browser } from 'wxt/browser';
import { ExtensionMessageSchema, type MessageResponse } from '../../shared/messages';
import { log } from '../logging/handler';
import { registry } from './registry';

// This is the ONE universal chokepoint every message already passes
// through -- logging here gives every current and future message type
// basic 'info'-level tracing for free, without touching each individual
// handler. Never logs `message.payload`/`data` themselves (could be
// PersonalData, a credential, a backup bundle -- anything), only the
// message `type` and success/failure, matching the sensitivity boundary
// the rest of this logging pass was designed against.
export function handleRuntimeMessage(
  raw: unknown,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void,
): boolean {
  const parsed = ExtensionMessageSchema.safeParse(raw);

  if (!parsed.success) {
    // 'debug', not 'info' -- a broken/hostile page sending malformed
    // messages could make this noisy, and it's not part of the "happy
    // path" trace the 'info' tier is for.
    log('debug', 'Identity Firewall: dispatch rejected a malformed message', {});
    // Reply path #1: validation failure. Always synchronous, always fires.
    sendResponse({ ok: false, error: 'INVALID_MESSAGE' });
    return false; // no async response coming
  }

  const message = parsed.data;
  log('info', 'Identity Firewall: dispatch received a message', { type: message.type });
  const entry = registry[message.type];

  if (!entry) {
    // Reply path #4: a schema-valid message type with no registered
    // handler yet (Phase 2's message types land ahead of their handlers,
    // M2-M7). Always synchronous, always fires. Unlogged -- an accepted,
    // by-design no-op during phased rollout, not a trace-worthy event.
    sendResponse({ ok: false, error: 'NOT_IMPLEMENTED' });
    return false;
  }

  entry
    .handle(message as never, { sender })
    .then((data) => {
      log('info', 'Identity Firewall: dispatch handler resolved', { type: message.type });
      // Reply path #2: handler resolved.
      sendResponse({ ok: true, data });
    })
    .catch((err: unknown) => {
      // Reply path #3: handler threw or its promise rejected. This is
      // the exact branch Attestto's own bug was missing.
      const errorMessage = err instanceof Error ? err.message : String(err);
      log('error', 'Identity Firewall: dispatch handler threw', {
        type: message.type,
        error: errorMessage,
      });
      sendResponse({ ok: false, error: errorMessage });
    });

  return true; // keep the message channel open for the async reply above
}

export function installMessageRouter(): void {
  browser.runtime.onMessage.addListener((raw, sender, sendResponse) =>
    handleRuntimeMessage(raw, sender, sendResponse),
  );
}
