// Phase 1 message contract. Every message crossing content script /
// background / popup boundaries is validated with Zod, not just typed --
// see docs/browser-architecture.md's tech-stack table. A message that
// fails validation is rejected at the router boundary (background/router/
// dispatch.ts, M3), before any handler runs.
//
// This is deliberately the FULL Phase 1 message set -- three types.
// VAULT_UNLOCK, GET_SERVICE_IDENTITY, CLASSIFY_FIELDS, POLICY_DECISION,
// etc. belong to Phase 2/3/4 and get added to the same discriminated
// union later, additively -- see docs/plans/phase-1-extension-foundation.md.

import { z } from 'zod';

export const DetectedFieldSchema = z.object({
  tagName: z.enum(['input', 'textarea', 'select']),
  type: z.string().nullable(), // input.type; null for textarea/select
  name: z.string().nullable(),
  id: z.string().nullable(),
  required: z.boolean(),
});
export type DetectedField = z.infer<typeof DetectedFieldSchema>;

export const DetectedFormSchema = z.object({
  formIndex: z.number(), // position within document.forms
  action: z.string().nullable(),
  method: z.string().nullable(),
  fields: z.array(DetectedFieldSchema),
});
export type DetectedForm = z.infer<typeof DetectedFormSchema>;

// --- Content script -> Background ---
export const FormDetectedMessageSchema = z.object({
  type: z.literal('FORM_DETECTED'),
  payload: z.object({
    origin: z.string(), // canonical origin, see shared/origin.ts
    url: z.string(),
    detectedAt: z.number(), // epoch ms
    forms: z.array(DetectedFormSchema),
  }),
});
export type FormDetectedMessage = z.infer<typeof FormDetectedMessageSchema>;

// --- Popup -> Background ---
export const GetSessionStateMessageSchema = z.object({
  type: z.literal('GET_SESSION_STATE'),
  payload: z.object({}).optional(),
});
export type GetSessionStateMessage = z.infer<typeof GetSessionStateMessageSchema>;

export const GetOriginStateMessageSchema = z.object({
  type: z.literal('GET_ORIGIN_STATE'),
  payload: z.object({ origin: z.string() }),
});
export type GetOriginStateMessage = z.infer<typeof GetOriginStateMessageSchema>;

export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  FormDetectedMessageSchema,
  GetSessionStateMessageSchema,
  GetOriginStateMessageSchema,
]);
export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

// --- Reply envelope: every handler resolves to exactly one of these ---
export type MessageResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

// GET_SESSION_STATE's response payload shape (background/session/handler.ts's
// handleGetSessionState). Named once and imported by both the handler and
// stores/session.store.ts, rather than each declaring its own copy -- the
// message channel itself is untyped JSON, but within this single-package
// TypeScript program a rename here still forces both sides to be updated
// together at compile time.
export interface OriginSummary {
  origin: string;
  formCount: number;
  lastDetectedAt: number;
}
