---
name: no-ai-slop
description: Detects and removes "AI slop" from written text (marketing copy, LinkedIn posts, docs, emails, landing-page copy) — the recurring word, phrase, structural, tone and formatting patterns that make writing read as machine-generated regardless of who wrote it. Not a word blacklist: the real test is whether each sentence carries specific, verifiable, effort-costing value, or is fluent filler. Use whenever asked to "check for AI slop," "make this sound human," "edit this copy," "audit this text," or before publishing any LinkedIn post, landing page, email, or README.
---

# NO-AI-SLOP — text edition

> Companion to `design-taste-frontend` (which handles *visual* slop — gradients, generic
> cards, glow). This skill handles *textual* slop. Same enemy, different medium.

## 0. The one thing to understand before touching a single word

**AI slop is not defined by which words appear. It's defined by absence of value.**

Multiple independent research threads converge on the same point:

- Northeastern University's Khoury College built a 7-metric taxonomy (density, relevance,
  factuality, bias, structure, coherence, tone) and found the real predictor of "slop" is
  whether text **fails the utility test** — does it actually inform or serve the reader,
  or does it just perform the appearance of informing them. ~35% of sampled AI text failed
  it. Notably, LLMs are bad at catching their own slop because they optimize for
  *correctness*, not reader value.
- Wikipedia's synthesis of the term traces its defining trait to **asymmetric effort**:
  content engineered to look like it took skill, at a fraction of the real cost, optimized
  for attention/engagement rather than communicative intent.
- Practitioner research (a public rules-file + `slop-check` skill, see Sources) found that
  **word blacklists alone fail** — banning "delve" and "moreover" just produces a
  differently-generic voice. What actually works is checking for **structural
  homogeneity**: uniform paragraph length, uniform sentence rhythm, symmetric sections,
  topic→evidence→conclusion on autopilot. Real writing is uneven on purpose.

So this skill runs two passes, in order, and the second one matters more than the first:

1. **Surface pass** — the concrete, bannable patterns (Section 2). Fast, mechanical,
   catches the obvious stuff.
2. **Substance pass** — for every remaining claim, ask: *is there a number, a name, a
   date, a specific mechanism, or a stance someone could disagree with — or is this
   sentence true of literally any product/post/person in this category?* If it's
   interchangeable, it's slop, no banned word required.

A sentence with zero banned phrases can still be 100% slop. A sentence with an em dash
can still be genuinely good writing if the em dash is doing real work (rare, but happens —
this skill's own hard-ban below is the one deliberate exception: on this project, em dash
is banned outright per house style, not "used with restraint").

**The meta-example, so this isn't abstract:** the construction *"It's not X. It's Y."*
shows up as the #1 catalogued AI slop pattern in three independent sources (Peter Yang's
`/no-ai-slop` skill, a public slop-detection rules file, and "The Field Guide to AI
Slop"). It is so recognizable that using it to *describe* AI slop is itself a small joke —
and a good test case: run it through this skill and watch it get flagged.

---

## 1. Modes

State which mode you're in before starting, or ask once if the user didn't say:

- **`audit`** — report findings only, do not edit. Output format in Section 5. Use when
  the user says "check," "review," "audit," or hands you text without asking for a rewrite.
- **`fix`** — apply edits in place, then list what changed and why, grouped by category.
  Use when the user says "fix," "clean up," "make this sound human," "remove the slop."
- **`rewrite`** — same as fix, but for short high-stakes copy (headlines, hooks, CTAs)
  where a patch isn't enough and the line needs to be regenerated from the actual point
  being made, not edited word-by-word.

Default to `fix` if the user just says "run this skill on X" without specifying.

---

## 2. Surface pass — pattern taxonomy

Organized from a merged, deduplicated set of ~50 catalogued patterns across multiple
practitioner audits (see Sources). Not every instance is automatically bad — read the
sentence in context — but each of these is a known tell and should be looked at hard
before being kept.

### 2.A Hard bans (zero tolerance, no "used sparingly" allowance)

| Pattern | Example | Why |
|---|---|---|
| Em dash / double hyphen as punctuation | "the fix — and this matters —" | The single most over-indexed AI tell across every study cited. Use a period, comma, or parentheses. |
| "It's not X. It's Y." / "It's not X, it's Y." | "It's not a bug. It's a feature." | THE canonical slop construction. Rewrite as a direct claim. |
| "Here's the thing" / "Let's be honest" / "Let that sink in" / "Read that again" | — | Permission words. Appear 20-34x more often in AI output than human writing (LinkedIn corpus study). Just say the thing. |
| Colon-reveal drama | "The best part: it learns." | Manufactured suspense for a non-dramatic fact. State it plainly. |
| Fake-profound closers | "The future isn't coming. It's already here." | Dramatic fragment with no content. Cut it or replace with an actual conclusion. |
| Soft-banned vocabulary | "real power," "key insight," "the irony," "hard truth," "game-changer," "cutting-edge," "seamless," "revolutionize," "delve," "leverage" (as verb), "unlock," "elevate" | Statistically overused filler that signals nothing specific. Use the concrete word. |
| Weasel attribution | "experts agree," "studies show," "research indicates" — with no actual citation | Either name the source or delete the claim. |

### 2.B Word-level

- **Significance amplifiers** — inflating a routine change into something monumental ("a
  seismic shift," "fundamentally transforms"). Say what actually changed.
- **Hedge overload** — "arguably," "fairly," "somewhat," stacked until the sentence says
  nothing with confidence. One hedge, if earned, is fine. Three is slop.
- **Filler intensifiers** — "really," "incredibly," "truly" doing no work. Delete and see
  if the sentence loses anything (it won't).
- **Sycophantic openers** — "Great question!" before answering. Just answer.
- **Formal transitions in casual copy** — "moreover," "furthermore," "additionally" where
  a period or "and" would read like a person wrote it.
- **Verb inflation** — "leverage" for use, "utilize" for use, "facilitate" for help, "craft"
  for write/make. Use the plain verb.

### 2.C Phrase-level

- **Manufactured hooks** — "In today's [rapidly evolving / fast-paced] landscape," "It's
  no secret that." Open with the actual specific thing instead.
- **Meta-commentary** — announcing the move instead of making it ("Let's break this
  down," "Here's what you need to know"). Just break it down.
- **Real-truth windups** — "At the end of the day," "when it comes down to it." Cut,
  state the point.
- **Negative parallelism** — contrasting a vague specific against a vaguer generality to
  sound insightful without saying anything. Test: can you name the actual mechanism? If
  not, it's decoration.
- **Patronizing framing** — "most people don't realize," "what nobody tells you." Earns
  deep skepticism from the exact readers whose trust matters (per Peter Yang's research:
  people who know AI spot this from a mile away).
- **Collaborative fake-"let's"** — "Let's explore this together" in one-way copy (a
  landing page, an email). Nobody is exploring together. Drop it.
- **Performative honesty** — "I'll be honest," "not gonna lie" used as a tic rather than
  because something genuinely required admitting.

### 2.D Structural

- **Reflexive rule of three** — always exactly three examples/benefits/steps whether or
  not three is the honest count. If there are two real ones, use two.
- **Symmetric sections** — every section the same length, same internal shape
  (topic sentence → two supporting points → mini-conclusion), same emotional pitch. Real
  writing is uneven because some points need one sentence and some need five.
- **Uniform sentence rhythm** — same length, same clause structure, repeated until it
  reads like a metronome. Vary it. One long sentence next to two short ones reads human;
  a paragraph of identical 12-word sentences doesn't.
- **Section-ending recaps** — restating what a paragraph just said, immediately after
  saying it. Trust the reader.
- **Conclusion mirrors the intro** — opens and closes on the same sentence, reworded.
  Cut one of them, almost always the closing one.
- **Excessive bulleting** — turning argument into bullet fragments that flatten nuance and
  relationships between ideas. If the ideas connect causally, write a sentence.
- **Topic → evidence → conclusion on autopilot** — the five-paragraph-essay shape applied
  mechanically to a LinkedIn post or landing page section. Fine for an essay, wrong
  register for casual/persuasive copy.

### 2.E Tone

- **Relentless uniform positivity** — identical enthusiasm for the big launch and the
  typo fix. Modulate energy to match actual stakes.
- **Default redemption arc** — every negative finds a silver lining. Sometimes something
  is just bad; say so.
- **Manufactured vulnerability** — "I'll admit this scared me" deployed as a rhetorical
  device rather than an actual admission. Readers can tell the difference.
- **Excessive formality in casual contexts** — parliamentary language in a Slack-register
  post. Match the actual register of the platform/audience.

### 2.F Formatting

- **Bold-as-decoration** — bolding random phrases in body text for false emphasis with no
  semantic reason. Bold should mark something a skimmer needs, not everything that felt
  important while writing.
- **Emoji in professional/technical copy** — unless the brand voice explicitly uses them.
- **Uniform single-sentence line breaks** — a LinkedIn-specific tell: one sentence per
  line for the entire post. 91% of AI-generated LinkedIn posts do this (see Section 3).
  Vary paragraph shape.

### 2.G Content / substance (the pass that actually matters — see Section 0)

- **Vague attribution** — citing "research" or "a study" with no source. Name it or cut it.
- **Semantic hollowness** — a sentence that sounds intelligent but, read literally, claims
  nothing checkable ("this represents a meaningful step forward for the industry"). Ask:
  what specifically changed, for whom, measured how?
- **Explaining significance instead of demonstrating it** — "this is a huge deal because
  it matters a lot" instead of the actual number/mechanism that makes it matter.
- **Avoiding specifics to hide thin knowledge** — staying general because a concrete
  example would expose that the writer doesn't actually know the detail. If you (Claude)
  don't know the specific number/name/date, say so or ask, don't paper over it with a
  vaguer sentence.
- **Interchangeability test** — could this exact sentence appear verbatim in a
  competitor's post/page about a different product, unchanged? If yes, it's slop
  regardless of how well-written it is.

---

## 3. LinkedIn-specific module

LinkedIn is the single most slop-saturated format right now (platform is actively
cracking down on it as of 2026), and it has its own well-documented tells on top of
everything above. Apply this module whenever the text is or resembles a LinkedIn post.

**The three AI hook templates that cover ~82% of AI-generated LinkedIn openers — avoid
all three as a default:**
1. Contrarian setup ("Everyone thinks X. They're wrong.")
2. Humble-brag confession ("I almost quit last year. Here's what changed.")
3. Shock statement ("This one email cost me $50k.")

Open instead with a specific event, number, or observation that only the actual author
could have written — something a competitor couldn't paste into their own post unchanged.

**Six edits to run on any LinkedIn draft before publishing:**
1. Replace the hook (see above).
2. Cut permission words ("Here's the thing," "Let that sink in," "Read that again").
3. Break the uniform one-sentence-per-line rhythm — let at least one line run long.
4. Add one verifiable, specific data point, followed by your actual interpretation of it.
5. Insert one disputable opinion and one detail only your specific experience produces.
6. Delete the closing recap / "takeaways" list / engagement-bait question. Let it end on
   the actual last point, unresolved tension included.

---

## 4. Voice preservation (don't just produce a different slop)

The point is not to sound like a different, differently-generic voice after editing.
Guardrails:

- **Keep real hedges.** "I think," "usually," "sort of" are honest qualifiers when the
  writer is genuinely uncertain — cutting all of them produces false confidence, which is
  its own tell. The rule is: cut *performative* hedging that pads without meaning
  anything, keep *load-bearing* hedging that's doing real epistemic work.
- **Keep the author's actual quirks.** If the existing voice has a specific rhythm,
  in-jokes, or idiosyncratic phrasing, preserve it. This skill removes slop, it does not
  impose a "correct" neutral house style.
- **Don't over-correct into contrarianism-for-its-own-sake.** Adding a "disputable
  opinion" per Section 3 means an honest one you actually hold, not manufactured edge.
- **One clean pass beats mechanical rule-following.** If applying every rule in Section 2
  to a paragraph would make it read worse or less like the person who wrote it, don't
  apply all of them. Read Section 0 again: the target is value and specificity, the rules
  are diagnostic tools for finding where value is missing, not a checklist to satisfy for
  its own sake.

---

## 5. Output format

**`audit` mode:**

For each finding: quote the exact phrase/sentence, name the category (2.A-2.G or "3" for
LinkedIn-specific), and state the fix in one line. Group by severity: hard bans first,
then structural, then substance-level (which are usually the most important even though
they sound least "wrong" on a first read). End with one line on whether the piece passes
the interchangeability test (Section 2.G) as a whole — could this have been written about
a different product/person with a search-and-replace of the name.

**`fix` / `rewrite` mode:**

Apply the edits. Then list what changed, grouped by category, one line per group (not
one line per edit — "cut 4 permission words," not four separate bullets). Flag anything
you removed that might have been intentional voice rather than slop, so the user can put
it back if you read it wrong.

---

## Sources

Research synthesized from, in order of use above:
- [Khoury College of Computer Sciences — what makes text "slop"](https://www.khoury.northeastern.edu/ai-slop-is-a-common-online-nuisance-but-what-makes-a-piece-of-text-slop/) — the utility-test / 7-metric taxonomy study.
- [Wikipedia — AI slop](https://en.wikipedia.org/wiki/AI_slop) — origin, definition, asymmetric-effort framing.
- [Peter Yang, creatoreconomy.so — the `/no-ai-slop` skill](https://creatoreconomy.so/p/use-my-no-ai-slop-skill-to-remove-20-ai-slop-patterns) — the original 10+ pattern list and the "It's not X, it's Y" canonical example.
- [Momentic — 34 types of AI slop](https://momenticmarketing.com/blog/avoid-ai-slop) — the full word/phrase/structural/tone/formatting/content taxonomy merged into Section 2.
- [Public slop-detection rules file + `slop-check` skill (gist)](https://gist.github.com/archvalmiki/1aecb1b1be01f0ae77ce95e7a13aa449) — the "word blacklists alone fail, structure matters more" finding, and the 3-phase detection process this skill's modes are based on.
- [SocialNexis — the six edits that matter for LinkedIn](https://socialnexis.com/guides/ai-post-edit-tells-linkedin) — Section 3, including the 82%/91% figures on hook templates and line-break uniformity.
- [Charlie Guo — The Field Guide to AI Slop](https://www.ignorance.ai/p/the-field-guide-to-ai-slop) — "surface polish with nothing underneath," specificity/tangible-experience/point-of-view as the actual antidote.
- [Forbes — What LinkedIn's AI slop crackdown means for your posts](https://www.forbes.com/sites/jodiecook/2026/08/10/what-linkedins-ai-slop-crackdown-means-for-your-posts/) — platform-level context for Section 3.
