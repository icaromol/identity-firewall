# Product Vision — Identity Vault / Identity Firewall

## What this is

A **local-first, open-source, privacy-first** browser extension that sits between a person and the internet. It gives every website a unique, isolated identity instead of one that can be correlated across services, and it puts the person in explicit control of exactly what data each site receives.

This is a personal project, not a company. It began as a brainstorm that was framed as a startup pitch (market sizing, investors, go-to-market) before the direction was corrected: *"Não é startup. Estou criando um produto pra mim... open source"* — "This isn't a startup. I'm building a product for myself... open source." Everything in this document reflects that corrected direction. The discarded business/startup framing is preserved for historical reference in [`docs/archive/business-context.md`](./archive/business-context.md), so the reasoning behind it is understandable, but it is **not** the active direction of the project.

---

## 1. The problem

The internet today offers two bad paths.

### Path A — Convenience

> "Sign in with Google / Apple / Microsoft"

Simple, fast, and secure in several respects — but it creates dependency on a centralized identity provider. The user ends up depending on a third party to prove their identity across dozens or hundreds of services. This creates:

- concentration of risk
- dependency on a single root identity
- risk from compromise of the primary account
- ecosystem lock-in
- potential correlation between services
- concentration of metadata
- loss of autonomy over one's digital identity

### Path B — Traditional autonomy

> "Create a different account and password for every service."

This increases compartmentalization but shifts the burden entirely onto the user: dozens or hundreds of passwords, password reuse, forgotten credentials, phishing, account recovery headaches, breaches, the need for a password manager, and dependency on a master password (or an equivalent single point of failure).

The user is left choosing between:

**convenience with centralization**, or **privacy/isolation with complexity.**

---

## 2. The deeper problem

The real problem isn't "password." It's:

> **How does an individual prove they are the same person, without needing to reveal who they are, without creating a centralized trust relationship, and without administering hundreds of credentials?**

This reframing matters. "Password manager" is a fairly mature product category. "Private identity layer" is a potentially much larger one — and it's the one this project targets.

---

## 3. Three identity models

Picture three sites: Bank A, Forum B, Site C.

### Model 1 — Independent accounts

```text
Bank A:  email + password A
Forum B: email + password B
Site C:  email + password C
```

Good compartmentalization. Bad UX.

### Model 2 — Google / Apple / Microsoft (SSO)

```text
Bank A:  Login → Google
Forum B: Login → Google
Site C:  Login → Google
```

Excellent UX. But the identity provider ends up occupying an outsized position in the architecture of the user's digital identity.

### Model 3 — Private identity (the target model)

The user holds their own **cryptographic identity**. The site doesn't necessarily need to know:

> "This is [full name], email X, national ID Y."

It could instead know:

> "This person holds a valid identity and has authorized this service."

And, depending on the case:

> "This person is over 18."

— without receiving name, national ID, primary email, date of birth, authentication history, or the identity used on other sites. This is the direction of passkeys, WebAuthn/FIDO2, verifiable credentials, decentralized identifiers, selective disclosure, and privacy-preserving identity generally.

---

## 4. Core philosophy

Everything in this project reduces to two sentences:

> **Your identity is yours. Every disclosure is an explicit authorization.**

> **The site doesn't decide what data you give it — you do.**

---

## 5. Product principles (non-negotiable)

These were defined before any technical architecture, specifically so implementation decisions in later phases could always be checked against them.

1. **Local-first** — Identity must function locally. It must not depend on our server, our API, our account system, or our infrastructure.

2. **User-owned** — Keys and data belong to the user.
   ```text
   User → Device → Vault        (correct)
   User → Our Cloud → Identity  (wrong)
   ```

3. **Minimization** — The system shares the minimum necessary, and nothing more by default.

4. **Explicit consent** — Sensitive data must never be shared silently.

5. **Isolation** — Every service gets an independent identity/credential whenever possible: `Site A ≠ Site B ≠ Site C`.

6. **Transparency** — The user must always be able to answer: *Who asked? What did they ask for? What did I hand over? When? Why?*

7. **Don't promise anonymity** — The product must never claim to hide IP address, browser fingerprint, DNS queries, cookies, behavioral tracking, or network traffic. It protects identity, not network privacy (see §10).

---

## 6. The three-tier product structure

The product is built in three levels, each of which delivers value on its own — the project doesn't need to wait for level 3 to be useful.

### Level 1 — Privacy Vault (available today)

```text
Service
 ↓
Unique identity
 ↓
Unique email alias
 ↓
Unique credential
```

Local. Open source.

### Level 2 — Passwordless

```text
Service
 ↓
Passkey
 ↓
Device authentication
```

No password at all.

### Level 3 — Private Identity

```text
Service
 ↓
"Prove I am authorized"
 ↓
Cryptographic proof
```

Without needing to reveal the user's real identity.

---

## 7. Killer features

### 7.1 — "Who knows what about me?"

A per-site dashboard that turns abstract security into something visual:

```text
Netflix
✓ email
✓ name
✓ payment

Reddit
✓ alias
✕ real email
✕ phone

Store X
✓ shipping address
✓ payment
✕ birth date
```

### 7.2 — "Delete my identity"

A single **Revoke identity** action makes that specific service-identity invalid. This is far more intuitive to a user than "change your password" — it maps directly to the mental model of "this relationship is over," rather than requiring the user to understand what a password rotation actually protects.

### 7.3 — Privacy Score

A dashboard that turns the product into a kind of **fitness tracker for your digital identity**:

```text
Your digital identity

Security       91/100
Privacy        84/100
Exposure       27/100
Reused creds   0
Trackability   Low
```

### 7.4 — Data disclosure reduction metric

A concrete, user-facing measurement of what the system actually accomplishes. Example, based on 100 logins:

```text
Without the system: 1,240 data fields disclosed
With the system:       340 data fields disclosed
```

Result: **73% less personal data shared.**

---

## 8. The Identity Firewall consent flow

This is the interaction model at the heart of the product. When a site tries to collect data, the extension intercepts the request and shows exactly what's being asked for, distinguishing required from optional fields:

```text
┌──────────────────────────────────┐
│       EXAMPLE.COM                │
│                                  │
│ Requests 7 fields                │
│                                  │
│ 🔴 National ID      required     │
│ 🟡 Name             required     │
│ 🟢 Email            required     │
│ ⚪ Phone             optional     │
│ ⚪ Date of birth     optional     │
│ ⚪ Gender            optional     │
│ ⚪ Company           optional     │
│                                  │
│ [Deny optional fields]           │
│ [Review]                         │
└──────────────────────────────────┘
```

**Optional fields are blocked by default.** The user is only interrupted when a decision actually needs to be made.

Because HTML form markup doesn't reliably reflect what the backend truly requires, the system should present "optional" as *apparently optional*, not as an absolute fact.

### Response types per field

For each requested field, the user can choose:

| Response | Behavior | Example |
|---|---|---|
| **Real** | Delivers the real value | `Name → Icaro` |
| **Alias** | Delivers a valid but artificial value (useful for detecting who leaked your data) | `Email → a8f92@alias` |
| **Synthetic** | Delivers a plausible but fabricated value | `Name → John Smith` |
| **Nonsense** | Delivers a deliberately fake value | `Name → Xablau 9000` |
| **Deny** | Delivers nothing | `Phone → NOT SENT` |

### Critical caveat

Synthetic and nonsense responses must **never** be used where a field is legally or functionally required to be truthful. This applies especially to:

- banks
- government services
- healthcare
- insurance
- payments
- contracts
- official identification

Using fabricated data in these contexts isn't a privacy win — it can cause real legal or functional problems for the user. The system needs to make this boundary explicit rather than let users fabricate data everywhere by habit.

---

## 9. Safe mode for government and high-trust sites

Government, banking, and tax-authority domains (the gov.br pattern, and equivalents elsewhere) are treated as a distinct **HIGH TRUST / SENSITIVE** category, detected via domain, certificate, community-maintained lists, or manual classification.

For these sites, **automatic filling and automated field responses are disabled by default.** The system instead surfaces an explicit warning:

> ⚠️ This site has been identified as a government or financial service. Automatic identity filling is disabled.

The user reviews and authorizes consciously rather than relying on defaults that were designed for e-commerce and social sites.

---

## 10. Scope honesty: what this product does and doesn't cover

This is one of the most important boundaries in the whole design, and it must be communicated explicitly rather than implied away.

> **Identity Privacy ≠ Network Privacy ≠ Browser Privacy.**

This product protects **identity and account data** — it does not make the user anonymous. Regardless of this tool, the following remains exposed to sites and networks, depending on the site and connection:

- IP address and IP-derived approximate location
- user agent / browser and operating system
- language and timezone
- cookies and tracking identifiers
- browser/device fingerprinting
- screen resolution and device characteristics
- browsing behavior
- DNS queries (depending on configuration)
- network-level data (e.g. WebRTC), in some cases

The product should actively show the user what it does and doesn't cover, rather than imply blanket anonymity:

```text
Privacy Status

IDENTITY       ██████████ 100%
CREDENTIALS    ██████████ 100%
TRACKING       ███░░░░░░░  30%
NETWORK        ██░░░░░░░░  20%
DEVICE         ████████░░  80%
```

> "You are using a private identity, but your IP is still visible to this site."

That is much more honest and educational than simply claiming "you are protected."

### The Privacy Stack

This product is one layer in a stack, not a replacement for the others:

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
              │      OURS       │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Device Security │
              │ OS / encryption │
              └─────────────────┘
```

- **VPN** hides the IP from the site, but shifts trust to the VPN provider.
- **Tor** provides much stronger network anonymization, with speed/compatibility trade-offs.
- **Browser anti-tracking** (hardened browsers, content blockers) reduces fingerprinting, trackers, and cookies.
- **Private DNS** protects certain DNS queries, depending on implementation.
- **Device/OS encryption** protects the vault's keys if the device itself is compromised.
- **Our Identity Layer** controls identity, credentials, authorization, and data minimization — nothing more.

This has a direct architectural consequence: the project should not try to become a VPN, a browser, an antivirus, and an identity provider all at once. The boundary needs to stay clear:

> **We control what a site knows about your identity. Other tools control what it knows about your connection and your device.**

---

## 11. Positioning language explored during brainstorming

*Note: this section documents language explored while the project was still being framed as a startup pitch. Since the project is now personal open-source software rather than a company, none of this is active marketing copy — it's kept here as a record of the thinking, in case any of it is useful for a README or project tagline later.*

Options considered:

- **A:** "Your identity. Your rules."
- **B:** "Login without being tracked."
- **C:** "The private identity layer for the internet."
- **D:** "Prove who you are. Reveal nothing else."

The brainstorm's own assessment was that **option D is probably the strongest for a technical/investor audience** — it states the mechanism (proof) and the guarantee (nothing else revealed) in one line, without leaning on either fear ("without being tracked") or abstraction ("identity layer").

---

## 12. Project history

This project's brainstorm began as a startup exploration — complete with TAM/SAM/SOM market sizing, investor targets, competitive positioning against Okta/Auth0/1Password, and a B2C → B2B2C → infrastructure business model. Partway through, the direction was explicitly corrected to a personal, local-first, open-source tool with no company, no users to acquire, and no monetization. The discarded business-framing material is archived at [`docs/archive/business-context.md`](./archive/business-context.md) for context; it does not reflect the current direction of the project.
