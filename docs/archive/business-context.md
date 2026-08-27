**Historical — pre-pivot startup framing. Not the current project direction.** This document preserves the market/business exploration from the early part of the original brainstorm, before the project was redefined as a personal, open-source, local-first tool (see `docs/adr/ADR-009-personal-oss-project-not-startup.md`). Kept for reference only, in case a commercial direction is ever revisited.

The pivot happened at this exact point in the source transcript:

> *"Não é startup. Estou criando um produto pra mim. Pra rodar local. Open source. Quem quiser usa."*
> — "This isn't a startup. I'm creating a product for myself. To run locally. Open source. Whoever wants to, uses it."

Everything below reflects the thinking that came *before* that sentence. None of it is active guidance — see `docs/product-vision.md`, `docs/roadmap.md`, and `docs/competitive-landscape.md` for the current direction.

---

## 1. Market sizing (TAM / SAM / SOM)

All figures below are the source brainstorm's own hypotheses and back-of-envelope models, explicitly **not validated market research**. They are reproduced here with their cited sources for completeness, not as evidence supporting any current decision.

### Cited market figures

- Global digital identity market: ~US$33.1B in 2025, projected to ~US$75.97B by 2030 and ~US$160.37B by 2035 (ResearchAndMarkets, via GlobeNewswire).
- IAM (Identity and Access Management) market: ~US$26.8B in 2025, growing to ~US$62.9B by 2033 (Grand View Research).
- Decentralized identity market specifically: ~US$3.7B in 2025 (Grand View Research), with long-term forecasts varying widely between consultancies.
- FIDO Alliance consumer research (2025): 69% of surveyed consumers had enabled passkeys on at least one account; 53% considered passkeys more secure than passwords; 74% were aware of passkeys; 38% of passkey users said they enable them whenever possible; 36% had had at least one account compromised via weak or stolen passwords; 87% of surveyed US/UK businesses were deploying or already had deployed passkeys.
- Global internet population: ~6.12 billion people in 2026 (DataReportal, Digital 2026 Mid-Year Global Update).
- Brazil: 168.7 million internet users in 2025, ~90.5% of the population aged 10+ (IBGE, via UOL Economia); GOV.BR had 173M+ registered users per a TCU (Brazilian federal audit court) review published August 2026.

### The brainstorm's own theoretical TAM math

Theoretical global TAM, at a hypothetical US$2/month subscription:

```text
6.12B users × US$24/year ≈ US$146.9B
```

Flagged explicitly in the source as "a theoretical TAM, not a real one" — assuming universal payment would be absurd.

### Modeled SAM

Hypothesis: the top 15% of global users most likely to pay for privacy/security/identity/productivity/digital protection.

```text
6.12B × 15% ≈ 918M people
918M × US$24/year ≈ US$22B ARR (modeled, not validated)
```

### Modeled SOM (initial targets)

| Paying users | ARR at US$24/year |
|---|---|
| 100,000 | US$2.4M |
| 500,000 | US$12M |
| 1,000,000 | US$24M |

The source's own framing: the product doesn't need to dominate the market — it needs to prove that a group of people is willing to pay to regain control over their digital identity.

### Brazil-specific modeling

- SAM hypothesis: 15% of 168.7M internet users (~25.3M people) at R$10/month → **~R$3 billion/year** modeled SAM.
- SOM example: 100,000 paying users at R$10/month → R$1M MRR → **R$12M ARR**.

Both explicitly labeled in the source as hypothesis/model, not official market sizing.

---

## 2. Customer personas (ICP candidates)

The source explicitly said it would **not** start with "the average user" — it would start with:

1. **Privacy Nerd** — uses Firefox/Brave/GrapheneOS, understands VPNs, already uses a password manager, knows what passkeys are, worried about tracking, familiar with Proton, follows security news, willing to pay. Excellent for early adoption.
2. **Cybersecurity Professional** — feels their identity is over-centralized; high potential value as evangelist, beta tester, consultant, auditor, or corporate buyer.
3. **Developer** — indie hackers, developers, DevOps, open-source contributors, AI developers; understand the architecture and can help with distribution.
4. **High-value digital user** — many accounts, investments, businesses, crypto holdings, SaaS subscriptions, financial data, multiple devices; higher willingness to pay.

### Who NOT to sell to initially

The source was explicit about who to avoid at first, because they raise CAC and slow education:

- traditional small businesses
- users with low digital literacy
- companies that just want SSO
- users perfectly satisfied with Apple Passwords
- users with no privacy awareness at all

---

## 3. B2C / B2B stakeholders — who buys what

| Stakeholder | What they buy |
|---|---|
| End user (B2C) | privacy, security, convenience, control |
| CISO | risk reduction, phishing resistance, reduced account-takeover, compliance |
| CIO | IAM, reduced complexity, integration |
| DPO / Privacy Officer | data minimization, privacy by design, LGPD compliance |
| Security Engineer | architecture, cryptography, WebAuthn, policy |
| Product Manager | conversion, reduced friction, reduced login abandonment |

A secondary B2B angle considered: "Bring Your Own Identity" — instead of `Company → Google Workspace → Employee`, `Employee Identity → Company`, where the company verifies authorization without owning the employee's whole identity. This was framed as connecting to Zero Trust, IAM, BYOD, contractor management, workforce identity, and compliance conversations.

---

## 4. Competitors considered (as companies)

- **Password managers:** 1Password, Bitwarden, Proton Pass, Dashlane, NordPass, Apple Passwords, Google Password Manager. (Bitwarden already offers zero-knowledge architecture and passkey support; Proton Pass competes on privacy with open source, E2E encryption, and zero-knowledge architecture — per WIRED reviews cited in the source.) Explicit conclusion: don't try to beat these by building "a better password manager."
- **Identity / IAM players (mostly B2B-relevant):** Okta, Auth0, Microsoft Entra, Google Identity, Apple, Ping Identity, ForgeRock, Clerk, Stytch, Descope.
- **Conceptual competitors:** FIDO, passkeys, Verifiable Credentials, decentralized identity, digital wallets, government digital IDs — treated as competing *standards*, not companies, which the source considered a good thing: it means the project could build infrastructure on top of open standards rather than fighting them.

### The biggest competitive risk identified

Google, Apple, and Microsoft are already pushing passkeys themselves. Microsoft announced passkeys becoming the default authentication method for Entra ID business accounts starting September 2026, with SMS/voice-call authentication being phased out (TechRadar, cited in source). The source's conclusion: **"let's replace passwords with passkeys" is a market trend, not a startup thesis on its own.** A startup in this space would need to answer "what do we do that Apple/Google/Microsoft have no incentive to do?" — the source's own answer was **neutrality + privacy + portability**.

---

## 5. Strategic / ecosystem stakeholders named

- **Standards & advocacy:** FIDO Alliance (authentication standards), W3C (WebAuthn and web standards), OWASP (security), Mozilla (privacy + browser + advocacy).
- **Possible partners or competitors:** Proton, Cloudflare (infrastructure/security/edge), Apple, Google, Microsoft (each: passkeys + their respective ecosystem/identity play), Yubico (hardware authentication), Bitwarden, 1Password.
- **Brazil-specific:** Governo Federal / GOV.BR (already operates one of the country's largest digital-identity infrastructures), ANPD (Brazil's data protection authority — relevant given LGPD, minimization, consent, and privacy-by-design), NIC.br / CGI.br (internet governance, standards, research, ecosystem), CERT.br (security and education).

---

## 6. Potential investors named

**Cybersecurity-focused VCs:** Ten Eleven Ventures, YL Ventures, Cyberstarts, Ballistic Ventures.

**Generalist / LatAm VCs:** Kaszek (possible for a large-scale infrastructure/identity thesis), Canary (relevant for a Brazilian startup with global potential), Astella (B2B/infrastructure software), Latitud (Latin American startups with global ambition), MAYA Capital (depending on stage/thesis).

### Potential strategic acquirers/investors, with the rationale given for each

| Company | Rationale given |
|---|---|
| Cloudflare | Identity + network + security is a natural combination |
| Okta | Would be expansion toward a more consumer/privacy-centric identity offering |
| 1Password / Bitwarden | Would be expansion from password manager to identity wallet |
| Proton | Private identity would complement Proton Mail, Proton Pass, Proton VPN, Proton Drive |
| Microsoft / Google / Apple | Possible but paradoxical — they might want the technology, but "we don't depend on Big Tech identity providers" is the opposite of their strategic incentive |
| Cisco | Security + enterprise |
| Palo Alto Networks | Security/identity |

---

## 7. Business models considered

- **Model A — Freemium:** free tier (identity, passkeys, 5–10 services, one device) + Pro at R$10–20/month (unlimited identities, recovery, aliases, privacy tools, advanced credentials).
- **Model B — B2B SaaS:** R$10–50 per user/month depending on tier.
- **Model C — Infrastructure/API:** usage-based pricing for developers (authentication API, identity API, credential-verification API), priced per MAU/authentication/verification.
- **Model D — Enterprise:** annual contracts, R$100k–R$1M+, depending on company size.

**Preferred sequencing** (the source's own favorite): **Consumer → Developer SDK → Company infrastructure** — proving "people want private identity" first, then giving developers an SDK, then selling infrastructure to companies. The long-term framing used was **"Stripe for private identity"**: not literally Stripe, but simple infrastructure for websites to accept private identity.

---

## 8. Go-to-market approach considered

Community-first, not paid advertising. Target communities: privacy, cybersecurity, Linux, GrapheneOS, self-hosting, open source, developers, digital sovereignty.

Open source itself was treated as a GTM/trust strategy: since the pitch is "trust us," and the natural response is "why should I," open source lets the answer be "audit it yourself" — enabling community audit, researcher scrutiny, and transparency. The (then-considered) monetization model paired an open-source core/server with paid hosted service, enterprise support, API access, and managed infrastructure.

---

## 9. Discovery-sprint methodology (proposed, pre-code)

Before writing any product code, the source proposed a **2–3 week Discovery Sprint** with four tracks:

- **A — 30 B2C interviews**, with privacy nerds, developers, founders, and cybersecurity professionals.
- **B — 20 B2B interviews**, with CISOs, CTOs, DPOs, security engineers, and product managers.
- **C — Competitive teardown** of Google/Apple/Microsoft sign-in, 1Password, Bitwarden, Proton Pass, Okta/Auth0, passkeys, and VC/DID wallets.
- **D — Technical feasibility prototype**: browser → wallet → passkey → pairwise identity → website verification, tested as a working flow.

The sprint's stated goal was **not** to prove the technology works (passkeys/WebAuthn already prove the technical base works) — it was to discover whether a strong enough **commercial wedge** exists to turn privacy + identity into a product.

### The hypothesis matrix

| Hypothesis | Question | How to test |
|---|---|---|
| Pain exists | Does this actually bother people? | Interviews |
| Frequency | How often does it happen? | Interviews + survey |
| Severity | What do people do about it today? | Interviews |
| Alternatives | How do they solve it currently? | Interviews |
| Privacy | How much does this matter to them? | Interviews |
| Security | What risk do they perceive? | Interviews |
| Convenience | How much effort will they accept? | Prototype test |
| Value | Would they pay? | Landing page + pre-sale |
| Product | Would they use it? | Functional MVP |
| B2B | Would a company adopt it? | B2B interviews |
| Distribution | How do we find users? | Experiments |
| Integration | Would sites accept it? | Developer interviews |

### The go/no-go funnel

```text
             PROBLEM
                ↓
       30 interviews
                ↓
       Found the pain?
          ↙          ↘
        NO           YES
        ↓             ↓
      KILL       Survey 500+
                      ↓
                Interest?
                  ↙     ↘
                NO      YES
                ↓        ↓
              KILL    Landing page
                         ↓
                   Would use it?
                      ↓
                  Pre-sale
                      ↓
                   $$$ ?
                   ↙    ↘
                 NO    YES
                 ↓       ↓
               KILL    MVP
                         ↓
                  50–100 users
                         ↓
                   Retention?
                    ↙      ↘
                  NO       YES
                  ↓         ↓
                PIVOT    SCALE
```

### Explicit signal thresholds

**Problem validation** (after 30 interviews) — strong signal if:
- more than 50% report the problem unprompted
- more than 30% already have a workaround
- more than 20% already pay for something related
- at least 10 users are found with genuinely strong pain

**Solution validation** (with 50 users given the product for 30 days) — strong signal if:
- more than 60% activate (create an identity)
- more than 40% use it again
- more than 30% create multiple identities
- more than 20% are still retained after 30 days

The source's own framing: *"these aren't magic numbers — they're internal criteria to avoid self-deception."*

---

## 10. Opportunity scoring (the source's own assessment)

| Dimension | Score | Note |
|---|---|---|
| Problem | 9/10 | The problem genuinely exists |
| Timing | 9/10 | Passkeys accelerating, IAM growing, digital identity becoming infrastructure |
| Market | 10/10 | Much larger than password management alone |
| Technology | 8/10 | Technically feasible today |
| Differentiation | 7/10 | Room exists, but only if it doesn't become "just another password manager" |
| Go-to-market | 5/10 | The biggest problem — convincing websites to integrate |
| Moat | 8/10 | Can become strong if users → identities → websites → developers → network effects compound |

### Moat ideas considered

The source explicitly rejected "we have secret cryptography" as a moat (called it weak) in favor of:

1. **Open protocol** — open implementation based on open standards.
2. **Network effects** — the more sites that support the identity, the more valuable it becomes.
3. **Developer ecosystem / SDK** — e.g. `privateIdentity.login()`.
4. **Trust** — independent audits.
5. **Recovery infrastructure** — flagged as one of the hardest parts to get right.
6. **UX** — making cryptographic identity invisible to the end user as a differentiator in itself.

---

## Why this is archived, not deleted

The technical reasoning that came out of this phase — three identity models, the "authentication vs. identity" distinction, the pairwise per-site identity concept, the killer features (disclosure dashboard, revoke-identity, privacy score) — survived the pivot and is carried forward into `docs/product-vision.md`. Only the company-shaped material on this page (market sizing, investors, personas-as-customers, competitors-as-companies, monetization, GTM, discovery-sprint validation methodology) was discarded, because the project is being built by one person, for their own use, released as open source with no users to acquire and nothing to monetize.
