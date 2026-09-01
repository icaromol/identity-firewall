# Roadmap

## A note on the numbers below

The week numbers in this document are the original brainstorm's own rough planning estimates for **solo, part-time development** — not a committed schedule, not a sprint plan, and not a deadline anyone is accountable to. There is no team, no funding, and no external pressure driving dates on this project. Treat every "Weeks N–M" heading as an ordering and a rough sense of relative size, not a promise. Phases can be reordered, merged, skipped, or take far longer or shorter than shown here; what matters is the sequence of dependencies (e.g. you need Phase 2's vault before Phase 3's firewall has anything to sit on top of), not the calendar.

**On phase numbers in older docs:** this roadmap was restructured after Phase 4 to insert Phase 5 (Vault Completion), Phase 6 (Extension Dashboard), and Phase 8 (In-Page Autofill & Auto-Login); what used to be Phases 5–12 are now Phases 7 and 9–15. Docs, ADRs, and plans written *before* that restructuring (e.g. `ADR-005`, `ADR-008`, `ADR-015`, the Phase 1–4 plan docs, the `docs/changelog/` recaps) may still say "Phase 5" meaning biometric authorization, or "Phase 6" meaning Legacy Web Compatibility, under the old numbering — they were correct when written and are left as historical record, not rewritten. **This document's own phase numbers are always the current, authoritative ones**; if an older doc's phase reference and this one ever disagree, this one wins.

---

## Macro roadmap

| Phase | Weeks | Duration |
|---|---:|---:|
| 0. Architecture & technical research | 1–2 | 2 weeks |
| 1. Extension foundation | 3–4 | 2 weeks |
| 2. Local Identity Vault | 5–7 | 3 weeks |
| 3. Identity Firewall | 8–11 | 4 weeks |
| 4. Privacy Ledger + Policy Engine | 12–14 | 3 weeks |
| 5. Vault Completion | 15–16 | 2 weeks |
| 6. Extension Dashboard | 17–18 | 2 weeks |
| 7. Biometric Authorization | 19–21 | 3 weeks |
| 8. In-Page Autofill & Auto-Login | 22–23 | 2 weeks |
| 9. Legacy Web Compatibility | 24–26 | 3 weeks |
| 10. MVP for personal use | 27–28 | 2 weeks |
| 11. Open Source Release | 29–30 | 2 weeks |
| 12. Private Identity Protocol | 31–35 | 5 weeks |
| 13. Selective Disclosure | 36–39 | 4 weeks |
| 14. Experimental SDK | 40–44 | 5 weeks |
| 15. Biometric Cryptography R&D | 45–50 | 6 weeks |

---

## Phase 0 — Architecture & Technical Research

**Weeks 1–2**

The goal of this phase is to turn the product idea into a technically defensible architecture *before* writing product code. No product code needs to exist by the end of it — what needs to exist is a specification precise enough that every implementation decision in later phases can be justified against the threat model and the project's principles.

### Objectives

- Study Attestto, SimpleLogin, addy.io, AltMe, WebAuthn, and biometric-cryptography research projects (see `docs/competitive-landscape.md`).
- Define the threat model (`docs/threat-model.md`).
- Define the identity model (`docs/identity-model.md`).
- Define security boundaries.
- Decide, per component, whether to reuse, integrate, or build from scratch.
- Define the vault's data model (`docs/data-model.md`).
- Define the product's privacy policy/principles (`docs/privacy-model.md`).

### Deliverables

- Architecture document (`docs/architecture.md`).
- Threat model (`docs/threat-model.md`).
- Data model (`docs/data-model.md`).
- Authentication/authorization flows.
- Chosen stack (`docs/browser-architecture.md`).
- External dependencies.
- MVP security criteria.
- The following doc set and ADR set, in full:
  ```text
  /docs
  ├── architecture.md
  ├── threat-model.md
  ├── identity-model.md
  ├── data-model.md
  ├── privacy-model.md
  ├── security-model.md
  ├── biometric-model.md
  ├── browser-architecture.md
  ├── interoperability.md
  └── roadmap.md

  /docs/adr
  ├── ADR-001-local-first.md
  ├── ADR-002-browser-extension.md
  ├── ADR-003-web-crypto-not-custom.md
  ├── ADR-004-service-identities-pairwise.md
  ├── ADR-005-biometric-as-unlock-not-secret.md
  ├── ADR-006-no-blockchain.md
  ├── ADR-007-no-server-dependency.md
  ├── ADR-008-defer-did-vc-sdk.md
  └── ADR-009-personal-oss-project-not-startup.md
  ```

### Gate to start Phase 1

Only move on once it's possible to draw, without ambiguity, the full path a piece of data takes:

```text
User
 ↓
Biometrics
 ↓
Local Vault
 ↓
Root Identity
 ↓
Service Identity
 ↓
Identity Firewall
 ↓
Policy Engine
 ↓
Site
```

and explain what happens to each piece of data at each step.

---

## Phase 1 — Extension Foundation ✅ Complete

**Weeks 3–4** (actual: 6 milestones, M1–M7, all implemented/tested/committed/manually verified — see the plan doc's per-milestone "Implementation (as built)" sections for exactly what each one built, deviated from, and fixed via code review)

### Objectives

- Create the MV3 extension.
- WXT + TypeScript + Vue + Tailwind.
- Popup/UI shell.
- Background service.
- Communication between content script, background, and UI.
- Local storage wiring.

### Deliverable — achieved

An extension installed in the browser, able to detect sites and hold local state. Manually
verified in real Chrome, including the property that matters most for this phase's design
(session state survives a real, deliberately-forced MV3 service-worker restart — not just
in-memory), plus an automated Playwright end-to-end test covering the same core flow.
Firefox was confirmed to build cleanly but was not manually verified in a real Firefox
profile (see M7's "Results" section for why).

**Detailed execution plan:** [`plans/phase-1-extension-foundation.md`](plans/phase-1-extension-foundation.md) — milestones, exact tooling/versions, message-passing design, directory tree, and acceptance checklist, grounded in dedicated research (`research/phase-1-tooling-scaffold.md`, `research/phase-1-runtime-architecture.md`). Each milestone's own "Implementation (as built)" subsection documents real deviations discovered along the way — notably: `browser` (from `wxt/browser`), not `chrome`, is the actual API convention throughout; `content/` and `stores/` are new top-level directories (siblings of `entrypoints/`, `background/`, `shared/`), not nested inside `entrypoints/`; `jsdom` and `@playwright/test` were added as the testing gaps that materialized; and Biome + Husky were added for linting/formatting and a pre-commit `pnpm check` gate, beyond this phase's original scope.

---

## Phase 2 — Local Identity Vault ✅ Complete

**Weeks 5–7**

### Objectives

- Encrypted local vault.
- Key management.
- Root identity.
- Per-service/per-origin identities.
- Credentials.
- Personal data storage.
- Lock/unlock.
- Secure export.
- Local backup.

### Deliverable

```text
Root Identity
    ↓
Service Identity
    ↓
Credentials
    ↓
Encrypted Local Vault
```

No proprietary server involved.

**Detailed execution plan:** [`plans/phase-2-local-identity-vault.md`](plans/phase-2-local-identity-vault.md) — milestones M1–M9, the three-key hierarchy (VaultUnlockKey / RootSecret / BackupExportKey), the WebAuthn-PRF-plus-passphrase-fallback unlock decision, the Ed25519-over-ECDSA correction to ADR-010, and a "Gate to start Phase 3" checklist grounded directly in `threat-model.md`'s security-review questions. The storage layout was later retrofitted to a three-tier split — see [`plans/phase-2-vault-tiering-refactor.md`](plans/phase-2-vault-tiering-refactor.md) and [ADR-015](adr/ADR-015-three-tier-vault-storage.md).

---

## Phase 3 — Identity Firewall ✅ Complete

**Weeks 8–11**

### Objectives

- Detect forms.
- Detect fields.
- Classify data types.
- Identify apparently required vs. optional fields.
- Approval interface.
- Block optional fields by default.
- Support: approve all, approve individually, deny, use alias, use a synthetic value when appropriate.

### Deliverable

The first working version of the **Identity Firewall**:

```text
Site
 ↓
Detects requested data
 ↓
Classifies it
 ↓
Applies policies
 ↓
User authorizes
 ↓
Data is sent
```

**Detailed execution plan:** [`plans/phase-3-identity-firewall.md`](plans/phase-3-identity-firewall.md) — milestones M1–M6: the Field Classifier, the response-availability matrix, the approval UI, and real autofill via a native DOM property setter. Two honest, deliberately-undated real-world limitations were found during manual verification and carried forward rather than patched under pressure: a full-SPA signup form (Figma) is never detected at all, and a multi-step wizard form (SignupGenius) can silently fill a hidden step — both are Phase 6 (now **Phase 9**, Legacy Web Compatibility)'s "detection of dynamically rendered pages" territory.

---

## Phase 4 — Privacy Ledger + Policy Engine ✅ Complete

**Weeks 12–14**

### Objectives

- Record requests.
- Record disclosed data.
- Record denied data.
- Per-site history.
- Automatic policies.
- Sensitivity categories.
- Exceptions for government/financial services.
- "What does this site know about me?" interface.

### Deliverable

Every service has a local history of its relationship with the user's identity.

**Detailed execution plan:** [`plans/phase-4-privacy-ledger-policy-engine.md`](plans/phase-4-privacy-ledger-policy-engine.md) — milestones M1–M7: the Policy Engine's four-source resolution order (safe mode → origin rule → global rule → baseline, with two safety clamps), silent auto-fill once every field on a form resolves to a decision, government/financial safe mode, and the per-origin "what does this site know about me?" view (killer feature 7.1 from `product-vision.md`, delivered here only for the active tab — extended to every site in **Phase 6**, the Dashboard).

---

## Phase 5 — Vault Completion ✅ Complete

**Weeks 15–16**

A gap surfaced while reviewing the codebase against its own design docs: `GET_PERSONAL_DATA`/`SET_PERSONAL_DATA` and `GET_CREDENTIAL`/`SAVE_CREDENTIAL`/`DELETE_CREDENTIAL` have all existed as fully working messages and storage since Phase 2 M6 — but no popup screen was ever built to use any of them. That means the **"Real" response type, the most basic of the five this product offers, has never actually been reachable by a real user** — every manual verification pass so far exercised it via raw `chrome.runtime.sendMessage` calls in a devtools console, not through the UI a real person would use. This phase closes that gap, plus finishes the credentials side of the vault (which today stores password/passkey records but has no generator, no capture flow, and no UI at all) — deliberately **without** touching external email-alias providers (that's Phase 9) or biometrics (that's Phase 7).

### Objectives

- A popup screen to view and edit the user's own real `PersonalData` (name, email, phone, address, birth date, national ID) — the prerequisite for "Real" ever actually working.
- A local password generator (Web Crypto RNG only, ~20 characters).
- Recognize login (`type="password"`) forms as their own case, distinct from the six `PersonalData` field types, including telling a signup form apart from a login form (`autocomplete="new-password"` vs. `"current-password"` as the primary signal, a second/confirm-password field as a fallback, field count/URL only as a last resort).
- Capture a typed login on submit and offer to save it, using the **simplest mechanism available**: the same toolbar-badge + "pending items" popup pattern Phase 4 already built — no new browser permission, no notification API. (A native OS notification was considered and explicitly deferred — see below.)
- A popup list of saved credentials for the current site, with a fill action — plain, unmasked. (A masked/obscured preview with configurable reveal levels was considered and explicitly deferred to Phase 8, once there's an in-page surface to show it on.)
- Fix `background/firewall/syntheticGenerator.ts`'s fake values being different every time the same field on the same site is filled — derive them deterministically per origin (reusing the HKDF pattern [ADR-010](adr/ADR-010-identity-derivation-function.md) already established for Service Identities), so the existing claim in `product-vision.md` that a fabricated value is "useful for detecting who leaked your data" is actually true.

### Explicitly out of scope for this phase

- Revoking/deleting a Service Identity (killer feature 7.2) — deferred to **Phase 6**, the Dashboard, where it sits naturally alongside the rest of the per-site management UI.
- Any in-page UI (a hover icon drawn onto the actual page, masked-value previews, auto-login) — deferred to **Phase 8**.
- Any external email-alias provider integration — that's **Phase 9**.

### Deliverable

```text
PersonalData ─┐
Credentials  ─┼─→ Popup UI ─→ Real response type actually works
Passwords    ─┘
```

**Detailed execution plan:** [`plans/phase-5-vault-completion.md`](plans/phase-5-vault-completion.md) — milestones M1–M7. Manual verification surfaced a third real-world dynamically-rendered-page case (a Clerk-based third-party login widget defeating Fill's snapshot-based form lookup, on top of Phase 4's Figma/SignupGenius cases) — carried forward to Phase 9 alongside the other two, not patched here.

---

## Phase 6 — Extension Dashboard

**Weeks 17–18**

Three of the four "killer features" `product-vision.md` §7 describes have never made it into this roadmap's actual phase objectives — only 7.1 has any presence here at all (delivered partially, scoped to the active tab, in Phase 4 M5). This phase gives the product its first surface beyond the popup — a full page, opened in a new tab — and uses it to deliver the other three, plus extend the first one to every site the vault knows about, not just whichever tab happens to be active.

### Objectives

- A new-tab extension page (a new WXT entrypoint, the first UI surface in this project that isn't the popup) listing every origin the vault has a Service Identity for.
- **"Who knows what about me?" (7.1), extended**: per-site view of exactly what was disclosed and what was denied, for every site at once — not just the active tab.
- **"Delete my identity" (7.2)**: a Revoke action per site, invalidating that origin's Service Identity in one step — deliberately framed as ending a relationship, not as "change your password."
- **Privacy Score (7.3)**: an aggregate view across the whole vault (security/privacy/exposure/reused-credentials/trackability), computed from data the Policy Engine and Privacy Ledger already record.
- **Disclosure-reduction metric (7.4)**: a concrete before/after count of fields disclosed with vs. without the system in place.
- Relocate the export/backup UI (already built in Phase 2 M7, currently living inside the popup) onto this page's own menu, where there's room for it.

### Deliverable

A single page answering, across every site at once, the question `product-vision.md` opens with: who asked, what did they ask for, what did I hand over, and what did that actually save me.

**Detailed execution plan:** to be written as `docs/plans/phase-6-extension-dashboard.md` before implementation starts, following this project's standing convention.

---

## Phase 7 — Biometric Authorization

**Weeks 19–21**

### Objectives

- Integrate the device/OS's native biometric authentication.
- Use biometrics to authorize sensitive operations.
- Keep biometrics, identity, cryptographic keys, and personal data strictly separate.
- Define authorization levels.

### Levels

```text
Level 0 — Public data
Level 1 — Private data
Level 2 — Sensitive data
Level 3 — Highly sensitive data
```

### Deliverable

Biometrics authorize the release of sensitive data without the biometric data itself ever being sent to the site. See `docs/biometric-model.md` for the full design and the Model A vs. Model B distinction (Model A — unlock-only — ships in this phase; Model B is Phase 15).

---

## Phase 8 — In-Page Autofill & Auto-Login

**Weeks 22–23**

Everything built through Phase 5 is triggered from the popup — the extension has never, at any point, drawn anything onto the actual page a user is looking at. This phase adds that surface, and uses it for the interaction originally proposed as part of Phase 5's scope but deliberately split out: an icon on the form field itself, not a click into the extension icon.

### Objectives

- A hover icon drawn directly onto a recognized form field.
- Click-to-fill from that icon: if saved data exists for the site, offer to fill it; if not, offer nothing (a login field with no saved data is a signup, not a login — Phase 5's own detection heuristic).
- A masked preview of the value before it's filled (e.g. `j•••@g•••.com`), with **3 user-configurable masking levels** — deferred here from Phase 5 specifically because it needs an in-page surface to render on.
- Auto-login when the vault is already unlocked; otherwise require the device's own biometric/Windows Hello prompt first — this is the reason this phase must come after Phase 7, not before it.
- Revisit, if still wanted, the native-OS-notification save-prompt path Phase 5 deliberately cut in favor of its simpler badge+popup mechanism.

### Deliverable

The first version of the product where using it doesn't require opening the extension's own popup at all.

**Detailed execution plan:** to be written as `docs/plans/phase-8-in-page-autofill.md` before implementation starts.

---

## Phase 9 — Legacy Web Compatibility

**Weeks 24–26**

### Objectives

- Traditional login.
- Traditional signup.
- Controlled autofill.
- Unique password per service.
- Email aliases.
- Optional integration with an email-alias provider — **SimpleLogin first** (its single-call random-alias endpoint and native `hostname` tagging field are the simplest fit for this flow), addy.io as a fast-follow via the same `AliasProvider` interface. See `docs/research/email-alias-integration.md`.
- Compatibility across different form structures.
- Detection of dynamically rendered pages.

### Deliverable

A product that works on sites with no native integration whatsoever — i.e., essentially the entire web as it exists today. See `docs/interoperability.md` for the legacy-mode/native-mode distinction this phase implements. This is also where the Alias response type becomes genuinely deliverable end-to-end for the first time — Phase 5 only fixes the *local* Synthetic generator's determinism; it never mints a real, receivable address, which needs this phase's actual provider integration.

---

## Phase 10 — MVP for Personal Use

**Weeks 27–28**

### Objective

Use the product daily.

### Test against

- 10–20 real sites.
- Signups.
- Logins.
- Complex forms.
- Optional fields.
- Sensitive data.
- Government sites.
- Recovery.
- Backup.
- Extension failures.
- Updates.

### Completion criterion

The product must be **useful for personal use without requiring trust in any external server.**

---

## Phase 11 — Open Source Release

**Weeks 29–30**

### Objectives

- Clean up the code.
- Documentation.
- Public threat model.
- Architecture documentation.
- Documentation of limitations.
- Automated tests.
- Reproducible build.
- Publish the code.
- License.
- Installation guide.

### Non-negotiable principle

**Do not promise anonymity.** The product must explicitly state that it does not, by itself, protect:

- IP address
- browser/device fingerprinting
- cookies
- DNS
- network traffic
- device security

---

## Phase 12 — Private Identity Protocol

**Weeks 31–35**

### Objective

Build the project's own native authentication protocol.

```text
Site
 ↓
Request Authentication
 ↓
Extension
 ↓
Local Identity
 ↓
Biometric Authorization
 ↓
Cryptographic Signature
 ↓
Site verifies
```

The site never receives the password, the biometric data, the root identity, or unnecessary personal data. See `docs/interoperability.md` for the full sketch of this login ceremony.

---

## Phase 13 — Selective Disclosure

**Weeks 36–39**

### Objectives

- Study SD-JWT.
- Integrate selective disclosure.
- Define claims.
- Define scopes.
- Support proofs of specific attributes.
- Prepare for future compatibility with Verifiable Credentials.

### Example

```text
Credential
 ├── name
 ├── age
 ├── national ID
 └── email

Site requests:
age_over_18

Result:
✓ proof of majority
✕ birth date not revealed
✕ national ID not revealed
```

See `docs/interoperability.md` for the full SD-JWT plan.

---

## Phase 14 — Experimental SDK

**Weeks 40–44**

### Objective

Build an SDK for sites that want native integration.

### Conceptual API

```javascript
Identity.authenticate()

Identity.request({
  claims: ["email"]
})

Identity.request({
  claims: ["age_over_18"]
})
```

### Deliverable

A demonstration site capable of: signing up, requesting attributes, authenticating, requesting selective disclosure, and receiving cryptographic proofs — end to end.

---

## Phase 15 — Biometric Cryptography R&D

**Weeks 45–50**

### Objective

Investigate biometrics as a cryptographic source/authority, not just an unlock mechanism.

### Research areas

- Fuzzy extractors.
- Secure sketches.
- Biometric cryptosystems.
- Cancelable biometrics.
- Template protection.
- Face embeddings.
- Fingerprint representations.
- Secure enclave.
- Hardware-backed keys.
- Reconstruction attacks.
- Template attacks.
- False acceptance rate.
- False rejection rate.

### Outcome

Decide between:

```text
A) biometrics as local unlock only
```

or

```text
B) a custom biometric cryptographic mechanism
```

Model B must not be assumed safer than Model A by default — that needs to be demonstrated by this phase's research, not assumed going in. See `docs/biometric-model.md` (sibling doc) for the full Model A vs. Model B design and reasoning.

---

## MVP — Final scope

- [x] Browser extension
- [x] Local encrypted vault
- [x] Root identity
- [x] Service identities
- [x] Unique credentials (generator, capture, save, and plain fill all reachable via the popup as of Phase 5 — fill has a known gap on dynamically-rendered login forms, see Phase 5's own plan)
- [x] Form detection
- [x] Field classification
- [x] Required/optional detection
- [x] Optional fields blocked by default
- [x] User approval
- [x] Real data (reachable via the popup's Personal Data screen as of Phase 5)
- [ ] Alias data (Synthetic is now locally deterministic per site as of Phase 5; a real deliverable Alias address still needs Phase 9's provider integration)
- [x] Synthetic data
- [x] Denial
- [x] Sensitive-data classification
- [ ] Local biometric authorization (Phase 7)
- [x] Privacy Ledger
- [x] Policy Engine
- [x] Government/financial sensitive-site protection
- [x] Backup/recovery
- [x] No proprietary server dependency
- [ ] Open-source code (Phase 11)
- [ ] Public threat model (Phase 11)
- [x] Explicit privacy limitations

## Out of MVP

- Blockchain.
- Cryptocurrency/token.
- VPN.
- Tor.
- Private DNS.
- Custom browser.
- Email server.
- DID infrastructure.
- Full Verifiable Credential ecosystem.
- Custom biometric cryptography.
- Cloud synchronization.
- Proprietary identity server.
- Mandatory SDK.

---

## Strategic sequence

```text
CURRENT INTERNET
      │
      ▼
Identity Firewall
      │
      ▼
Local Identity Vault
      │
      ▼
Biometric Authorization
      │
      ▼
Private Identity
      │
      ▼
Selective Disclosure
      │
      ▼
Private Login Protocol
      │
      ▼
SDK
      │
      ▼
ECOSYSTEM
```

## Horizon

These, again, are the source brainstorm's own rough estimates for solo, part-time development — not commitments:

- **Functional personal MVP:** ~28 weeks
- **First open source release:** ~30 weeks
- **Identity protocol:** ~35 weeks
- **Experimental SDK:** ~44 weeks
- **Advanced biometric research:** ~50 weeks

*Estimate for solo development at part-time pace, prioritizing security, technical study, and testing over speed.*
