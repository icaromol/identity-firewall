# ADR-006: No blockchain in the core architecture

## Status
Accepted

## Context
The idea of using a blockchain/cryptocurrency network came up directly in the brainstorm ("Da pra fazer isso e daria sentido uma espécie de rede criptomoedas chain?"). Blockchains are a natural association for anything involving cryptographic identity and decentralization, so it's worth addressing explicitly rather than leaving it ambiguous.

## Decision
No blockchain, cryptocurrency, or token is part of the core architecture. Identity, keys, and signatures are handled with a local-first, cryptographic-signature-based design instead.

## Consequences
- A blockchain only earns its place if something genuinely requires public registration of identities/keys, verifiable public revocation, proof of existence/timestamping, cross-device portability without a central authority, reputation/attestation without a central server, or coordination among mutually untrusted nodes. None of these are MVP requirements.
- For a project whose thesis is privacy, isolation, and self-hosting, a public ledger can actively **worsen** privacy: it creates permanent, public metadata about identity-related activity, which cuts directly against the project's goals even though it might sound more "decentralized" on the surface.
- The architecture investigates P2P + cryptographic signatures + local storage first. A chain is only reconsidered if a specific, concrete need is found that this combination cannot satisfy — not spec­ulatively, and not because "decentralized identity" is trending.
- This decision can be revisited, but the burden of proof is on demonstrating a genuine requirement for distributed consensus, not on justifying its absence. See `docs/interoperability.md` for the fuller reasoning.
