# Phase 1 Runtime Architecture: Message-Passing, Service-Worker Lifecycle, and Module Boundaries

This document designs the *skeleton* that [roadmap.md](../roadmap.md)'s Phase 1 ("Extension foundation," weeks 3–4) needs to deliver: a working MV3 extension that can detect forms, pass messages between content script / background / popup, and hold local state — with nothing from Phase 2 (vault encryption), Phase 3 (field classification / Identity Firewall), or Phase 4 (Policy Engine / Privacy Ledger) designed or implemented ahead of schedule. Every decision below traces to a specific lesson in [browser-architecture.md](../browser-architecture.md)'s "Engineering lessons carried over from the Attestto teardown" section, [attestto-teardown.md](attestto-teardown.md), or [webauthn-technical-notes.md](webauthn-technical-notes.md).

This document does not cover build tooling, WXT project scaffolding, manifest permission declarations, or CI setup — that's `docs/research/phase-1-tooling-scaffold.md` (sibling doc, separate effort). This is purely the runtime shape: message types, module boundaries, and what state exists where.

---

## 1. Message-passing architecture

### The lesson this implements

[attestto-teardown.md](attestto-teardown.md) §7–8 documents Attestto's background script growing into a ~1,300-line `switch` over ~30 message-type strings before a mid-project refactor into a capability-scoped dispatch pattern. [browser-architecture.md](../browser-architecture.md) already commits us to avoiding that: *"design the router as capability-scoped from the start, not a single giant switch."* With only 2–3 message types in Phase 1, the risk isn't complexity today — it's picking a shape now that doesn't survive Phase 2/3/4 adding message types additively.

### Message envelope

All messages are validated with Zod (per [browser-architecture.md](../browser-architecture.md)'s tech-stack table: *"Validation: Zod — schema validation for the data flowing between content script, background service, and UI"*), not just typed. A message that fails validation is rejected at the router boundary, before any handler runs.

```ts
// shared/messages.ts
import { z } from 'zod';

export const DetectedFieldSchema = z.object({
  tagName: z.enum(['input', 'textarea', 'select']),
  type: z.string().nullable(),       // input.type; null for textarea/select
  name: z.string().nullable(),
  id: z.string().nullable(),
  required: z.boolean(),
});
export type DetectedField = z.infer<typeof DetectedFieldSchema>;

export const DetectedFormSchema = z.object({
  formIndex: z.number(),             // position within document.forms
  action: z.string().nullable(),
  method: z.string().nullable(),
  fields: z.array(DetectedFieldSchema),
});
export type DetectedForm = z.infer<typeof DetectedFormSchema>;

// --- Content script -> Background ---
export const FormDetectedMessageSchema = z.object({
  type: z.literal('FORM_DETECTED'),
  payload: z.object({
    origin: z.string(),               // canonical origin, see shared/origin.ts
    url: z.string(),
    detectedAt: z.number(),           // epoch ms
    forms: z.array(DetectedFormSchema),
  }),
});

// --- Popup -> Background ---
export const GetSessionStateMessageSchema = z.object({
  type: z.literal('GET_SESSION_STATE'),
  payload: z.object({}).optional(),
});

export const GetOriginStateMessageSchema = z.object({
  type: z.literal('GET_ORIGIN_STATE'),
  payload: z.object({ origin: z.string() }),
});

export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  FormDetectedMessageSchema,
  GetSessionStateMessageSchema,
  GetOriginStateMessageSchema,
]);
export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

// --- Reply envelope: every handler resolves to exactly one of these ---
export type MessageResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
```

That's the full Phase 1 message set — three types. Deliberately not designed yet: `VAULT_UNLOCK`, `GET_SERVICE_IDENTITY`, `CLASSIFY_FIELDS`, `POLICY_DECISION`, or anything else belonging to Phase 2/3/4. Those get added to the same `z.discriminatedUnion` array later — additive, not a rewrite.

### Capability-scoped router

Each message type is owned by exactly one **capability** — a module that will eventually own a whole slice of background behavior. Phase 1 only has real logic for two capabilities; the rest are named now so their message types land in the right place later without a reshuffle.

| Message type | Capability | Handler module (Phase 1) |
|---|---|---|
| `FORM_DETECTED` | `formDetection` | `background/formDetection/handler.ts` |
| `GET_SESSION_STATE` | `session` | `background/session/handler.ts` |
| `GET_ORIGIN_STATE` | `session` | `background/session/handler.ts` |
| *(none yet)* | `vault` | absent — Phase 2 adds `background/vault/` handlers |
| *(none yet)* | `identity` | absent — Phase 2 adds `background/identity/` handlers |
| *(none yet)* | `firewall` | absent — Phase 3 adds `background/firewall/` handlers |

```ts
// background/router/registry.ts
import type { ExtensionMessage } from '../../shared/messages';
import { handleFormDetected } from '../formDetection/handler';
import { handleGetSessionState, handleGetOriginState } from '../session/handler';

export type Capability = 'formDetection' | 'session' | 'vault' | 'identity' | 'firewall';

export interface HandlerContext {
  sender: chrome.runtime.MessageSender;
}

type Handler<M extends ExtensionMessage> = (message: M, ctx: HandlerContext) => Promise<unknown>;

type Registry = {
  [K in ExtensionMessage['type']]: {
    capability: Capability;
    handle: Handler<Extract<ExtensionMessage, { type: K }>>;
  };
};

export const registry: Registry = {
  FORM_DETECTED: { capability: 'formDetection', handle: handleFormDetected },
  GET_SESSION_STATE: { capability: 'session', handle: handleGetSessionState },
  GET_ORIGIN_STATE: { capability: 'session', handle: handleGetOriginState },
};
```

Adding a Phase 2 message type means: add its Zod schema to the union, add one row to `registry`, write the handler in `background/vault/`. Nothing about `dispatch.ts` below changes shape.

### Dispatch: guaranteeing `sendResponse` fires exactly once

[attestto-teardown.md](attestto-teardown.md) §7 and §8.1 name a real, shipped Attestto bug: *"an unhandled promise rejection meant the page or approval window waited on a reply that would never come, indistinguishable from a user walking away."* The fix that document credits Attestto's own code with is structural — wrap every handler so the reply path can't be skipped, not "remember to catch your promises."

```ts
// background/router/dispatch.ts
import { ExtensionMessageSchema, type MessageResponse } from '../../shared/messages';
import { registry } from './registry';

export function installMessageRouter(): void {
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const parsed = ExtensionMessageSchema.safeParse(raw);

    if (!parsed.success) {
      // Reply path #1: validation failure. Always synchronous, always fires.
      sendResponse({ ok: false, error: 'INVALID_MESSAGE' } satisfies MessageResponse);
      return false; // no async response coming
    }

    const message = parsed.data;
    const entry = registry[message.type];

    entry
      .handle(message, { sender })
      .then((data) => {
        // Reply path #2: handler resolved.
        sendResponse({ ok: true, data } satisfies MessageResponse);
      })
      .catch((err: unknown) => {
        // Reply path #3: handler threw or its promise rejected.
        // This is the exact branch Attestto's own bug was missing.
        const message = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: message } satisfies MessageResponse);
      });

    return true; // keep the message channel open for the async reply above
  });
}
```

Every code path through this function ends in exactly one `sendResponse` call: the schema-rejection branch returns synchronously, and the `.then`/`.catch` pair are mutually exclusive outcomes of the same promise, so nothing can call `sendResponse` twice or zero times. This is the pattern Phase 2/3/4 handlers plug into — a handler that throws never leaves a caller hanging.

`entrypoints/background.ts` itself becomes a thin composition root:

```ts
// entrypoints/background.ts
import { installMessageRouter } from '../background/router/dispatch';

export default defineBackground(() => {
  installMessageRouter();
});
```

---

## 2. MV3 service-worker lifecycle: what Phase 1 actually needs to persist

### The lesson this implements

[browser-architecture.md](../browser-architecture.md) and [attestto-teardown.md](attestto-teardown.md) §3/§8.3 both flag the same failure mode: MV3 kills an idle service worker after ~30 seconds, and Attestto shipped a real bug from an in-memory `Map` of pending-approval state that vanished mid-approval. [security-model.md](../security-model.md) already commits the *vault unlock key* to `chrome.storage.session` for this exact reason.

### Is there anything to persist in Phase 1?

Honestly assessed: **almost nothing, but not literally nothing.** Phase 1 has no vault, no pending-approval flows, no identity state — the categories of state that motivated Attestto's bug don't exist yet. But the Phase 1 deliverable itself ("popup shows which origins the content script has reported forms on this session," per [roadmap.md](../roadmap.md)) creates one real piece of state: **the running list of `origin → form summary` accumulated as the user browses.**

This is not re-derivable on wake the way, say, a cache would be — if the service worker is killed and restarted between "content script reports a form on `github.com`" and "user opens the popup five minutes later," an in-memory-only store loses that origin and the Phase 1 demo itself breaks (the whole point is "does the popup still know about a site visited earlier this session"). So: Phase 1's one piece of session state is small, but it is genuine, user-visible state, and it goes in `chrome.storage.session` from day one — not because Phase 1 needs the robustness yet, but because this is exactly the pattern Phase 2 will pour real state into (pending vault-unlock state, later pending-approval rows), and it's cheaper to establish the wrapper now than to retrofit it once storage.session already has ad-hoc call sites.

What's deliberately *not* persisted in Phase 1: nothing else exists to persist. There is no lock state, no pending approval, no identity — those are Phase 2/3/4 concerns and this document does not invent placeholder state for them.

### Session state module

```ts
// background/session/state.ts
const SESSION_STORAGE_KEY = 'if_session_state_v1';

export interface OriginFormRecord {
  formCount: number;
  lastDetectedAt: number; // epoch ms
}

export interface SessionState {
  originForms: Record<string, OriginFormRecord>; // keyed by CanonicalOrigin (see §4)
}

const EMPTY_STATE: SessionState = { originForms: {} };

export async function getSessionState(): Promise<SessionState> {
  const stored = await chrome.storage.session.get(SESSION_STORAGE_KEY);
  return (stored[SESSION_STORAGE_KEY] as SessionState | undefined) ?? EMPTY_STATE;
}

export async function recordFormDetection(
  origin: string,
  formCount: number,
  detectedAt: number,
): Promise<void> {
  const state = await getSessionState();
  state.originForms[origin] = { formCount, lastDetectedAt: detectedAt };
  await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: state });
}
```

This is intentionally the *only* state-holding module in Phase 1's background. No in-memory `Map`, no module-level `let` variable caching anything across messages — every read goes through `chrome.storage.session`, so a service-worker restart between two messages is invisible to correctness (only Phase 1's "how many pending re-derivations happen" performance is at stake, and there's nothing expensive to re-derive here).

`chrome.storage.session` (not `.local`) is deliberate: this state should not survive the browser closing — it's "this session's" origins, not a permanent record. Phase 4's Privacy Ledger is the place a permanent per-site history belongs; conflating the two here would be building Phase 4 early.

---

## 3. Content script design for Phase 1

### Scope boundary

[roadmap.md](../roadmap.md) Phase 1's objective is "detect sites," not classify fields — that's Phase 3's Field Classifier (`email`, `national_identifier`, `birth_date`, etc., per [browser-architecture.md](../browser-architecture.md)'s legacy-pipeline walkthrough). Phase 1's content script reports **structure**, not **semantics**: which forms exist, what inputs they contain, and their raw HTML attributes — no inference about what a field *means*.

### MAIN-world or ISOLATED-world?

**ISOLATED-world only.** [webauthn-technical-notes.md](webauthn-technical-notes.md) §7 is explicit about when MAIN-world execution is actually required: *"Only from [MAIN-world] can our extension actually override `navigator.credentials.create`/`get` such that the page's own calls are intercepted... Without either mechanism, a content script has no visibility at all into a WebAuthn ceremony."* MAIN-world's entire justification in this project is intercepting `navigator.credentials`. Phase 1 does not touch WebAuthn at all, and per [ADR-011](../adr/ADR-011-webauthn-metadata-only-mode.md) (metadata-only mode), this project is **never** planning to intercept `navigator.credentials` even once WebAuthn support lands later — Option A there relies on the OS/platform authenticator handling real ceremonies untouched. So there is no future phase, not just Phase 1, that needs this content script to grow a MAIN-world component for credential interception.

Reading the DOM — `document.forms`, each form's `elements` — is fully available to an ISOLATED-world content script; ISOLATED and MAIN worlds share the same DOM, they only diverge on the JS object graph (`window`, `navigator`, etc.), per [webauthn-technical-notes.md](webauthn-technical-notes.md) §7's isolated-vs-MAIN distinction. Since Phase 1 never needs to touch `window.navigator`, the default ISOLATED world is sufficient and simpler — one fewer injected script, no world-ownership race to reason about (the same §7 notes MAIN-world "override wins" race between co-installed extensions; irrelevant here since Phase 1 installs nothing into MAIN world).

### What "detect forms" means in Phase 1

A structural summary, not a classification:

```ts
// entrypoints/content.ts
import { normalizeOrigin } from '../shared/origin';
import type { DetectedForm, ExtensionMessage } from '../shared/messages';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    reportForms();
  },
});

function reportForms(): void {
  const forms: DetectedForm[] = Array.from(document.forms).map((form, formIndex) => ({
    formIndex,
    action: form.getAttribute('action'),
    method: form.getAttribute('method'),
    fields: Array.from(form.elements)
      .filter(
        (el): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement,
      )
      .map((el) => ({
        tagName: el.tagName.toLowerCase() as 'input' | 'textarea' | 'select',
        type: el instanceof HTMLInputElement ? el.type : null,
        name: el.name || null,
        id: el.id || null,
        required: el.required,
      })),
  }));

  if (forms.length === 0) return;

  const message: ExtensionMessage = {
    type: 'FORM_DETECTED',
    payload: {
      origin: normalizeOrigin(location.href),
      url: location.href,
      detectedAt: Date.now(),
      forms,
    },
  };
  chrome.runtime.sendMessage(message);
}
```

Explicitly not in Phase 1: no semantic tagging (`email` vs `national_identifier`), no required/optional *trustworthiness* judgment (`data-model.md`'s "optional is a hint, not ground truth" question is a Phase 3 concern about the Field Classifier, not this raw reporter), and no dynamic-DOM/re-render observation (a `MutationObserver` for SPA-style forms that appear after load is explicitly [roadmap.md](../roadmap.md) Phase 6 scope — "detection of dynamically rendered pages" — and is skipped here rather than built early). A single `document_idle` pass reporting whatever forms exist at that moment is the whole of Phase 1's content script.

---

## 4. Background service worker module boundaries

Directory layout, stable from Phase 1 onward — later phases add files inside `vault/`, `identity/`, `firewall/` rather than restructuring the tree:

```text
entrypoints/
  background.ts              # composition root: installMessageRouter() only
  content.ts                 # §3

background/
  router/
    dispatch.ts              # §1 — installMessageRouter, guaranteed-single-reply wrapper
    registry.ts              # §1 — message-type -> {capability, handler} map
  formDetection/
    handler.ts               # handleFormDetected — Phase 1, real
  session/
    handler.ts               # handleGetSessionState, handleGetOriginState — Phase 1, real
    state.ts                 # §2 — chrome.storage.session wrapper
  vault/
    index.ts                 # STUB — Phase 2 fills this in
  identity/
    index.ts                 # STUB — Phase 2 fills this in
  firewall/
    index.ts                 # STUB — Phase 3 fills this in

shared/
  messages.ts                # §1 — Zod schemas + ExtensionMessage union
  origin.ts                  # canonical origin normalization, see below
```

`background/formDetection/handler.ts`:

```ts
// background/formDetection/handler.ts
import type { FormDetectedMessageSchema } from '../../shared/messages';
import { recordFormDetection } from '../session/state';
import { z } from 'zod';

type FormDetectedMessage = z.infer<typeof FormDetectedMessageSchema>;

export async function handleFormDetected(message: FormDetectedMessage): Promise<{ recorded: true }> {
  const { origin, forms, detectedAt } = message.payload;
  await recordFormDetection(origin, forms.length, detectedAt);
  return { recorded: true };
}
```

`background/session/handler.ts`:

```ts
// background/session/handler.ts
import { getSessionState } from './state';
import type { z } from 'zod';
import type { GetSessionStateMessageSchema, GetOriginStateMessageSchema } from '../../shared/messages';

export async function handleGetSessionState(
  _message: z.infer<typeof GetSessionStateMessageSchema>,
): Promise<{ originsWithForms: Array<{ origin: string; formCount: number; lastDetectedAt: number }> }> {
  const state = await getSessionState();
  return {
    originsWithForms: Object.entries(state.originForms).map(([origin, record]) => ({
      origin,
      ...record,
    })),
  };
}

export async function handleGetOriginState(
  message: z.infer<typeof GetOriginStateMessageSchema>,
): Promise<{ formCount: number; lastDetectedAt: number } | null> {
  const state = await getSessionState();
  return state.originForms[message.payload.origin] ?? null;
}
```

### Stub modules

Each of `vault/`, `identity/`, `firewall/` gets a placeholder `index.ts` — enough that the directory exists and imports resolve, nothing that implements Phase 2/3 logic:

```ts
// background/vault/index.ts
// STUB — Phase 2 (Local Identity Vault) implements this module.
// No message types are routed here yet; §1's registry has no `vault` rows.
export {};
```

(Same shape for `identity/index.ts` and `firewall/index.ts`, with their own phase noted in the comment.) These exist purely so the module boundary is decided now — Phase 2 opening a PR that adds files under `background/vault/` is additive to a tree that already expects it, not a restructuring.

### Canonical origin normalization

[attestto-teardown.md](attestto-teardown.md) §7 and §"Implications for our design" flag that Attestto found *five independent copies* of origin-normalization logic before consolidating into one function with a branded return type. Origin is already a map key in Phase 1 (`SessionState.originForms`), so this is worth doing now rather than after a second call site appears:

```ts
// shared/origin.ts
export type CanonicalOrigin = string & { readonly __brand: 'CanonicalOrigin' };

export function normalizeOrigin(input: string): CanonicalOrigin {
  const url = new URL(input);
  return `${url.protocol}//${url.host}` as CanonicalOrigin;
}
```

Every place Phase 1 uses an origin as a storage key or comparison value goes through this function. (`shared/messages.ts` above types `origin` as plain `string` for Zod-schema simplicity at the wire boundary; the branded type is used at the call sites that store or look up by origin, per Attestto's own pattern of branding only where it prevents a real class of bug — an un-normalized raw string reaching `state.originForms[rawUrl]`.)

---

## 5. Popup UI skeleton

Per [browser-architecture.md](../browser-architecture.md)'s stack table, this uses Vue 3 + Pinia. Popups are torn down and recreated on every open — there is no persistent popup-side state, so the store fetches fresh from background on every mount.

```ts
// entrypoints/popup/stores/session.store.ts
import { defineStore } from 'pinia';
import type { ExtensionMessage, MessageResponse } from '../../../shared/messages';

interface OriginSummary {
  origin: string;
  formCount: number;
  lastDetectedAt: number;
}

interface SessionStoreState {
  originsWithForms: OriginSummary[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
}

export const useSessionStore = defineStore('session', {
  state: (): SessionStoreState => ({
    originsWithForms: [],
    status: 'idle',
    error: null,
  }),
  actions: {
    async fetchSessionState(): Promise<void> {
      this.status = 'loading';
      const message: ExtensionMessage = { type: 'GET_SESSION_STATE', payload: {} };
      const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<{
        originsWithForms: OriginSummary[];
      }>;
      if (response.ok) {
        this.originsWithForms = response.data.originsWithForms;
        this.status = 'loaded';
      } else {
        this.error = response.error;
        this.status = 'error';
      }
    },
  },
});
```

```vue
<!-- entrypoints/popup/App.vue -->
<script setup lang="ts">
import { onMounted } from 'vue';
import { useSessionStore } from './stores/session.store';

const session = useSessionStore();
onMounted(() => {
  session.fetchSessionState();
});
</script>

<template>
  <main>
    <h1>Identity Firewall</h1>

    <section>
      <h2>Sites detected this session</h2>
      <p v-if="session.status === 'loading'">Loading…</p>
      <p v-else-if="session.status === 'error'">{{ session.error }}</p>
      <ul v-else-if="session.originsWithForms.length">
        <li v-for="entry in session.originsWithForms" :key="entry.origin">
          {{ entry.origin }} — {{ entry.formCount }} form(s)
        </li>
      </ul>
      <p v-else>No forms detected yet this session.</p>
    </section>

    <section>
      <h2>Vault</h2>
      <p><em>Not yet implemented — arrives in Phase 2.</em></p>
    </section>
  </main>
</template>
```

Nothing here calls `chrome.storage` directly from the popup — it only ever talks to background over the message router from §1, so background stays the single owner of session state (the popup is a pure read-through view, never a second writer).

---

## 6. Definition of done for Phase 1

Restating [roadmap.md](../roadmap.md)'s deliverable ("an extension installed in the browser, able to detect sites and hold local state") as a concrete checklist:

### Manual acceptance checklist

- [ ] `pnpm build` (or equivalent) produces an unpacked extension; loading it in Chrome via `chrome://extensions` → "Load unpacked" succeeds with no manifest errors.
- [ ] Visiting any page with a `<form>` (e.g. a real login page, or a local fixture page) triggers no visible errors in the page console or the service-worker console.
- [ ] Opening the toolbar popup on that tab shows the visited origin listed under "Sites detected this session," with a form count greater than zero.
- [ ] Visiting a second, different origin with a form, then reopening the popup, shows *both* origins listed (proves state accumulates across navigations, not just the most recent page).
- [ ] Waiting long enough for the service worker to go idle and be killed (or manually terminating it from `chrome://serviceworker-internals` / `chrome://extensions` → "service worker" → "terminate"), then reopening the popup, still shows the previously-detected origins (proves `chrome.storage.session` persistence survives the worker restart described in [browser-architecture.md](../browser-architecture.md)'s Attestto lessons and §2 above — not just an in-memory `Map` that looked fine only because the worker never actually died during a quick manual test).
- [ ] A page with no `<form>` element produces no message and no entry in the popup for that origin.
- [ ] The "Vault: not yet implemented" placeholder is visible and makes no network or storage calls.

### What a Vitest unit test covers

- **`shared/messages.ts`** — `ExtensionMessageSchema` accepts valid `FORM_DETECTED`/`GET_SESSION_STATE`/`GET_ORIGIN_STATE` payloads and rejects malformed ones (wrong `type` literal, missing required field, wrong field type).
- **`background/router/dispatch.ts`** — given a mocked `chrome.runtime.onMessage`, confirms: (a) a valid message routes to the correct capability's handler exactly once; (b) a handler that throws still results in exactly one `sendResponse({ ok: false, ... })` call, never zero and never two (the direct regression test for the Attestto bug in [attestto-teardown.md](attestto-teardown.md) §7); (c) an invalid raw message never reaches any handler.
- **`background/session/state.ts`** — `recordFormDetection` followed by `getSessionState` returns the recorded entry, against a mocked `chrome.storage.session`; confirms multiple origins accumulate rather than overwrite each other.
- **`shared/origin.ts`** — `normalizeOrigin` strips default ports, lowercases host, and treats `https://Example.com:443/path` and `https://example.com/other-path` as the same key.
- **Content script's DOM-parsing logic** — the pure function that walks `document.forms` (extracted so it's callable against a JSDOM fixture without a real browser), asserting it captures `tagName`/`type`/`name`/`id`/`required` correctly and does *not* attempt any semantic classification.

### What a Playwright e2e test covers

- Launches a real Chromium instance with the built extension loaded (`launchPersistentContext` with `--load-extension`), per the standard WXT/Playwright extension-testing pattern.
- Navigates a background page/tab to a local fixture HTML page containing a login-shaped form (`<input type="email">`, `<input type="password">`, `required` attributes on both).
- Opens the extension's popup (via its `chrome-extension://<id>/popup.html` URL, since Playwright can't click the real toolbar icon) and asserts the fixture page's origin appears in the rendered list with the expected form count.
- Repeats against a second fixture origin and asserts both appear together (accumulation across navigations — the actual cross-tab, cross-origin behavior that a unit test mocking `chrome.storage.session` can't fully exercise).
- Does **not** attempt to test service-worker idle-kill timing in Playwright — that's a real MV3 lifecycle event Playwright doesn't reliably control; the storage-survives-restart property is instead covered by the manual checklist item above and by the unit test's direct exercise of the `chrome.storage.session` read/write path (persistence-by-construction, verified at the unit level; the *browser actually restarting the worker* is verified manually).

---

## Summary of what this document deliberately excludes

No vault, no encryption, no key derivation (Phase 2). No field semantic classification, required/optional trust heuristics, or Identity Firewall interception (Phase 3). No Policy Engine, sensitivity categories, or Privacy Ledger (Phase 4). No WebAuthn interception or MAIN-world content script (never, per [ADR-011](../adr/ADR-011-webauthn-metadata-only-mode.md) and §3 above). No dynamic-DOM/SPA re-render detection (Phase 6). The only "state" Phase 1 introduces is a single `origin → {formCount, lastDetectedAt}` map in `chrome.storage.session` — everything else in this document is router/module scaffolding designed to make those later additions purely additive.
