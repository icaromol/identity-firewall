# Biometric Model

The design brainstorm explicitly separates two different ways biometrics could be used in this product, and treats them as fundamentally different in maturity, risk, and MVP-readiness. This document describes both, states which one ships, and says why.

## Model A — Biometric as local unlock (chosen for the MVP)

```text
Fingerprint / Face
       ↓
OS-native biometric API
       ↓
"User authorized"
       ↓
Unlocks the local Vault
```

In this model, a fingerprint or face scan is handled entirely by the operating system's own biometric subsystem. The OS reports back a simple authorization result — the user matched, or didn't. That result is what unlocks the local, encrypted Identity Vault (or releases a specific piece of already-stored data — see the authorization ceremony below).

Critical properties of this model:

- **The biometric data itself never leaves the OS's biometric subsystem.** Neither the extension nor any site ever receives a fingerprint image, a face embedding, or any other raw or derived biometric representation — only a pass/fail authorization signal.
- **This product never stores biometric data**, in any form.
- **No site ever receives biometric data.** A site can request that the user *authorize* a disclosure; it never receives the authorization mechanism itself.
- Biometrics **authorize the release of already-stored identity data or keys** — they are not the identity itself, and they are not a substitute for the underlying cryptographic key. The private key still exists and does the actual cryptographic work; the fingerprint scan is simply the gate that permits its use.

This is the model shipped in the MVP, and it underlies the authorization levels and scoped bundles described in [privacy-model.md](privacy-model.md) (Level 2 "Sensitive" and Level 3 "Highly sensitive" both gate on this mechanism) as well as the device-theft mitigations in [threat-model.md](threat-model.md) (Attacker D).

## Model B — Biometric as cryptographic secret (deferred to R&D, not in the MVP)

```text
Fingerprint / Face
       ↓
Biometric representation
       ↓
Fuzzy extraction
       ↓
Cryptographic secret
```

This is a fundamentally different — and much less mature — idea: deriving a **reproducible cryptographic secret directly from biometric input**, such that the same finger or face can reconstruct the secret on demand, while a different finger or face cannot, **without ever storing a reconstructable image or template** of the biometric itself. The relevant technical building blocks for this are:

- Fuzzy Extractors;
- Secure Sketches;
- Biometric Cryptosystems;
- Cancelable Biometrics;
- Template Protection;
- Face embeddings;
- Fingerprint representations;
- Secure Enclave / hardware-backed keys;
- reconstruction attacks;
- template attacks;
- False Acceptance Rate (FAR);
- False Rejection Rate (FRR).

**Academic prior art, not a production dependency:** the project **Justitia** (github.com/euzun/justitia) implements cryptographic key derivation from biometric inferences using fuzzy extractors, and demonstrates that the same biometric input can recover a secret while a different one cannot. This is referenced here as evidence the underlying concept is not far-fetched research fiction — real, working implementations of the idea exist. It is explicitly **not** something this project depends on, builds on top of, or ships in the MVP. See [competitive-landscape.md](competitive-landscape.md) for the broader comparison of reference projects.

Model B is explicitly parked as a future R&D investigation track, not rejected outright — the topics above are exactly what that future investigation phase would need to study before any such mechanism could be trusted in production.

## Why Model A ships and Model B doesn't

The decision is stated explicitly, and deliberately avoids a common trap: **do not assume Model B is automatically "more secure" than Model A.** That would need to be actually investigated — through real threat modeling of reconstruction/template attacks, FAR/FRR characteristics, and hardware dependencies — before it could be asserted, and that investigation has not happened.

Model A ships in the MVP instead because it relies on **already-hardened, widely-deployed OS and platform biometric stacks** (Secure Enclave, TPM-backed platform authenticators, etc.) rather than a custom, unproven scheme built by a small team. This is the same reasoning behind the "never invent cryptography" rule in [security-model.md](security-model.md): reusing a mature, heavily scrutinized implementation is safer than rolling a novel one, even a conceptually appealing one, without first doing the investigation to justify it.

## The authorization ceremony

When a site requests fields that include sensitive data, the Firewall separates sensitive from non-sensitive fields before asking for anything, then requires a fingerprint/face confirmation specifically to release the sensitive ones:

```text
example.com

Requesting:

CPF
Name
Address

Non-sensitive data:

Country
Language
Timezone

────────────────────

Authorize?

[ 👆 Fingerprint ]
[ ❌ Cancel ]
```

The biometric prompt in this ceremony is **a gate on data release — it is never itself transmitted anywhere.** The site never learns that a fingerprint or face scan happened at all; it only ever receives the data the Vault was authorized to release as a result. This is the same constraint stated in Model A above, restated here in its concrete UX form: authorization and disclosure are two separate events, and only the second one ever reaches the network.

See [privacy-model.md](privacy-model.md) for how this ceremony interacts with scoped bundles like `identity.basic` and `identity.financial`, so the user isn't re-prompted for biometrics on every individual field within an already-authorized scope.
