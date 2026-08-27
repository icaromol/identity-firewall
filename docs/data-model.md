# Data Model

This document defines what data the vault holds, how each field is classified by sensitivity, and what a site can actually get back when it asks for a field. For how identities are derived and isolated, see [identity-model.md](identity-model.md); for the overall system this sits inside, see [architecture.md](architecture.md).

## The vault's data tree

Conceptually, everything the system stores lives in one encrypted tree:

```text
Vault
├── RootIdentity
├── PersonalData (Name, Email, Phone, CPF/national ID, Address, BirthDate)
├── ServiceIdentities (one entry per origin, e.g. github.com, reddit.com, discord.com)
├── Credentials
├── Aliases
├── AliasProviderConfig (optional — see below)
├── Policies
└── PrivacyLedger
```

- **RootIdentity** — the single root key and derivation material described in [identity-model.md](identity-model.md). Never leaves the vault.
- **PersonalData** — the user's actual attributes (name, email, phone, CPF/national ID, address, birth date). This is the pool that gets selectively, explicitly disclosed — never handed over wholesale.
- **ServiceIdentities** — one entry per origin. Each holds the identifier, credentials, aliases, passkeys, and history for that specific site, as defined in [identity-model.md](identity-model.md).
- **Credentials** — passwords and passkeys, scoped per service identity.
- **Aliases** — generated substitute values (email aliases, usernames, etc.) used in place of real personal data where appropriate. An email alias entry round-trips the fields a real alias provider actually needs: `provider` (e.g. `simplelogin`, `addy`, or `none`), `providerAliasId` (the provider's own ID, needed to later toggle/delete it), `value` (the alias address itself), and `note`/`hostname` (the site it was minted for — SimpleLogin has a native `hostname` field for exactly this; addy.io does not, so we own that tagging convention ourselves via its `description` field). See `docs/research/email-alias-integration.md` for the full provider comparison.
- **AliasProviderConfig** — optional, user-supplied configuration for an email-alias provider: `provider` (`none` by default), the user's own API key for that provider, and an optional base URL override to support a self-hosted instance. This key is never sent anywhere except directly from the user's browser to the provider endpoint the user themselves configured — see the "our server vs. the user's own chosen third party" distinction in [ADR-007](adr/ADR-007-no-server-dependency.md).
- **Policies** — the rules that decide, per field and per sensitivity level, whether to auto-allow, alias, ask, or deny. The engine that applies these lives in `docs/privacy-model.md` (sibling doc); this document only defines the data those policies act on.
- **PrivacyLedger** — a local (never blockchain) log of what each site requested, what was disclosed, what was denied, and how the disclosure was authorized. Its behavior is detailed in `docs/privacy-model.md` (sibling doc).

How each of these fields is actually encrypted at rest, and how keys are managed, is covered in `docs/security-model.md` (sibling doc) — this document is about the shape of the data, not its protection mechanism.

## Field sensitivity classification

Every attribute the vault might hold is assigned a sensitivity level, and each level has a default behavior when a site requests it:

| Level | Examples | Default behavior |
|---|---|---|
| **Public** | country, language, timezone | Allow automatically |
| **Private** | email, username | Alias, if an alias provider is configured (`AliasProviderConfig.provider != "none"`); otherwise Ask |
| **Sensitive** | full name, phone, address | Ask |
| **Highly Sensitive** | national ID/CPF, official documents, financial information | Ask + require biometric authorization |

These defaults are exactly that — defaults. The Policy Engine (`docs/privacy-model.md`, sibling doc) can override them per site or per user rule (e.g. "never share phone automatically," "shopping sites can get name + address but never CPF"), and government/financial sites are treated as a distinct high-trust category that disables automatic responses entirely regardless of field sensitivity — see `docs/threat-model.md` and `docs/privacy-model.md` (sibling docs) for that behavior.

## Response types per field

When a site requests a given field, the vault can respond in one of five ways:

| Response | Meaning | Example |
|---|---|---|
| **Real** | The actual, true value | Name → `Ícaro` |
| **Alias** | A substitute value that is valid where the site checks format/uniqueness, but not the user's real value | Email → `a8f92@alias...` |
| **Synthetic** | A plausible but fabricated value | Name → `João Silva` |
| **Nonsense** | A deliberately implausible or garbage value | Name → `Xablau 9000` |
| **Deny** | Nothing is sent | Phone → *not sent* |

**Caveat that must hold everywhere this model is applied:** synthetic and nonsense values must never be used where a real value is legally or functionally required. This specifically includes banking, government, healthcare, insurance, payments, contracts, and official-ID contexts. Feeding a fabricated CPF or name into a financial or government system is not a privacy feature — it's a way to break the user's own account or run afoul of a legal requirement. The Identity Firewall is expected to recognize these high-trust categories and disable automatic synthetic/nonsense responses for them by default (see `docs/threat-model.md`, sibling doc, for the "government/financial sites" handling).

## "Optional" is not ground truth

A site's HTML form will often mark a field as required or optional (e.g. via the `required` attribute, or visually with an asterisk). This model treats that signal as informative but **not authoritative**: a field's own backend does not always enforce what its form implies. A field marked optional in markup may still be silently required by server-side validation, and conversely.

Consequently, the classifier's job is to report a field as **"apparently optional"** rather than definitively optional, and the UI should reflect that hedge rather than presenting the form's own claim as settled fact. Optional (or apparently-optional) fields are blocked by default regardless — the user only sees a prompt when a genuine decision is needed, not for every field a site happens to render.

## Where the rest of this lives

- [identity-model.md](identity-model.md) — how ServiceIdentities are derived and kept unlinkable from each other.
- `docs/privacy-model.md` (sibling doc) — the Policy Engine that decides what to do with each field by default, and the Privacy Ledger's full behavior and UI ("what does this site know about me?").
- `docs/security-model.md` (sibling doc) — how each of these fields is encrypted and protected at rest, and how the vault's keys are managed.
