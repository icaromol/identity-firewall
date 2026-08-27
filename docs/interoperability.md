# Interoperability

This document covers how the project relates to the rest of the web: how it works on sites that have never heard of it, how that evolves as sites (optionally) adopt a native protocol, and why several tempting pieces of infrastructure (DID/VC, blockchain) are deliberately kept out of the design for now. For the extension's internal component layering, see `docs/browser-architecture.md`; for the reference projects behind the decisions below, see `docs/competitive-landscape.md`.

## Two modes

The project is designed around a hard split between two operating modes, so that the product is useful immediately and improves later rather than depending on a future that may never arrive.

### Legacy mode (today, ~100% of the web)

Legacy mode requires *zero* cooperation from the site. The extension detects the site's ordinary signup/login form, classifies its fields, and fills in a generated identity: an email alias, a per-service username, a random password, or — where supported — a passkey.

```text
Browser Extension
       ↓
detects form
       ↓
generates identity/alias
       ↓
fills it in
       ↓
saves the credential locally
```

From the site's point of view, this looks like an ordinary account. The site never needs to know this system exists. This is what makes the product usable on day one, on the web as it actually exists, rather than only on a hypothetical future web that has adopted a new standard.

### Native mode (future, opt-in per site)

Sites that choose to adopt the project's future Private Identity SDK get a fundamentally more capable relationship with the vault:

```text
Website
   ↓
Private Identity Protocol
   ↓
Vault
   ↓
Cryptographic proof
```

Native mode unlocks things legacy mode structurally cannot do:

- selective disclosure of individual attributes
- passwordless authentication
- pairwise identity (a distinct identity per site, verified cryptographically rather than by convention)
- attribute verification (e.g. proof of age) without handing over the underlying data
- revocation

## The four-phase evolution

The source brainstorm frames this as a four-phase progression, and the key point is the one at the end: **the user never has to wait for the internet to change.** Each phase delivers standalone value; later phases are additive, not prerequisites for the earlier ones being useful.

```text
Phase 1
Password + email
        ↓
Our extension protects it

Phase 2
Passkeys
        ↓
Our identity layer protects it

Phase 3
Private Identity SDK
        ↓
Sites understand our identity

Phase 4
Selective Disclosure
        ↓
Sites receive only what's necessary
```

- **Phase 1** — the site still only knows "email + password." The extension's value is entirely in isolation and generation: a different alias and password per site, so a breach on one site doesn't cascade to others.
- **Phase 2** — passkeys replace the password as the authentication mechanism, but the identity layer (which site gets which identity, what data is disclosed) is still ours to manage.
- **Phase 3** — sites that adopt the SDK get a real protocol relationship with the vault instead of a form-filling relationship.
- **Phase 4** — the protocol is expressive enough that sites can ask for a specific claim (e.g. "is this person over 18") and get a proof, not the underlying personal data.

This progression is why the roadmap (`docs/roadmap.md`) treats Phases 9–11 as later, optional extensions rather than MVP requirements: the MVP is fully useful while sitting entirely in Phase 1 of this evolution.

## Selective disclosure: adopt SD-JWT, don't invent a scheme

Selective disclosure is a solved problem at the protocol level — SD-JWT (Selective Disclosure JWT) already lets an issuer produce a credential where the holder can disclose a subset of its claims to a verifier, with the verifier able to check the disclosed claims are part of the original signed credential without seeing anything else. There is no reason to invent an equivalent from scratch.

Example, straight from the brainstorm: a credential holds `name`, `age`, `national ID`, and `email`. A site asks for `age_over_18`:

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
✕ name/email not revealed
```

For the MVP, the data model should be *structured* so SD-JWT can slot in later (claims as discrete, independently-disclosable fields) even before the disclosure mechanism itself is implemented — see `docs/data-model.md` for the current shape of that structure. The actual SD-JWT integration is Phase 10 of the roadmap.

## Deliberately deferred: DID / VC infrastructure

The MVP explicitly does **not** build:

- DID methods
- DID resolution
- DID documents or registries
- issuer/verifier protocols
- a full W3C Verifiable Credentials stack

This is a scope decision, not a rejection of the concepts. AltMe (studied as a reference project — see `docs/competitive-landscape.md`) demonstrates why: it's a large project precisely because it takes on the full SSI/EUDI/VC ecosystem (DID methods, OpenID4VCI, OpenID4VP, issuer/holder/verifier roles, registries). None of that complexity is required to deliver the project's core value.

For the MVP, the following is sufficient:

```text
local identity key
+
service identity
+
signature
```

That combination already gets isolation, non-correlation between services, and cryptographic proof of authorization. DID/VC infrastructure is revisited later **only if** a concrete need for interoperability with the broader SSI ecosystem actually appears — it is not built speculatively.

## The eventual Private Login Protocol

Once the project has its own native protocol (Phase 9), the login ceremony is designed to look like this:

```text
Site
 ↓
"Authenticate" request
 ↓
Extension shows a confirmation prompt
   naming the site and the specific
   service identity being used
 ↓
User confirms
 ↓
Site receives a cryptographic
   signature / proof
```

Concretely:

```text
example.com

[✓] Authenticate as identity-9281?

          👆
```

The site never receives the password, the biometric data, or the root identity — only a cryptographic proof tied to the specific service identity it's talking to. This is the same "authentication vs. identity" separation used throughout the project: the site learns "this is the same authorized person as before," not "this is [full name]."

## The experimental SDK

Once the protocol exists, the SDK is meant to be a thin, ergonomic wrapper over it — not new capability of its own:

```javascript
Identity.authenticate()

Identity.request({
  claims: ["email"]
})

Identity.request({
  claims: ["age_over_18"]
})
```

The roadmap's Phase 11 deliverable is a demo site that proves the whole loop end to end: signup, attribute request, authentication, and selective disclosure, all through this API. Until that demo exists and works, the SDK should be treated as a sketch, not a commitment to a specific shape.

## Why blockchain isn't in the core

This overlaps with `docs/adr/ADR-006-no-blockchain.md`, which states the decision; this section carries the fuller reasoning.

A blockchain earns its place in an architecture when something genuinely requires one of:

- **public registration** of identities/keys
- **verifiable revocation** that anyone can check without trusting a central party
- **proof of existence / timestamping**
- **portability across devices without a central authority**
- **reputation/attestation without a central server**
- **coordination between mutually untrusted nodes**

None of these are requirements of the MVP, and — more importantly — a public ledger actively cuts against this project's actual goal. The whole point of the design is to *minimize* what any party can learn and correlate about the user. A blockchain, by construction, creates a permanent, public record of activity and metadata. For a project whose thesis is privacy + isolation + self-hosting, adding a public ledger can make things worse, not better, even if it superficially sounds "more decentralized."

The approach instead: investigate a **P2P + cryptographic signatures + local storage** architecture first (i.e., what the MVP already is), and only reconsider a chain if a specific, concrete need is found that this combination genuinely cannot satisfy — for example, verifiable public revocation that must survive the original author disappearing. Absent that proven need, no blockchain.
