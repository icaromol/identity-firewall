# ADR-001: Local-first identity and keys

## Status
Accepted

## Context
The problem this project responds to is that today's internet forces a choice between centralized convenience (Google/Apple/Microsoft login) and fragmented complexity (hundreds of independent accounts and passwords). Centralized login concentrates risk, dependency, and metadata in a third party's hands. The corrected project direction ("Não é startup... open source... local") rules out simply rebuilding that same centralization under a different owner — including the project's own future server.

## Decision
Identity and keys must function entirely without any external server. There is no dependency on "our" server, "our" API, "our" account system, or "our" infrastructure for the core functionality to work. The vault, the root identity, and every service identity derived from it live on the user's device.

## Consequences
- Recovery must be solved with local/cryptographic mechanisms (device keys, recovery material, multi-factor unlock), not "email us to reset your account" — this is harder than centralized recovery and must be treated as core technology, not an afterthought.
- There is no admin panel, no central point to patch a bug for all users at once, and no way to revoke access remotely if a device is compromised except through mechanisms the user themselves controls.
- Sync across devices, if ever added, must not become a hidden dependency on a server holding key material.
- This is what makes the "don't trust us, run it yourself" pitch honest rather than aspirational.
