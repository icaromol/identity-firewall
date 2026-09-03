# Threat Model

Identity Firewall is built around a simple discipline: name the attacker before designing the mitigation. This document enumerates the attackers the project explicitly defends against, states plainly where a mitigation stops, and gives the checklist every security-relevant design decision should be able to answer.

It complements [security-model.md](security-model.md) (how things are technically secured — cryptography, authentication mechanisms, attack-surface minimization) and [privacy-model.md](privacy-model.md) (what data is disclosed to whom, under what policy). This document owns the *who* and *against what* — attacker by attacker.

## Trust boundary

Before enumerating attackers, the architecture needs an explicit boundary: what is trusted, and what crosses into the untrusted world.

```text
┌─────────────────────────────┐
│          DEVICE             │
│                             │
│  ┌───────────────────────┐  │
│  │      IDENTITY VAULT   │  │
│  │                       │  │
│  │ Private Keys          │  │
│  │ Personal Data         │  │
│  │ Credentials           │  │
│  └───────────┬───────────┘  │
│              │              │
│       Identity Firewall     │
│              │              │
└──────────────┼──────────────┘
               │
               ▼
            INTERNET
```

Everything inside the device boundary — the Identity Vault's private keys, personal data, and credentials — is trusted. The Identity Firewall is the single choke point at the edge of that boundary. Every place a line crosses from the device outward needs an explicit answer to one question:

> **What data crosses this boundary?**

If a design can't answer that question for a given data flow, the design isn't finished. See [architecture.md](architecture.md) for how this boundary maps onto the concrete extension architecture, and [identity-model.md](identity-model.md) for how Root Identity vs. Service Identity data is partitioned inside the Vault.

## Attackers

The product is built around real, named threats rather than a generic "be secure" posture. Each attacker below gets a description of what it can attempt, what it must not obtain, and which part of the system is responsible for stopping it.

### Attacker A — Malicious site

**Behavior:** A site the user visits asks for more data than it needs — either through an oversized registration form or through a legacy credential/OAuth-style flow that requests broad claims by default.

**Must not obtain:** Any field the user has not explicitly authorized, especially fields flagged optional.

**Mitigation:** The **Identity Firewall** — it detects what a site is requesting, classifies each field, blocks apparently-optional fields by default, and requires explicit approval for the rest. See [privacy-model.md](privacy-model.md) for the full consent flow and field classification.

### Attacker B — Compromised legitimate site

**Behavior:** A legitimate service the user has an account with is breached. The attacker gains full access to that service's backend/database.

**What the attacker gets:** The credentials issued to that one service — email, password (or passkey public key), username used there.

**What the attacker must not get:** Identities or credentials used on any *other* site, the user's national ID (CPF), phone number, address, or any other personal data not disclosed to that specific service.

**Mitigation:** **Service Identity Isolation** — each service is issued its own derived identity, its own credential material, and (where the site allows it) its own alias/data values. A breach at one service is contained to that service's slice of the Vault; it does not cascade into a breach of the user's identity as a whole. See [identity-model.md](identity-model.md) for how Root Identity vs. Service Identity are structured to make this containment actually hold.

### Attacker C — Local malware / fully compromised device

**Behavior:** The user's computer or phone itself is compromised — malware with access to the running browser, memory, or OS.

This is the hardest case, and the project is deliberately honest about it rather than making a claim it can't back. If the device is compromised, an attacker can steal:

- cookies;
- active sessions;
- tokens;
- anything currently displayed on screen;
- actions the user performs while the malware is resident.

**What we claim:** Nothing. **No identity system — this one included — magically protects a fully compromised endpoint.** An attacker with code execution on the device can, in principle, observe or intercept whatever the user themselves can see or do at that moment.

**What we do not claim to protect against in this scenario:** live session hijacking, credential use during an active authorized session, on-screen data capture, or keystroke/clipboard interception.

**What is still meaningfully reduced, even here:** because identities are compartmentalized per service (Attacker B's mitigation) and sensitive data release requires a fresh authorization step (see [privacy-model.md](privacy-model.md) and [biometric-model.md](biometric-model.md)), a compromised session on one site does not automatically hand the attacker a durable, reusable copy of the user's full identity or every other service's credentials — but this is a reduction in *blast radius*, not a claim of immunity. This distinction must remain part of how the product communicates itself: promising otherwise would be dishonest.

### Attacker D — Device theft

**Behavior:** Someone gains physical access to the user's device — theft, loss, or seizure — while it is powered off or locked, i.e. an offline access scenario rather than a live-malware scenario.

**Must protect (against offline/physical access):**

```text
Vault
Private Keys
Personal Data
Credentials
```

**Mitigations named for this attacker:**

- device binding;
- a recovery device;
- a hardware security key;
- recovery codes;
- multi-device trust (optionally extending to social/recovery guardians).

The Vault must remain encrypted at rest such that physical possession of the device, without the unlock factor (PIN/biometric/device key), does not yield the private keys, personal data, or credentials inside it. See [security-model.md](security-model.md) for the encryption mechanism and [biometric-model.md](biometric-model.md) for how the unlock factor itself works.

**A related, narrower scenario this attacker definition does not itself cover:** the device is neither powered off nor OS-locked, but the user has walked away with the Vault still unlocked from an earlier session — an in-between state that is neither "actively supervised" nor "offline." Before Phase 7 Part A, nothing closed this gap; the Vault stayed unlocked indefinitely until the user explicitly clicked Lock. Phase 7 Part A's auto-lock (`background/settings/idleLock.ts`, via `chrome.idle`) mitigates this by re-locking after a configurable period of system-wide inactivity, and immediately on an OS screen lock regardless of that configured period — treating an actual screen lock as at least as strong a signal as the device being stolen while locked outright. See [docs/plans/autolock-and-configuration.md](plans/autolock-and-configuration.md) for the mechanism's own design decisions.

### Attacker E — Vulnerability in our own product

**Behavior:** The Identity Firewall's own software has a bug or vulnerability — this is treated as a certainty to design around, not a hypothetical.

**Assumption:** Our software can have vulnerabilities.

**Mitigations:**

- minimize the data actually stored;
- encrypt the Vault at rest;
- minimize the extension's own privileges/permissions;
- avoid servers wherever possible (nothing to breach if it doesn't exist);
- keep the architecture auditable — the codebase is open source specifically so this claim is checkable by others, not just asserted.

This is the same reasoning that shapes the extension's attack-surface posture in [security-model.md](security-model.md): the product minimizes what a bug in its own code could expose.

### Attacker F — Correlation attack

**Behavior:** Even though the user has a different identity per site, an attacker (or a coalition of sites) attempts to determine that `identity-A` on Site A and `identity-B` on Site B belong to the same person by correlating:

- a reused email;
- a reused username;
- IP address;
- browser/device fingerprint;
- behavioral patterns;
- shared identifiers;
- other metadata.

**The critical distinction this attacker forces the architecture to make explicit:**

> **Identity isolation** is not the same thing as **full anonymity.**

Service Identity Isolation (Attacker B's mitigation) stops a site from directly reading another site's data about the user. It does **not**, by itself, prevent correlation through side channels like IP address or fingerprinting — those belong to a different layer of the stack entirely (network privacy, browser privacy — see the Privacy Stack framing in [privacy-model.md](privacy-model.md)). Whatever isolation the Vault provides at the identity/data layer, the product must never claim it also delivers anonymity at the network or browser layer. This is Principle 7 of the product (see [product-vision.md](product-vision.md)): never promise to hide IP, fingerprint, DNS, cookies, behavior, or traffic.

## Security review checklist

Per the project's own gating rule (see [roadmap.md](roadmap.md) for the Phase 0 exit criteria), a design or feature does not advance until it can answer the following questions clearly. They are grouped by area:

### Data

- Where does the data live?
- Is it encrypted?
- Who holds the keys?
- What leaves the device?

### Identity

- Can one identity be correlated with another?
- Can a site discover the Root Identity?
- Does compromising one service affect the others?

### Extension

- What permissions does it hold?
- What pages can it access?
- What happens if the extension itself is compromised?

### Biometrics

- Does the site receive biometric data?
- Does our software receive biometric data?
- Does the OS receive biometric data (as opposed to just reporting a pass/fail result)?
- What happens when biometric authorization fails?

### Recovery

- What happens if the device is lost?
- Does a backup exist?
- Who is able to recover the identity/Vault?
- Does the backup contain the private keys themselves?

These questions are not decorative — they are the acceptance gate. A feature that cannot answer all of them for its area is not ready to ship, regardless of how complete it otherwise feels.
