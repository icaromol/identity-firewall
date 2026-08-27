# Roadmap

## A note on the numbers below

The week numbers in this document are the original brainstorm's own rough planning estimates for **solo, part-time development** — not a committed schedule, not a sprint plan, and not a deadline anyone is accountable to. There is no team, no funding, and no external pressure driving dates on this project. Treat every "Weeks N–M" heading as an ordering and a rough sense of relative size, not a promise. Phases can be reordered, merged, skipped, or take far longer or shorter than shown here; what matters is the sequence of dependencies (e.g. you need Phase 2's vault before Phase 3's firewall has anything to sit on top of), not the calendar.

---

## Macro roadmap

| Phase | Weeks | Duration |
|---|---:|---:|
| 0. Architecture & technical research | 1–2 | 2 weeks |
| 1. Extension foundation | 3–4 | 2 weeks |
| 2. Local Identity Vault | 5–7 | 3 weeks |
| 3. Identity Firewall | 8–11 | 4 weeks |
| 4. Privacy Ledger + Policy Engine | 12–14 | 3 weeks |
| 5. Biometric Authorization | 15–17 | 3 weeks |
| 6. Legacy Web Compatibility | 18–20 | 3 weeks |
| 7. MVP for personal use | 21–22 | 2 weeks |
| 8. Open Source Release | 23–24 | 2 weeks |
| 9. Private Identity Protocol | 25–29 | 5 weeks |
| 10. Selective Disclosure | 30–33 | 4 weeks |
| 11. Experimental SDK | 34–38 | 5 weeks |
| 12. Biometric Cryptography R&D | 39–44 | 6 weeks |

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

## Phase 1 — Extension Foundation

**Weeks 3–4**

### Objectives

- Create the MV3 extension.
- WXT + TypeScript + Vue + Tailwind.
- Popup/UI shell.
- Background service.
- Communication between content script, background, and UI.
- Local storage wiring.

### Deliverable

An extension installed in the browser, able to detect sites and hold local state.

**Detailed execution plan:** [`plans/phase-1-extension-foundation.md`](plans/phase-1-extension-foundation.md) — milestones, exact tooling/versions, message-passing design, directory tree, and acceptance checklist, grounded in dedicated research (`research/phase-1-tooling-scaffold.md`, `research/phase-1-runtime-architecture.md`).

---

## Phase 2 — Local Identity Vault

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

---

## Phase 3 — Identity Firewall

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

---

## Phase 4 — Privacy Ledger + Policy Engine

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

---

## Phase 5 — Biometric Authorization

**Weeks 15–17**

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

Biometrics authorize the release of sensitive data without the biometric data itself ever being sent to the site. See `docs/biometric-model.md` for the full design and the Model A vs. Model B distinction (Model A — unlock-only — ships in this phase; Model B is Phase 12).

---

## Phase 6 — Legacy Web Compatibility

**Weeks 18–20**

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

A product that works on sites with no native integration whatsoever — i.e., essentially the entire web as it exists today. See `docs/interoperability.md` for the legacy-mode/native-mode distinction this phase implements.

---

## Phase 7 — MVP for Personal Use

**Weeks 21–22**

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

## Phase 8 — Open Source Release

**Weeks 23–24**

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

## Phase 9 — Private Identity Protocol

**Weeks 25–29**

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

## Phase 10 — Selective Disclosure

**Weeks 30–33**

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

## Phase 11 — Experimental SDK

**Weeks 34–38**

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

## Phase 12 — Biometric Cryptography R&D

**Weeks 39–44**

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

- [ ] Browser extension
- [ ] Local encrypted vault
- [ ] Root identity
- [ ] Service identities
- [ ] Unique credentials
- [ ] Form detection
- [ ] Field classification
- [ ] Required/optional detection
- [ ] Optional fields blocked by default
- [ ] User approval
- [ ] Real data
- [ ] Alias data
- [ ] Synthetic data
- [ ] Denial
- [ ] Sensitive-data classification
- [ ] Local biometric authorization
- [ ] Privacy Ledger
- [ ] Policy Engine
- [ ] Government/financial sensitive-site protection
- [ ] Backup/recovery
- [ ] No proprietary server dependency
- [ ] Open-source code
- [ ] Public threat model
- [ ] Explicit privacy limitations

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

- **Functional personal MVP:** ~22 weeks
- **First open source release:** ~24 weeks
- **Identity protocol:** ~29 weeks
- **Experimental SDK:** ~38 weeks
- **Advanced biometric research:** ~44 weeks

*Estimate for solo development at part-time pace, prioritizing security, technical study, and testing over speed.*
