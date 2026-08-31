# ADR-016: Deterministic per-site Synthetic values — reusing ADR-010's HKDF pattern for fake personal data

## Status
Accepted

## Context
`product-vision.md` (line 259) describes the Alias/Synthetic response types as "useful for detecting who leaked your data" — the idea being that if a fabricated value handed to exactly one site later shows up somewhere else, that site is the leak. This only works if the *same* site always receives the *same* fabricated value; a value that changes on every fill can never be traced back to a single discloser.

`background/firewall/syntheticGenerator.ts`, built in Phase 3, does not do this: `generateSyntheticValue`'s random token comes from `crypto.randomUUID()` called fresh on every invocation, with no persistence. Filling the same field on the same site twice produces two different fake names/emails. This was never a deliberate trade-off — it's an oversight found while reviewing Phase 5's scope — and it silently breaks the traceability claim the product's own vision document makes.

Separately, this project already has a proven mechanism for exactly the property needed here: [ADR-010](ADR-010-identity-derivation-function.md) derives a Service Identity's keypair deterministically from `HKDF-SHA256(ikm = RootSecret, salt = FixedAppSalt, info = normalizeOrigin(origin))` — the same root secret and origin always produce the same output, recoverable from the root alone, with no per-site state to lose.

## Decision
Reuse ADR-010's derivation shape for Synthetic personal-data values, changing only what the derived bytes are used for:

```
SyntheticFieldSeed = HKDF-SHA256(
  ikm  = RootSecret,
  salt = FixedAppSalt,
  info = normalizeOrigin(origin) || fieldType   // fieldType appended so
                                                  // different fields on the
                                                  // same site don't collide
)
```

The derived bytes are mapped onto a fake value the same way `syntheticGenerator.ts` already builds one today (e.g. a token appended to `synthetic.<token>@example.invalid` for email) — only the token's source changes, from `crypto.randomUUID()` to this derivation. `generateNonsenseValue` is explicitly **not** changed: "deliberately absurd" values have never carried a leak-detection claim, only Synthetic values have, so there's no correctness gap to close there.

## Consequences
- **The traceability claim in `product-vision.md` becomes actually true.** The same site, asked twice, gets the same fake name/email — if that exact value is later found outside the vault, the site it was derived for is identifiable with certainty.
- **No new storage.** Like a Service Identity's keypair, the value is recomputed from `RootSecret` + origin + field type on demand — nothing new needs to survive a backup/restore beyond what ADR-010 already requires.
- **Still Synthetic, not Alias.** This does not make Synthetic a real, deliverable value — a fake email derived this way still can't receive mail, since no real external alias provider is involved. Alias remains gated behind an actual provider integration (Phase 9); this change only fixes Synthetic's own internal consistency.
- **Scope limited to `generateSyntheticValue`.** `generateNonsenseValue` keeps its current `crypto.randomUUID()`-based behavior — deliberately, since determinism was never a property claimed for Nonsense values.
