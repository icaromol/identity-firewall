---
name: phase-recap
description: Builds a beginner-friendly, diagram-rich recap of every commit in a completed (or in-progress) roadmap phase and publishes it two ways -- a visual Claude Artifact (mermaid diagrams, per-commit sections) and a markdown twin saved into docs/changelog/ as permanent project documentation. Use when the user asks to recap, summarize, explain, or document a finished phase or set of milestones, or explicitly invokes /phase-recap.
---

# Phase Recap

Turns a run of "Phase N ..." commits into a recap a newcomer can actually read: what got built, why, and how the pieces connect -- grounded in the real commit messages and the real current-state code, never invented. Ships as two artifacts from one pass of research:

1. **A published Claude Artifact** -- the primary, interactive deliverable. Visual, diagram-rich, written for someone new to the codebase.
2. **A markdown twin in `docs/changelog/`** -- the permanent, git-tracked record. Same substance, plain markdown + mermaid fences (GitHub renders these natively), so the recap survives even if the artifact link is never opened again.

Both come from the same research pass -- do the reading once, then produce both outputs. Don't let the markdown twin become a lesser afterthought: it's the one that outlives this conversation.

## When this fires

- The user asks to recap / summarize / document / explain "the last phase," "what we just built," a specific phase number, or a commit range that turns out to be one phase's worth of milestones.
- `/phase-recap` invoked directly, optionally with a phase number (`/phase-recap 3`) or an explicit commit range.

## Step 1 — Find the commit range

```
git log --oneline -30
```

This repo's convention (see recent history) is commit subjects starting `Phase <N> ...` (e.g. `Phase 2 M1: vault data schema...`, `Phase 2 macro plan: ...`). Find the contiguous run of commits at the top of history sharing the same `<N>` -- that's the phase. If the user named a specific phase or range, use that instead (`git log --oneline <N>-marker..HEAD` or a literal hash range they gave you).

Don't assume the phase is *finished* -- some milestones may still be pending. Recap exactly the commits that exist; say "through M6" rather than implying completion if the roadmap/plan doc shows more milestones still open. Check `docs/plans/phase-<N>-*.md` for the full milestone list to know what's still ahead, if anything.

## Step 2 — Read every commit, not just its diff stat

For each commit in range:

```
git show --stat <hash>
```

Read the full commit body, not just the file list -- in this repo the body is the single richest source of *why*: design tradeoffs, bugs found and fixed during code review, things verified empirically, deviations from the original plan and why. Do not skip this and rely on file names alone.

Then **read the actual current-state files** the commits touched (via the Read tool, not just the diff) -- prioritize the non-test source files that carry the real logic. The commit message tells you what changed and why; the file itself tells you what's true *now* (later commits in the same range may have amended earlier ones -- e.g. a function signature from an early milestone getting corrected two commits later). Ground every technical claim in what the code says today, not in what a commit message alone implied.

Skim any ADRs, plan-doc sections, or other `docs/` files the commit messages reference by name -- they usually explain the *why* behind a decision more fully than the commit body has room for.

## Step 3 — Find the real structure, don't force diagrams

Before writing anything, identify what's actually diagram-shaped in what you read:

- An architecture/data-flow diagram (who calls whom, where does a write actually land) is almost always worth it once there's more than one layer.
- A key/derivation hierarchy, a state machine, or an end-to-end sequence is worth it if the phase actually built one.
- Don't manufacture a diagram per commit or per section just for symmetry -- a diagram earns its place by showing a real mechanism a paragraph would struggle to make click. Two or three good diagrams beat seven decorative ones.

Mermaid renders natively in both the Artifact and in `docs/changelog/`'s markdown (GitHub) -- no library to load, no image to generate. Use `flowchart` for structure/hierarchy, `sequenceDiagram` for a flow over time. Quote every node label that contains parentheses, colons, or punctuation.

## Step 4 — Write the Artifact

**Load the `artifact-design` skill before writing any HTML** -- this is a required step, not optional, every time this skill runs. Follow its guidance for the treatment: this is a polished documentation/explainer piece (real typographic hierarchy, considered palette, restrained flourishes), not a landing-page pitch. Ground the visual language in the actual subject matter of the phase being recapped -- don't reuse a previous recap's exact palette/type pairing by rote; look at what the phase was actually about and let that suggest the world the design draws from, the way a vault/security phase suggested a blueprint-and-brass-key schematic look.

Structure that has worked well for this repo's recaps:

- A short hero: eyebrow (phase name + commit range), title (a real, specific name for the phase's *subject*, not "Phase N Recap"), one-sentence dek.
- A clickable overview map of the commits in range (this is a genuine sequence with real dependencies, so numbering it is earning its keep, not decorating).
- One section per commit: what it built, in plain language with an analogy where it helps a newcomer, a compact file table (path + one-line purpose, skip test files), and any commit-specific detail worth keeping (a real bug found and fixed, a design tradeoff, something verified empirically rather than assumed).
- The 2-3 diagrams from Step 3, placed where they're most load-bearing, each with a short figure caption.
- A short glossary of any terms a newcomer would stumble on.
- A footer stating the exact commit range covered and that it was compiled from real git history.

Write the content in whatever language the user has been using in the conversation. Default tone: simple, welcoming to someone new to the codebase, analogies where they clarify a real mechanism -- but every claim still has to trace back to an actual commit or an actual line of code. Never invent a file, a function, or a rationale that isn't in the history.

Publish via the `Artifact` tool: a short, specific title (name the phase's actual subject, e.g. "Anatomia do Cofre" for the identity-vault phase -- not a generic "Phase 2 Recap"), a one-sentence `description`, and a favicon emoji that fits the subject.

## Step 5 — Write the markdown twin into `docs/changelog/`

Path: `docs/changelog/phase-<N>-recap.md` (zero-padding not needed -- match `phase-2-recap.md` style).

This is real, permanent project documentation, not a copy-paste of the artifact's HTML -- adapt the same content into plain markdown: normal headings, mermaid code fences (` ```mermaid `), and markdown tables for the file lists. Keep the same substance and tone as the artifact (simple, grounded, diagram-rich) since a clear narrative recap is more useful here than dense ADR-speak -- this file's job is to be the approachable companion to the terse ADRs and plan docs, not a replacement for either.

At the top of the file, link the published Artifact URL for readers who want the interactive version, and state the exact commit range covered.

**First time `docs/changelog/` is created**, add one line to `CLAUDE.md`'s `docs/` index (after the `docs/plans/` line), matching that section's existing style, e.g.:

```
- `docs/changelog/` — plain-language recap of each completed roadmap phase, one file per phase, generated by the `/phase-recap` skill as the readable companion to `docs/adr/` and `docs/plans/`.
```

Don't re-add this line on later runs -- check it isn't already there first.

## Step 6 — Report back, don't commit unasked

Tell the user: the Artifact URL, the path of the new `docs/changelog/` file, and one line on what commit range was covered. Do not `git add`/`git commit` the new doc file unless the user asks -- this skill's job ends at having the file on disk and the artifact published, per this repo's standing rule that commits only happen when explicitly requested.
