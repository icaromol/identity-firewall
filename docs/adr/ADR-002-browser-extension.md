# ADR-002: Browser extension as the initial distribution vehicle

## Status
Accepted

## Context
Any new login/identity protocol faces a chicken-and-egg problem: sites won't adopt a protocol with no users, and users have no reason to install something that no site supports. Waiting for site-side adoption before shipping anything means the project never ships. A native app that isn't hooked into the browser's own form-filling and session flows would face the same adoption wall from a different direction.

## Decision
Ship as a browser extension (WXT + Manifest V3) as the initial and primary distribution vehicle, rather than a native app or a protocol that requires site-side integration to be useful.

## Consequences
- The extension can run in **legacy-compatibility mode** on any existing site with zero cooperation from that site — detecting forms, classifying fields, and autofilling a generated identity — so value is delivered on day one, on the web as it exists today (see `docs/interoperability.md`, `docs/browser-architecture.md`).
- This sidesteps the chicken-and-egg problem entirely for the MVP: no site needs to adopt anything for the product to be useful.
- A native protocol/SDK (Phases 9–11 in `docs/roadmap.md`) becomes an optional, additive upgrade path for sites that want it later — never a precondition for launch.
- The extension's permission model becomes a first-class attack surface that must be reasoned about explicitly (see `docs/threat-model.md`): what the content script can see, what the background service can do, and what happens if the extension itself is compromised.
- Distribution is initially tied to browser extension stores and their review/update mechanisms, which is an acceptable trade-off given the alternative (no adoption path at all).
