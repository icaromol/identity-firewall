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
import { handleGetPendingRequest, handleSubmitFieldDecisions } from '../firewall/handler';
import { handleFormDetected, handleFormSubmitted } from '../formDetection/handler';
import { handleCreateServiceIdentity, handleGetServiceIdentity } from '../identity/handler';
import { handleClearLogs, handleGetLogs } from '../logging/handler';
import {
  handleDeletePolicy,
  handleGetAllPrivacyLedger,
  handleGetPolicies,
  handleGetPrivacyLedger,
  handleSetHighTrustOrigin,
  handleSetPolicy,
} from '../policy/handler';
import { handleGetOriginState, handleGetSessionState } from '../session/handler';
import { handleGetAppSettings, handleSetAppSettings } from '../settings/handler';
import {
  handleConfirmPendingCredential,
  handleDeleteCredential,
  handleDiscardPendingCredential,
  handleFillCredential,
  handleGetCredential,
  handleGetPendingCredential,
  handleSaveCredential,
  handleTakeAutoSaveNotice,
} from '../vault/credentials/handler';
import {
  handleCreateRootIdentity,
  handleExportVaultBackup,
  handleRestoreVaultBackup,
  handleVaultLock,
  handleVaultStatus,
  handleVaultUnlock,
} from '../vault/handler';
import { handleGetPersonalData, handleSetPersonalData } from '../vault/personalData/handler';

export type Capability =
  | 'formDetection'
  | 'session'
  | 'vault'
  | 'identity'
  | 'firewall'
  | 'policy'
  | 'settings'
  | 'logging';

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
    handle: (message, ctx) => handleFormDetected(message, ctx),
  },
  FORM_SUBMITTED: {
    capability: 'formDetection',
    handle: (message, ctx) => handleFormSubmitted(message, ctx),
  },
  GET_SESSION_STATE: {
    capability: 'session',
    handle: (message) => handleGetSessionState(message),
  },
  GET_ORIGIN_STATE: {
    capability: 'session',
    handle: (message) => handleGetOriginState(message),
  },
  GET_PENDING_REQUEST: {
    capability: 'firewall',
    handle: (message) => handleGetPendingRequest(message),
  },
  SUBMIT_FIELD_DECISIONS: {
    capability: 'firewall',
    handle: (message) => handleSubmitFieldDecisions(message),
  },
  VAULT_STATUS: {
    capability: 'vault',
    handle: (message) => handleVaultStatus(message),
  },
  CREATE_ROOT_IDENTITY: {
    capability: 'vault',
    handle: (message) => handleCreateRootIdentity(message),
  },
  VAULT_UNLOCK: {
    capability: 'vault',
    handle: (message) => handleVaultUnlock(message),
  },
  VAULT_LOCK: {
    capability: 'vault',
    handle: (message) => handleVaultLock(message),
  },
  GET_SERVICE_IDENTITY: {
    capability: 'identity',
    handle: (message) => handleGetServiceIdentity(message),
  },
  CREATE_SERVICE_IDENTITY: {
    capability: 'identity',
    handle: (message) => handleCreateServiceIdentity(message),
  },
  GET_PERSONAL_DATA: {
    capability: 'vault',
    handle: (message) => handleGetPersonalData(message),
  },
  SET_PERSONAL_DATA: {
    capability: 'vault',
    handle: (message) => handleSetPersonalData(message),
  },
  GET_CREDENTIAL: {
    capability: 'vault',
    handle: (message) => handleGetCredential(message),
  },
  SAVE_CREDENTIAL: {
    capability: 'vault',
    handle: (message) => handleSaveCredential(message),
  },
  DELETE_CREDENTIAL: {
    capability: 'vault',
    handle: (message) => handleDeleteCredential(message),
  },
  GET_PENDING_CREDENTIAL: {
    capability: 'vault',
    handle: (message) => handleGetPendingCredential(message),
  },
  CONFIRM_PENDING_CREDENTIAL: {
    capability: 'vault',
    handle: (message) => handleConfirmPendingCredential(message),
  },
  DISCARD_PENDING_CREDENTIAL: {
    capability: 'vault',
    handle: (message) => handleDiscardPendingCredential(message),
  },
  TAKE_AUTO_SAVE_NOTICE: {
    capability: 'vault',
    handle: (message) => handleTakeAutoSaveNotice(message),
  },
  FILL_CREDENTIAL: {
    capability: 'vault',
    handle: (message) => handleFillCredential(message),
  },
  EXPORT_VAULT_BACKUP: {
    capability: 'vault',
    handle: (message) => handleExportVaultBackup(message),
  },
  RESTORE_VAULT_BACKUP: {
    capability: 'vault',
    handle: (message) => handleRestoreVaultBackup(message),
  },
  GET_POLICIES: {
    capability: 'policy',
    handle: (message) => handleGetPolicies(message),
  },
  SET_POLICY: {
    capability: 'policy',
    handle: (message) => handleSetPolicy(message),
  },
  DELETE_POLICY: {
    capability: 'policy',
    handle: (message) => handleDeletePolicy(message),
  },
  SET_HIGH_TRUST_ORIGIN: {
    capability: 'policy',
    handle: (message) => handleSetHighTrustOrigin(message),
  },
  GET_PRIVACY_LEDGER: {
    capability: 'policy',
    handle: (message) => handleGetPrivacyLedger(message),
  },
  GET_ALL_PRIVACY_LEDGER: {
    capability: 'policy',
    handle: (message) => handleGetAllPrivacyLedger(message),
  },
  GET_APP_SETTINGS: {
    capability: 'settings',
    handle: (message) => handleGetAppSettings(message),
  },
  SET_APP_SETTINGS: {
    capability: 'settings',
    handle: (message) => handleSetAppSettings(message),
  },
  GET_LOGS: {
    capability: 'logging',
    handle: (message) => handleGetLogs(message),
  },
  CLEAR_LOGS: {
    capability: 'logging',
    handle: (message) => handleClearLogs(message),
  },
};
