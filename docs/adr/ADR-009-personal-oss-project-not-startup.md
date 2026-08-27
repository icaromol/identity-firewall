# ADR-009: Personal open-source project, not a startup

## Status
Accepted

## Context
The original brainstorm spent its first third framing this idea as a venture-backed startup: TAM/SAM/SOM market sizing, investor lists, customer personas, B2B stakeholders, competitors framed as potential acquirers, go-to-market strategy, and pricing tiers. Partway through, that framing was explicitly rejected:

> *"Não é startup. Estou criando um produto pra mim. Pra rodar local. Open source. Quem quiser usa."*
> — "This isn't a startup. I'm creating a product for myself. To run locally. Open source. Whoever wants to, uses it."

This is a load-bearing fact about the project, not a footnote: it changes what "success" means, what work is actually necessary, and what kind of decisions are in scope at all.

## Decision
The project is a personal, self-hosted, open-source tool. There is no company, no funding, no requirement to prove market demand, no customers to acquire, and no monetization. Success is measured entirely by the project's usefulness to its own author: *did my dependency on Google/Apple/Microsoft decrease, and did my security improve?* If yes, the project has succeeded — independent of how many other people use it.

## Consequences
- Market validation, discovery sprints, growth metrics, pricing experiments, and investor pitches are not part of this project's actual roadmap (`docs/roadmap.md`) — the roadmap is a technical build sequence, not a go-to-market plan.
- The startup-era material (market sizing, personas-as-customers, competitors-as-acquirers, business models, GTM) is preserved for historical context only, in `docs/archive/business-context.md`, and must not be treated as active guidance. See that document's own header for the same caveat.
- Product decisions should be evaluated against the technical/privacy principles in `docs/product-vision.md`, not against commercial considerations (conversion, CAC, retention-for-monetization) — those concerns simply don't apply to a project with no customers.
- If the project's direction is ever deliberately revisited toward a commercial model, that requires an explicit, conscious decision by the user (a new ADR superseding this one) — it should never happen implicitly by an assistant or contributor reintroducing business-shaped requirements (pricing tiers, growth targets, investor-facing framing) into a technical conversation.
