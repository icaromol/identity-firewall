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

### The derivation function (finalized)

> **Decision:** `ServiceIdentityKeySeed = HKDF-SHA256(ikm = RootSecret, salt = FixedAppSalt, info = normalizeOrigin(origin))`, and the resulting seed material deterministically seeds a per-origin ECDSA/Ed25519 keypair (via the Web Crypto API, per [security-model.md](security-model.md)/ADR-003). See [ADR-010](adr/ADR-010-identity-derivation-function.md) for the full record.

This was deliberately **not** copied from Attestto. A source-level teardown (`docs/research/attestto-teardown.md`) found that Attestto's own "pairwise per-origin identity" is not a derivation at all: `generateSiteDid()` calls `crypto.subtle.generateKey()` to produce a **fresh, independently-random P-256 keypair per origin** and stores it forever in a `Record<origin, keypair>`, using the origin string purely as a storage/lookup key — never as KDF input. Attestto's own "root identity" is, for the same reason, just the first randomly-generated key, not a seed with any special mathematical relationship to the per-site ones.

That generate-and-store approach is legitimate (it has a real unlinkability advantage: no shared mathematical structure between per-site keys, even under a worst-case KDF break), but it has a cost this project's principles don't want: **it has no recovery-from-root property.** If the vault backup is lost, every per-site identity is gone and must be re-minted from scratch, breaking continuity with every site ever used, and the per-origin key map grows linearly with every site visited — all of which has to be backed up.

The derivation approach above keeps a property Attestto's design lacks: as long as the Root Identity and the origin string are known, the exact same Service Identity can be recomputed from the root alone, on a fresh device, with **no per-site backup at all** — only the root needs to survive a device loss. This is a better fit for this project's stated principles (local-first, root-holds-everything, minimal persisted state) than Attestto's own approach, which is why this project deliberately diverges from its closest reference project here rather than adopting it wholesale.

Two implementation details carried over from the teardown as hard-won lessons rather than speculation:

- **One canonical origin-normalization function, used everywhere an origin is a KDF `info` parameter or a storage key** (`protocol//host`, lowercased, punycoded, default ports stripped, non-default ports kept). Attestto's own codebase had **five independent copies** of this logic before consolidating into one branded type — worth getting right from day one rather than after the fact.
- **HKDF's output is only unlinkable as long as the Root Secret stays secret and the same origin never trivially reveals the root** — this is a standard HKDF security property, not a novel one, but it's the load-bearing assumption behind calling per-origin outputs "statistically independent."

What remains fixed, independent of any implementation detail, is the underlying principle:

> **One identity per origin, and origins should not be able to correlate a user across sites.**

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
- passkeys *(see footnote below — reference, not custody, under the MVP's WebAuthn integration mode)*
- history

The full storage structure these live in is documented in [data-model.md](data-model.md); encryption at rest is covered in `docs/security-model.md` (sibling doc).

> **Footnote on "passkeys":** under the MVP's chosen WebAuthn integration mode ([ADR-011](adr/ADR-011-webauthn-metadata-only-mode.md)), a Service Identity does not hold passkey private-key material the way it holds an alias or a password. It holds a *reference* — the relying-party ID and credential ID the user's real authenticator (OS platform authenticator, hardware key, or another password manager) already manages — for our own bookkeeping of "which Service Identity does this credential belong to." The private key itself never enters this vault; it lives in the OS/hardware authenticator, exactly as WebAuthn intends. A later phase could adopt full custody (the extension becomes its own software WebAuthn authenticator, as Bitwarden/1Password do) — see `docs/research/webauthn-technical-notes.md` and ADR-011 for why that's a materially larger, explicitly deferred scope, not the MVP's default.

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
