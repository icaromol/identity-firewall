// Capability-scoped message router. Each message type is owned by
// exactly one capability -- a module that eventually owns a whole slice
// of background behavior. Attestto's own background script grew into a
// ~1,300-line switch over ~30 message-type strings before a mid-project
// refactor into a pattern like this one (docs/research/attestto-teardown.md
// §7-8) -- we start with the capability-scoped shape instead of retrofitting
// it later. Phase 1 only has real handlers for `formDetection` and
// `session`; `vault`/`identity`/`firewall` are named now so their message
// types land in the right place later without a reshuffle.

import type { Browser } from 'wxt/browser';
import type { ExtensionMessage } from '../../shared/messages';
import { handleFormDetected } from '../formDetection/handler';
import { handleGetOriginState, handleGetSessionState } from '../session/handler';

export type Capability = 'formDetection' | 'session' | 'vault' | 'identity' | 'firewall';

export interface HandlerContext {
  sender: Browser.runtime.MessageSender;
}

type Handler<M extends ExtensionMessage> = (message: M, ctx: HandlerContext) => Promise<unknown>;

// Partial: Phase 2's message types (shared/messages.ts) land in the union
// ahead of their handlers (M2-M7 build those). A type missing from this
// registry isn't a compile error -- dispatch.ts's `entry` check turns it
// into a runtime NOT_IMPLEMENTED response instead, so the message
// contract can be written and tested (M1) independently of the handlers
// that will eventually satisfy it.
type Registry = Partial<{
  [K in ExtensionMessage['type']]: {
    capability: Capability;
    handle: Handler<Extract<ExtensionMessage, { type: K }>>;
  };
}>;

export const registry: Registry = {
  FORM_DETECTED: {
    capability: 'formDetection',
    handle: (message) => handleFormDetected(message),
  },
  GET_SESSION_STATE: {
    capability: 'session',
    handle: (message) => handleGetSessionState(message),
  },
  GET_ORIGIN_STATE: {
    capability: 'session',
    handle: (message) => handleGetOriginState(message),
  },
};
