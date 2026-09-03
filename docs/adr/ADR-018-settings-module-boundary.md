# ADR-018: `background/settings/` as a separably-extractable module

## Status
Accepted

## Context
Phase 7 Part A needed a place to store app-behavior preferences (auto-lock duration, credential save mode) that are meaningfully different in kind from everything else the Vault stores: they're not personal/identity data, not vault contents, not disclosure policy. Confirmed directly with the user during planning: *"it should be a module and all other things that are not related to DATA OUR DATA AND PRIVACY, in a different module, in a way we can later stick it out to another microservice with api and data treatment."*

This is a code-organization decision, not a reversal of any prior architectural commitment. In particular, it does **not** conflict with:

- **ADR-001 (local-first)** / **ADR-007 (no server dependency)** — this module introduces no server, no API call, no network dependency of any kind. "Extractable into its own service later" describes a *possible future shape*, not a present one; nothing here requires or assumes a server exists.
- **ADR-009 (personal, OSS project, not a startup)** — this isn't a pivot toward SaaS/microservice architecture as a business strategy; it's a boundary drawn for code hygiene, on a project that remains local-first and server-free today.

## Decision
`background/settings/` owns its own storage namespace, its own message capability (`'settings'`, `background/router/registry.ts`), and exactly one intentional call *into* another module — never the reverse as a general rule:

- `background/settings/storage.ts` — plain, unencrypted `browser.storage.local` (key `if_app_settings_v1`), never the vault's own tiered/encrypted storage (`background/vault/storage.ts`). Deliberate: settings must stay readable even while the Vault is locked (`idleLock.ts`'s own listener needs the configured threshold regardless of lock state, and the Configuration tab should show the current auto-lock setting even before the Vault is ever unlocked).
- `background/settings/idleLock.ts` calls `lockVault()` (`background/vault/unlock.ts`) — the one deliberate, narrow exception, explicitly named in the original plan rather than treated as an oversight.
- `background/settings/storage.ts` also imports `createSerialQueue()` from `background/vault/serialQueue.ts` — a second, narrower exception found during implementation (`/code-review`'s verification pass caught an earlier version of this file's own comment claiming "never imports from `background/vault/`" outright, which the code already contradicted). This import is accepted as within the boundary's spirit because `createSerialQueue` is a fully generic FIFO-queue primitive with zero vault-specific logic — it happens to live under `vault/` only because that's where it was first extracted from, not because the settings module depends on vault *business logic*.
- The per-field default-policy dropdowns (Phase 7 Part A M5) are **not** part of this module, on purpose — they're the Policy Engine's own existing disclosure-behavior logic (`background/policy/`, core privacy domain, working since Phase 4), just finally getting a UI. `GetPoliciesResponse`'s `availableResponses` addition lives in `background/policy/handler.ts`, not `background/settings/`.

## Consequences
- **The boundary is a convention, not an enforced one.** No lint rule, dependency-cruiser config, or other tooling in this repo currently prevents a future file from adding a third import from `background/settings/` into `background/vault/` (or the reverse). This ADR is the documentation of intent; a future contributor extending this module should read it before adding a new cross-module import, not assume the boundary is mechanically guarded.
- **Extraction, if it ever happens, is cheap but not free.** Two narrow, named exceptions (`lockVault()`, `createSerialQueue()`) would need to be resolved — either the settings module keeps a thin dependency on a small vault-adjacent utility package, or those two pieces get duplicated/re-homed. This is a known, accepted cost of the current shape, not a hidden one.
- **No behavior change for the rest of the codebase.** `background/vault/`, `background/policy/`, `background/identity/`, `background/firewall/` have zero imports from `background/settings/` — the dependency edge runs one direction only, matching the plan's own "exactly one call into another module, never the reverse" framing (modulo the `createSerialQueue` exception above).
