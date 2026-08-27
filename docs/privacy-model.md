# Privacy Model

This document describes what the Identity Firewall actually does with a site's data request: how it detects and classifies fields, what the user can choose to hand over, how that choice is remembered so the user isn't asked the same question twice, and — just as important — what this system does **not** do. It is the *what is disclosed, to whom, under what policy* companion to [security-model.md](security-model.md) (*how* it's technically secured) and [threat-model.md](threat-model.md) (*which attacker* each control answers).

The philosophy behind everything below fits in one sentence:

> **The site does not decide which data you hand over. You do.**

## The Identity Firewall consent flow

When a site asks for data — via a registration form, a login form, or (later) a native API request — the flow is:

```text
SITE
 ↓
Requests data
 ↓
Extension detects (form/field scan)
 ↓
Classifies (field type + apparent requirement)
 ↓
Policy Engine (checks standing rules)
 ↓
Identity Firewall (surfaces anything outside policy)
 ↓
User
 ↓
Authorizes / denies
 ↓
Vault
 ↓
Site
```

The Firewall detects each field a site is asking for, classifies it by type (email, name, phone, national ID, etc.) and by **apparent** requirement — "apparently required" vs. "apparently optional." The word "apparent" matters: HTML form markup does not reliably reflect what a backend actually enforces, so a field marked `optional` in the DOM is presented to the user as *apparently* optional, never as a guaranteed fact. **Fields flagged as optional are blocked/denied by default** — the user has to deliberately opt back in, rather than opt out of a wall of pre-checked fields.

### Example approval UI

A site requesting seven fields might surface like this:

```text
┌────────────────────────────────────┐
│ 🔐 example.com                     │
│                                    │
│ This site is requesting 7 fields   │
│                                    │
│ ✓ Email             private        │
│ ✓ Name              sensitive      │
│ ⚠ National ID (CPF) highly         │
│   sensitive                        │
│ ? Phone             optional       │
│ ? Birth date        optional       │
│ ? Gender            optional       │
│                                    │
│ Optional fields have been blocked. │
│                                    │
│ [Review]     [Authorize]           │
└────────────────────────────────────┘
```

A variant surfaced elsewhere in the design frames the same idea with explicit per-field actions:

```text
┌──────────────────────────────────┐
│       EXAMPLE.COM                │
│                                  │
│ Requests 7 fields                │
│                                  │
│ 🔴 National ID (CPF) required    │
│ 🟡 Name              required    │
│ 🟢 Email             required    │
│ ⚪ Phone              optional   │
│ ⚪ Birth date         optional   │
│ ⚪ Gender             optional   │
│ ⚪ Company            optional   │
│                                  │
│ [Deny optional fields]           │
│ [Review]                         │
└──────────────────────────────────┘
```

Both are expressions of the same rule: **required fields get reviewed and consciously authorized; optional fields are denied unless the user asks otherwise.** The three top-level actions available to the user are: **Approve all**, **Approve selected**, **Deny**.

## The five response types

For each field the user chooses to act on, the Firewall supports five distinct response types — not just yes/no:

### 🟢 Real

Delivers the actual value.

```text
Name → Ícaro
```

### 🟡 Alias / Random

Delivers an artificially generated value that remains **valid** wherever possible (passes the site's own format validation).

```text
Email → x82k91@alias...
```

This is particularly useful for later identifying which site leaked or sold a piece of data, since each site gets a distinct alias value.

### 🟣 Synthetic

Delivers a plausible-looking but fabricated value — something that looks like real data of the right shape, without being either the user's real value or an obviously fake one.

```text
Name → João Silva
```

### 🔴 Nonsense

Delivers a deliberately absurd, obviously-fake value.

```text
Name → Xablau 9000
```

### ⚫ Deny

Delivers nothing.

```text
Phone → NOT SENT
```

**Warning, stated explicitly in the design:** synthetic and nonsense values must be used with care. Some fields are subject to a site's own validation, and — more importantly — supplying fabricated data to a site where real information is **legally or functionally required** can cause real problems for the user. This applies especially to:

- banks;
- government services;
- healthcare;
- insurance;
- payments;
- contracts;
- official identification.

The system does not prevent the user from choosing Synthetic or Nonsense on such a site, but it must make the risk visible before they do — which is exactly what the high-trust exception below exists to do.

## The high-trust / government site exception

Certain sites are classified as **high trust / sensitive** — detected via domain, TLS certificate, community-maintained lists, or manual classification. Examples: `gov.br`, banks, the tax authority (Receita Federal).

For these sites, the system enters a **safe mode**:

> **Automatic identity fill is disabled by default.**

Rather than auto-deciding anything, the system explicitly warns the user and requires a conscious, reviewed decision every time:

> ⚠️ This site has been identified as a government/financial service. Automatic identity autofill has been disabled.

```text
⚠️ Highly sensitive service

Requesting:
National ID (CPF)
Name
Birth date

[Review and authorize]
```

The rule this encodes: the more consequential the site, the less the system should try to be clever or invisible on the user's behalf. Safe mode trades convenience for certainty exactly where a wrong or fabricated value would carry real-world legal or functional consequences.

## The Privacy Ledger

Every data-sharing event — approved, denied, or fabricated — is written to a local, append-only log: the **Privacy Ledger**. It is local, not a blockchain; there is no distributed or shared ledger involved, just a durable local record.

Each entry records:

- `timestamp`
- `origin` (the requesting site)
- `identity` (which Service Identity was used)
- `requested_fields`
- `approved_fields`
- `denied_fields`
- the **value type** given per approved field (real / alias / synthetic / nonsense)
- `authorization_method` (e.g. biometric, PIN)

### Example entry

```text
08/27/2026 — 14:31

example.com

Requested:
7 fields

Disclosed:
Email → alias
Name → real

Denied:
National ID (CPF)
Phone
Birth date

Authorization:
Fingerprint
```

A per-service view aggregates this history into a standing answer to:

> **What does this site know about me?**

```text
GITHUB

Identity:
github-7F82

Disclosed:
✓ Email
✓ Username

Denied:
✕ Name
✕ Phone
✕ Birth date

Last access:
08/27/2026
```

This turns the product from "where are my passwords?" into something considerably more useful: *"who is asking for my data, what exactly are they asking for, and what precisely did I hand over?"*

## The Policy Engine

Re-authorizing every field on every site would make the Firewall unusable. The **Policy Engine** holds user-defined default rules per field type so the user is interrupted only when a request falls **outside** their standing policy:

| Field | Classification | Default |
|---|---|---|
| Country | Public | Allow |
| Language | Public | Allow |
| Email | Private | Alias |
| Name | Sensitive | Ask |
| Phone | Sensitive | Deny |
| National ID (CPF) | Highly sensitive | Ask + biometric |
| Official document | Highly sensitive | Ask + biometric |

More example rules the design calls out directly:

```text
email → alias by default
phone → deny
CPF → always ask
name → ask
address → always ask
```

A user can also set contextual rules, e.g. *"shopping sites may receive name + address, but never CPF."* Once a policy exists for a field/site combination, the flow collapses to:

```text
Site
 ↓
Identity Firewall
 ↓
Policies
 ↓
Automatic decision — only asks what falls outside the rules
```

Field sensitivity classification itself (what makes a field Public vs. Private vs. Sensitive vs. Highly Sensitive) is owned by [data-model.md](data-model.md); the Policy Engine consumes that classification to decide default behavior.

## Sensitivity-based authorization levels

Every disclosure decision is gated by an authorization level tied to the sensitivity of the data involved (classification table itself lives in [data-model.md](data-model.md)):

| Level | Name | Authorization required | Examples |
|---|---|---|---|
| 🟢 0 | Public | None | language, country, preferences |
| 🟡 1 | Private | PIN / device | real email, phone |
| 🟠 2 | Sensitive | Biometric (fingerprint/face) | full name, CPF, address |
| 🔴 3 | Highly sensitive | Biometric + possibly another factor | official documents, financial data, official identity |

### Scoped authorization bundles

Rather than prompting for biometrics field-by-field, the design groups fields into named **scopes** the user authorizes as a bundle:

```text
Scope: identity.basic
  name
  email
  country
  language
```

```text
Scope: identity.financial
  CPF
  bank information
  address
```

`identity.basic` requires a lighter touch; `identity.financial` demands the stronger authorization appropriate to Level 2/3 data. This keeps the UX from becoming a wall of individual biometric prompts while still keeping high-sensitivity data behind a meaningfully stronger gate. See [biometric-model.md](biometric-model.md) for how the authorization ceremony itself works.

## This system does not provide anonymity

This is the single most important thing to be honest about, and it is stated here as plainly as possible:

> **Identity Firewall protects account and identity data. It does not make the user anonymous.**

Depending on the site and connection, the following remain visible regardless of anything this product does:

- IP address;
- approximate location derived from IP;
- user-agent / browser;
- operating system;
- language / timezone;
- cookies and tracking identifiers;
- browser fingerprinting;
- screen resolution;
- browsing behavior;
- DNS queries (depending on configuration);
- network-level metadata (e.g. WebRTC leaks).

In short: **Identity Privacy ≠ Network Privacy ≠ Browser Privacy.** These are different problems solved by different tools, and conflating them in how the product describes itself would be dishonest.

### The Privacy Stack

Identity Firewall is one layer in a stack, not a replacement for the other layers:

```text
                    INTERNET
                       │
              ┌────────▼────────┐
              │ Network Privacy │
              │ VPN / Tor       │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Browser Privacy │
              │ Firefox/Brave   │
              │ uBlock/etc.     │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Identity Layer  │
              │  (this project) │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Device Security │
              │ OS / encryption │
              └─────────────────┘
```

- **Network Privacy** (VPN/Tor) — hides the IP from the site (VPN shifts trust to the VPN provider; Tor gives much stronger network anonymization with speed/compatibility trade-offs).
- **Browser Privacy** (hardened browser, ad/tracker blocking) — reduces fingerprinting, trackers, and cookies.
- **Identity Layer** (this project) — identity, credentials, authorization, and data minimization per service.
- **Device Security** (OS/encryption) — protects the keys if the device itself is compromised or stolen (see [threat-model.md](threat-model.md), Attacker D).

Each layer solves a distinct problem. A direct consequence for scope: **this project must never try to also become a VPN, a browser, an antivirus, or a general-purpose Identity Provider.** The boundary is:

> We control what a site knows about your **identity**. Other tools control what it knows about your **connection** and your **device**.

### Privacy Status

Rather than implying blanket protection, the product should surface a per-site, per-layer honesty check:

```text
IDENTITY       ██████████ 100%
CREDENTIALS    ██████████ 100%
TRACKING       ███░░░░░░░  30%
NETWORK        ██░░░░░░░░  20%
DEVICE         ████████░░  80%
```

Paired with plain language such as:

> **You're using a private identity, but your IP is still visible to this site.**

This is deliberately more honest and educational than a flat "you are protected" — the goal is for the user to always know exactly which layers this product covers for a given site, and which ones it does not.
