# Identity Model

This document defines what an "identity" means in Identity Firewall: how a single Root Identity produces many unlinkable Service Identities, what each of those actually holds, and where the boundaries of that isolation are honestly drawn. For where this fits in the overall system, see [architecture.md](architecture.md); for the concrete data it holds, see [data-model.md](data-model.md).

## Root Identity → Service Identity derivation

The user has exactly one **Root Identity**, created and held entirely on-device. It is **never sent to any site** — no site ever learns of its existence, let alone its value.

```text
ROOT IDENTITY
      │
      ├── Service Identity — github.com
      ├── Service Identity — reddit.com
      └── Service Identity — discord.com
```

From the Root Identity, a distinct **Service Identity** is derived per origin — conceptually:

```text
Root Identity
      ↓
derive(root, service_origin)
      ↓
Service Identity
```

e.g.:

```text
root
 ↓
derive(root, "github.com")
 ↓
GitHub identity

root
 ↓
derive(root, "reddit.com")
 ↓
Reddit identity
```

Each derived identity comes with its own identifier, credentials, aliases, and passkeys — so github.com, reddit.com, and discord.com each see a distinct, non-correlatable identity, never the same one, and never the root.

### The derivation math is intentionally not settled yet

The source design work is explicit that the exact derivation mechanism — something along the lines of an HMAC or KDF applied to the origin — **needs careful design**; this document does not claim a finalized construction. What is fixed, independent of the exact math, is the principle:

> **One identity per origin, and origins should not be able to correlate a user across sites.**

This is a deliberately different approach from Attestto's `did:jwk` pairwise-per-origin identities. Attestto is a useful reference point for how a similar problem has already been solved in a shipped, open-source extension — see `docs/competitive-landscape.md` (sibling doc) — but its DID-based construction is something to study, not something this project commits to copying wholesale. The MVP is explicitly scoped to avoid pulling in full DID infrastructure (see [architecture.md](architecture.md) and `docs/roadmap.md`), so the near-term derivation mechanism will likely be simpler than a DID method, while preserving the same per-origin unlinkability property.

## What each identity level holds

### Root Identity

Never sent to any site. Holds:

- root key
- user identity
- derivation keys
- policies
- personal data

### Service Identity

Created for one specific origin (e.g. `github.com`, `reddit.com`, `discord.com`). Holds, per origin:

- identifier
- credentials
- aliases
- passkeys
- history

The full storage structure these live in is documented in [data-model.md](data-model.md); encryption at rest is covered in `docs/security-model.md` (sibling doc).

## Many accounts, minimal disclosure

A site does not get to freely decide what data it receives just because it asks. The model inverts that default:

1. A site requests a field — e.g. "I need an email."
2. The vault asks the user to authorize that specific request.
3. If the request is for something sensitive (e.g. a national ID/CPF), the user gets an explicit warning before deciding, rather than a silent auto-fill.

This is the same mechanism described in more detail as the Identity Firewall's consent flow and the Policy Engine's default rules — see `docs/privacy-model.md` (sibling doc) for the full policy behavior and the Privacy Ledger that records what was actually disclosed per site. This document's concern is narrower: identity is the substrate those policies operate over, and that substrate is structured so that per-field consent is even possible in the first place (i.e., data is tagged by field and by service identity, not lumped into one undifferentiated profile).

## Identity isolation is not anonymity

Identity Firewall solves **identity isolation** — distinct, non-correlatable credentials and identifiers per site. It deliberately does **not** claim to solve **full anonymity**.

Even with perfectly isolated per-site identities, an attacker can still attempt to correlate a user's identities across sites through channels this model doesn't touch:

- reused email addresses (outside the alias system, or if an alias leaks)
- IP address
- browser/device fingerprinting
- behavioral patterns
- other metadata

This is a boundary that has to be communicated honestly rather than glossed over: "different login per site" is a strong, real property, but it is not the same claim as "untraceable." The full attacker-by-attacker breakdown — including this one as its own named case, "Attacker F — Correlation Attack" — lives in `docs/threat-model.md` (sibling doc); this document only asserts that the identity model's isolation guarantee and a general anonymity guarantee are two different things, and that this project targets the former.

## Biometrics unlock the identity; they are not the identity

Biometrics (fingerprint, face) play a specific, narrow role in this model: they are the **unlock mechanism** for the cryptographic identity key, never the identity itself.

```text
YOUR FACE / FINGERPRINT
    ↓
unlocks
    ↓
CRYPTOGRAPHIC IDENTITY
    ↓
signs
    ↓
"This is me / I authorize this"
```

Concretely:

- Raw biometric data is never stored as something recoverable, and never sent anywhere — not to a site, not to this project's own software as a transmittable value.
- A site that requests authentication receives a cryptographic proof, never the biometric reading, and never the root identity.
- The same underlying identity key can be gated by more than one unlock factor (face, fingerprint, PIN, trusted device), all authorizing the same identity rather than being the identity themselves.

The full design of that unlock mechanism — including the distinction between "biometrics as a local OS-level unlock gate" (the near-term approach) versus "biometrics as the source of a derived cryptographic secret via fuzzy extractors / biometric cryptosystems" (an explicitly deferred research track) — is out of scope here. See `docs/biometric-model.md` (sibling doc) for that design in full.
