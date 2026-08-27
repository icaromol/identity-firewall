# ADR-005: Biometrics as a local unlock mechanism, not a cryptographic secret source (MVP)

## Status
Accepted

## Context
The brainstorm's original idea for biometrics was ambitious: derive a cryptographic secret directly from a fingerprint or face scan (a "Model B" approach, related to fuzzy extractors and biometric cryptosystems, as researched in projects like Justitia). That is a real, active research area, but it is also delicate: biometric readings vary capture to capture, template-protection schemes are subtle to get right, and getting it wrong risks either false security claims or irrecoverable lockouts. Using an unproven scheme as the MVP's primary secret-derivation mechanism would put the whole product's security on an unvalidated foundation.

## Decision
For the MVP, biometrics (fingerprint/face) authorize local vault operations through the OS's native biometric APIs — they act as a gate that unlocks access to keys already held by the vault. Biometrics are **not** used as the source material from which cryptographic secrets are derived. That approach ("Model B") is explicitly deferred to the Phase 12 R&D investigation.

```text
Fingerprint / Face
        ↓
   OS biometric API
        ↓
  "user authorized"
        ↓
     Vault unlocked
```

## Consequences
- Biometric data never leaves the device, and the product itself never sees or stores the raw biometric reading or template — the OS handles matching and returns a yes/no.
- Different sensitivity levels of data can require different authorization strength (see `docs/roadmap.md` Phase 5 and `docs/biometric-model.md`), but all of them ultimately gate access to vault-held keys, not derive new ones from the biometric itself.
- Model B is not assumed to be more secure than Model A by default. Phase 12 (`docs/roadmap.md`) exists specifically to evaluate fuzzy extractors, secure sketches, cancelable biometrics, template protection, and attack surfaces (reconstruction attacks, FAR/FRR trade-offs) before any decision to adopt it.
- Justitia and similar research projects are treated as academic references for that future investigation, never as production dependencies (see `docs/competitive-landscape.md`).
- If Model B is ever adopted, it will require its own ADR superseding or amending this one.
