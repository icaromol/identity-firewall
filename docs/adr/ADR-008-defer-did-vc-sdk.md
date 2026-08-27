# ADR-008: Defer DID/VC infrastructure and the developer SDK past the MVP

## Status
Accepted

## Context
The full self-sovereign-identity stack — DID methods, DID resolution, DID documents/registries, W3C Verifiable Credentials, issuer/holder/verifier protocols, and a developer-facing SDK for sites to integrate against — is real, useful infrastructure, and it maps naturally onto where this project eventually wants to go (see `docs/interoperability.md`). But it is also a large amount of complexity, well illustrated by AltMe (studied as a reference project, see `docs/competitive-landscape.md`), which is a large project precisely because it takes on that entire ecosystem. Building it before validating the core Identity Firewall/vault concept would be solving interoperability problems the project doesn't have yet.

## Decision
DID method/resolution infrastructure, a full W3C Verifiable Credentials implementation, and the developer SDK are explicitly out of scope for the MVP. For the MVP, "local identity key + service identity + signature" is sufficient. These become Phase 9 (Private Identity Protocol), Phase 10 (Selective Disclosure), and Phase 11 (Experimental SDK) in `docs/roadmap.md` — deliberately sequenced after the MVP (Phases 0–8), not blockers to it.

## Consequences
- The MVP's data model is still designed so that claims/attributes are structured as discrete, independently-disclosable fields, so that SD-JWT-based selective disclosure (Phase 10) and eventual DID/VC interoperability can be layered on later without a data-model rewrite.
- No site integration is required for the MVP to be useful — legacy-compatibility mode (ADR-002) carries the full MVP value proposition on its own.
- If DID/VC interoperability is revisited, it should be triggered by an actual, concrete need for interoperability with the broader SSI ecosystem — not built speculatively because the standards exist.
- The SDK, when eventually built (Phase 11), is meant to be a thin wrapper over the already-built Private Identity Protocol (Phase 9) — not new capability of its own.
