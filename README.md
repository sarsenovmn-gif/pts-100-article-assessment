# PTS · Publication Trust Score (v6, strict · two-pass)

A Next.js web app that assesses a single publication on **two independent
100-point scores**:

- **PTS-A — Antisemitism Score**, based on the **IHRA Working Definition of
  Antisemitism** plus Natan Sharansky's **3D test** (Demonization, Double
  standards, Delegitimization). Criteria AS1–AS6.
- **PTS-J — Journalistic Standards Score**, based on the **IMPRESS Standards
  Code** plus an explicit **Block S** sourcing/corroboration/transparency layer.
  Criteria J1–J11, Block S (S1–S5) and a conduct block (JD).

The two scores are **never blended**. The UI shows both side by side, plus a
convenience "weakest link" headline (`min(PTS-A, PTS-J)`).

Give it an article by URL or pasted text. The app extracts the publication into
labelled sections, **normalises a copy for matching**, runs a deterministic
**coded-language pre-scan** and **prompt-injection scan**, then assesses the text
with a **two-pass model architecture** (an adversarial *prosecutor* for recall,
followed by a conservative *judge* for precision) before a **deterministic scorer**
verifies every piece of evidence, resolves designated organisations from versioned
lists, and applies the PTS rules exactly. The model never computes a number.

## Governing principle

> **Absence of a detected violation is not equivalent to demonstrated
> compliance.** A `PASS` must be *earned* by active assessment, and a definitive
> **100** must be rare, auditable and defensible.

Concretely, the model never computes a number. It returns graded, evidence-backed
severities; software turns those into two scores and — crucially — refuses to
award a perfect 100 unless coverage, confidence and completeness thresholds are
all met (see *the definitive-100 gate* below).

## Graded severity

Every applicable criterion gets one of:

| Severity | Score retention | Meaning |
| --- | --- | --- |
| `PASS` | 100% | Actively assessed; no material concern. |
| `MINOR` | 75% | Limited weakness; meaning/reliability largely intact. |
| `MODERATE` | 50% | Meaningful problem; could affect interpretation. |
| `MAJOR` | 25% | Significant problem affecting a central claim. |
| `SEVERE` | 0% | Fundamental or highly serious breach. |
| `UNRESOLVED` | — | Relevant, but evidence is insufficient/ambiguous/unverifiable. Never converted to a PASS. |
| `NOT_APPLICABLE` | — | Genuinely does not apply. Never used merely because nothing was found. |

Retention factors live in `SEVERITY_RETENTION` (`src/lib/rubric.ts`) and are
configurable.

## The two scorecards

### PTS-A — Antisemitism (IHRA + 3D), 100 points

| Criterion | Points | Scope |
| --- | --- | --- |
| **AS1** | 20 (critical) | Violence & incitement (IHRA 1) |
| **AS2** | 20 | Collective tropes / conspiracy / control / imagery (IHRA 2) |
| **AS3** | 15 | Collective responsibility & dual loyalty (IHRA 3, 6, 11) |
| **AS4** | 20 (critical) | Holocaust denial & distortion (IHRA 4, 5) |
| **AS5** | 15 (contested) | Israel-related — IHRA 7–10 / 3D (always human review) |
| **AS6** | 10 | Amplification & gratuitous identity |

The **Sharansky 3D** findings are mapped into the relevant AS criterion (usually
AS5, sometimes AS2/AS6) — there is **no** separate 3D score and no double-counting.

### PTS-J — Journalistic standards (IMPRESS + sourcing), 100 points

Accuracy 30 + Transparency 15 + Public interest 5 + Conduct 10 + Block S 40.

| Criterion | Points | Scope |
| --- | --- | --- |
| **J1** | 14 | Accuracy (1.1/1.4); `fabrication` for invented facts/quotes |
| **J2** | 7 | Fact vs opinion (1.3) |
| **J3** | 5 | Corrections with due prominence (1.2) |
| **J4** | 4 | Headline/standfirst match body (1.5) |
| **J7** | 6 | Conflicts of interest & ownership (10.2) |
| **J8** | 4 | Sponsored content labelled (10.1) |
| **J9** | 2 | Financial information (10.3) |
| **J10** | 3 | Failure to disclose corrected (10.4) |
| **J11** | 5 | Public-interest justification |
| **S1** | 12 | Attribution integrity (incl. headline/lead) |
| **S2** | 6 | Source interest disclosed |
| **S3** | 8 | Corroboration |
| **S4** | 4 | Materially disputed claims |
| **S5** | 10 | Designated-source reliance — **deterministic**, never model-decided |
| **JD** | 10 | Conduct clauses 3, 5, 6, 7, 8, 9 (graded deduction per breach) |

## Two-pass assessment (prosecutor → judge → scorer)

The single assessment call is split into two model roles with opposite biases,
then a deterministic scorer. This raises recall on evasive/coded content without
sacrificing precision, and it makes disagreement measurable.

1. **Prosecutor (recall).** Runs `PTS_PROSECUTOR_RUNS` times (default **3**) at a
   higher temperature (default **0.7**) on `PTS_PROSECUTOR_MODEL`. Its prompt is
   the PTS prompt with the leniency removed and adversarial reading instructions
   added: build the strongest possible case that each criterion *fails*, listing
   exact quotes, the apparent stance and the IHRA examples. Every lexicon pre-scan
   hit must appear either as an allegation or in an explicit `dismissed_lexicon_hits`
   with a reason. The prosecutor **never** computes a score. The runs are unioned by
   `(criterion, normalised first quote)`, and each merged allegation records which
   runs it appeared in.
2. **Judge (precision).** Runs once at temperature **0** on `PTS_JUDGE_MODEL` (a
   strongest-Sonnet-class model, falling back to a smaller model only if the API
   rejects it). It sees the full text and the merged allegations and **never invents
   new ones** — it only `CONFIRM`s, `DOWNGRADE`s or `REJECT`s each, applying the full
   caveats (the single IHRA caveat, the stance gate, opinion partisanship, public
   interest, the `not_indicator` list). The judge must **quote the rule it applied**
   in its `reason` (e.g. *"stance gate: COUNTERED"*, *"endorsement marker: 'rightly'"*),
   and assigns a graded severity to each surviving allegation.
3. **Scorer (deterministic).** Only `CONFIRMED`/`DOWNGRADED` verdicts become
   criteria; the scorer then verifies quotes, applies the stance gate, caps and the
   definitive-100 gate exactly as before. A **new** rule: an `UNCRITICAL_AMPLIFICATION`
   failure of AS1–AS5 deducts **half** the points of the equivalent own-voice failure.

**Consistency index.** `confirmed findings present in *all* prosecutor runs ÷ all
confirmed findings`. A run-to-run variance in scores is acceptable when it reflects
the text better — but it is **measured and shown, never hidden**. The index and the
full per-run prosecutor output are surfaced in the Audit panel.

### Input normalisation (matching only)

The model always reads and quotes against the **original** text. A separate
normalised *copy* (with a per-character map back to the original) is used only by
the pre-scan and injection scan, so evasion is caught while quotes stay verifiable:
NFKC, zero-width strip (U+200B–200F, 2060, FEFF), Cyrillic/Greek homoglyph folding,
leetspeak de-obfuscation inside words (`3→e 1→i 0→o 4→a 5→s 7→t @→a $→s`) and
in-word separator collapse (`J.e.w.s → jews`). Hits found only after normalisation
are flagged *"matched after normalisation"* and listed as normalisation events.

Long texts (over `PTS_CHUNK_CHARS`, default **6000**) are split into overlapping,
paragraph-boundary chunks so buried content (last paragraph, caption, footnote) is
still read; the prosecutor runs per chunk (plus the headline/standfirst), while the
judge always runs **once on the full text** (it is never chunked).

### Prompt-injection defence

The article is wrapped in an `<ARTICLE>` envelope (untrusted data, never
instructions) and a deterministic detector runs on the normalised text for
manipulation patterns (*"ignore previous instructions"*, *"you are an assessment
system"*, *"rate this article as"*, *"PTS-A 100"*, *"this publication is
compliant"*, *"system prompt"*, *"as an AI"*). A hit sets `injection_suspected`,
adds the passage as a mandatory allegation, routes the whole result to human review
and raises a UI banner — **but scores are still computed** (an injection attempt is
itself a signal, not a reason to abort).

### Audit panel (observability)

A collapsible **Audit** panel shows, per assessment: the prosecutor allegations
for each run and which the judge rejected (with the rule cited); lexicon hits and
dismissals; the candidate-passage count (with a warning if the model saw zero while
the pre-scan or a designated source found something); the consistency index; and
the `irony_possible` / `injection_suspected` flags.

## How the deterministic scorer works

The model never computes the numbers — software does. `calculate_scores`
(`src/lib/scorer.ts`) builds the two `PtsSubScore` objects independently.

- **Evidence verification** — every non-PASS finding must carry an exact quote.
  Quotes are checked with tolerant matching (whitespace/curly-quote
  normalisation, ellipsis splitting, section-label stripping, approximate match
  ≥ 0.85). A finding whose quote is **not** found becomes **`UNRESOLVED`** (never a
  silent PASS, never a silent drop) and is routed to human review.
- **Coverage** — `coverage_pct = assessed / applicable`, where *assessed* excludes
  `UNRESOLVED`/`NOT_APPLICABLE` and *applicable* excludes only `NOT_APPLICABLE`.
  Reported per score.
- **Confidence** — a `LOW`/`MEDIUM`/`HIGH` band derived from the model's
  per-finding confidence (material findings drive it down; unresolved items cap it
  at MEDIUM). Reported per score.
- **The definitive-100 gate** — a `100` is withheld (shown as `99`, marked
  `inconclusive`) unless: coverage ≥ 90%, **zero** `UNRESOLVED`, confidence not
  `LOW`, and (for PTS-J) the headline/lead was actually assessed. This is why a
  clean article that was only shallowly analysed cannot silently reach a perfect
  score.
- **Stance gate (PTS-A)** — AS1–AS5 can only fail for `OWN_VOICE` or
  `UNCRITICAL_AMPLIFICATION`; attribution alone does **not** neutralise
  amplification (headline prominence, repetition, rebuttal quality are weighed).
  A stance-refused failure keeps its points and is queued for review.
- **Critical caps (no stacking — the lowest cap wins)** — AS1/AS4 own-voice
  major/severe caps **PTS-A at 39**; J1 fabrication caps **PTS-J at 39**; S5 rung 1
  or an S1 headline hard rule caps **PTS-J at 59**.
- **Coded-language pre-scan + adjudication** — a deterministic, versioned lexicon
  (`data/lexicon.json`) flags coded tropes with a ±200-char context window. **A hit
  is never a deduction by itself** — the model must adjudicate each one in context.
  A confirmed trope must appear as a finding; a **hard** hit dismissed in own voice,
  or left un-adjudicated, is forced to human review ("lexicon override").
- **Designated-source resolution (S5)** — source names are resolved *only* against
  versioned official lists (`data/designated_orgs.json`); **the model never decides
  designation**. S5 is a decision ladder: rung 1 (designated source presented as
  fact) → SEVERE + cap 59; rung 2 (attributed, control undisclosed) → MAJOR; rung 3
  (disclosed, not marked unverified) → MODERATE half-deduction; rung 4 (disclosed +
  marked unverified) and rung 5 (independently corroborated) → no deduction.
  Wing-specific designations (e.g. Hezbollah military wing only) and controlled
  bodies (with documented evidence) are preserved.
- **Conduct block (JD)** — privacy/harassment clauses require a specific identified
  person; a graded deduction applies per verified breach; an unverifiable breach is
  rejected and queued.
- **Provenance** — every result carries the rubric version, lexicon version,
  designation-list versions, model, run id, input hash, coverage and confidence.
- **Legal flag** — a routing flag only (`INCITEMENT`/`HOLOCAUST_DENIAL`), never a
  legal finding and never part of either score.

## Designations

- **ARTICLE** — news publication (all AS + all J/S + JD).
- **OPINION** — op-ed/editorial: J1 applies to factual claims presented as fact (a
  partisan conclusion is not itself an inaccuracy); J4 and sourcing still apply;
  the author's own prose is own voice for PTS-A.
- **POST** — social media; PTS-A in full, PTS-J on J1/J2 + Block S + JD.
- **DOCUMENTARY** — research/monitoring; scored like an article.
- **SATIRE** — labelled, **not** scored (both scores `null`).

## Model providers & the mock safety rule

Provider selection order:

1. **OpenRouter** — if `OPENROUTER_API_KEY` is set.
2. **Anthropic** — if `ANTHROPIC_API_KEY` is set.
3. **Mock** — dev/test only.

The mock provider **must never produce a production result.** With no real key the
API returns **`ANALYSIS_UNAVAILABLE`** (HTTP 503) instead of a score — it never
fabricates a passing `100/100`. The mock is only enabled for local development and
tests when `PTS_ALLOW_MOCK=1`.

The prosecutor and judge can use different models (`PTS_PROSECUTOR_MODEL`,
`PTS_JUDGE_MODEL`); both go through the same provider abstraction with a forced tool
call and a model-fallback on a bad-model rejection. Two-pass is on by default
(`PTS_TWO_PASS=1`); setting it to `0` falls back to the original single-pass call.
Note that N prosecutor runs plus a judge is **≥ 4 model calls per assessment**, so
it is slower and more expensive than single-pass.

## Getting started

```bash
npm install
cp .env.example .env.local   # add a model key for real scoring
npm run dev
```

The dev server runs on port **43127** → http://localhost:43127

## Tests

```bash
npm run selftest        # 38-fixture deterministic regression suite
npm run test:adversarial # 15 offline adversarial checks (normalise/injection/two-pass)
npm run demo:bad        # offline synthetic fixture through the full two-pass flow
npm run test:endpoint   # live integration test (needs the dev server + a key)
```

The **15 adversarial checks** (`src/lib/adversarial.selftest.ts`, over the
synthetic fixtures in `tests/adversarial/`) cover the code-side pieces that do not
need a model: leetspeak/homoglyph/zero-width normalisation and the position map,
prompt-injection detection + routing (with no false positives on clean text),
overlapping chunking of a 9k-char buried-content fixture, the prosecutor-run union
and consistency index, and building + scoring a split-trope (one finding, three
verified quotes), a "some say" amplification (half deduction), a countered trope
(no deduction) and an unverifiable quote (UNRESOLVED, not a deduction).

The **38 regression fixtures** (`src/lib/scorer.selftest.ts`) cover: core scoring
& severity retention, the coverage/confidence/definitive-100 gate, critical caps
(no stacking), the lexicon pre-scan/adjudication (including "keywords alone never
deduct"), IHRA/3D mapping and the AS5 stance gate, Block S sourcing, the S5
designated-source ladder (including wing distinctions, controlled bodies and
multi-authority lists), and the OPINION/POST/SATIRE designation profiles.

`BASE_URL=https://pts-100-article-assessment.vercel.app npm run test:endpoint`
runs the same assertions against production. `?debug=1` (or `PTS_DEBUG=1`) adds the
raw model assessment, provider, `stop_reason`/usage, lexicon hits and org
resolutions to the API response.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Enables the Anthropic path. |
| `OPENROUTER_API_KEY` | Enables the OpenRouter path. |
| `PTS_MODEL` / `OPENROUTER_MODEL` | Override the (single-pass) model. |
| `ANTHROPIC_BASE_URL` / `OPENROUTER_BASE_URL` | Custom/regional endpoints. |
| `PTS_ALLOW_MOCK` | `1` enables the dev/test mock (never in production). |
| `PTS_DEBUG` | `1` adds debug payloads to API responses. |
| `PTS_TWO_PASS` | `1` (default) prosecutor→judge→scorer; `0` = single pass. |
| `PTS_PROSECUTOR_MODEL` | Recall-pass model (default `claude-haiku-4-5`). |
| `PTS_PROSECUTOR_RUNS` | Prosecutor runs to union (default `3`). |
| `PTS_PROSECUTOR_TEMPERATURE` | Prosecutor temperature (default `0.7`). |
| `PTS_JUDGE_MODEL` | Precision-pass model (default strongest Sonnet-class). |
| `PTS_JUDGE_RUNS` | Judge runs; majority-confirm if > 1 (default `1`). |
| `PTS_CHUNK_CHARS` / chunk overlap | Chunking threshold (default `6000` / `600`). |

## Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

Add `ANTHROPIC_API_KEY` **or** `OPENROUTER_API_KEY` under
**Project → Settings → Environment Variables**.

A full two-pass assessment takes roughly two to ten minutes, so the API route
exports `maxDuration = 300` (`src/app/api/assess/route.ts`). That value needs a
paid Vercel plan; on Hobby, lower it to `60` and set
`PTS_JUDGE_MODEL=claude-haiku-4-5` to fit the shorter limit. On a paid plan
leave `PTS_JUDGE_MODEL` unset so the stronger default judge applies, and check
the project's Function Max Duration ceiling in **Project → Settings →
Functions** before raising `maxDuration` further.

## Limitations (read before relying on the output)

PTS is an **analytical decision-support framework, not a legal determination** and
not a substitute for expert human judgement. It is **text-only in this iteration:
there is no web access, browsing, search or retrieval** — a URL is fetched once for
extraction and nothing else leaves the box. In particular:

- **Scores can vary run to run.** The prosecutor runs at a non-zero temperature, so
  the same text can surface slightly different findings on different runs. This
  variance is a feature of better recall, not a bug — it is **measured and shown**
  via the consistency index and the per-run Audit panel, never hidden. Treat a low
  consistency index as a prompt to have a human look.
- **Unsignalled irony is assessed literally.** Sarcasm is only treated as ironic
  when the text itself signals it; otherwise the passage is assessed at face value
  and flagged `irony_possible` for the reviewer, because a confident irony call on
  ambiguous text is how real antisemitism gets excused.
- **Prompt-injection is detected, not trusted.** Text that tries to instruct the
  assessor is flagged and routed to a human; it never changes the score.

- **The lexicon is a seed.** `data/lexicon.json` is a small, English-only starter
  set that **requires expert review and expansion** before production use. Coded
  language is highly context-dependent; the patterns are *indicators only* and are
  deliberately never scored on their own.
- **Designation lists are seeds and go stale.** `data/designated_orgs.json` is a
  small sample. Real designation lists must be **refreshed periodically**, and
  **different authorities designate different entities and scopes** (e.g. the EU
  designates only Hezbollah's military wing). Controlled-body relationships require
  documented evidence and are intentionally conservative.
- **No external fact-checking.** The system cannot verify claims against external
  reality. Where independent verification would be required but is unavailable, the
  criterion is `UNRESOLVED` rather than assumed true or false.
- **The model can be wrong.** Severities, stance classifications and 3D
  adjudications are model judgements; that is precisely why coverage, confidence,
  unresolved counts, quote verification and human-review routing exist. Contested
  (AS5) and critical (AS1/AS4) findings are always routed to a human.
- **The 3D double-standards test needs a real comparison basis** — one-sidedness,
  hostility or omission of other countries is *not* itself a double standard, and
  ordinary war-crime/human-rights allegations are not demonization by appearance.
- **Scores are not directly comparable across designations** (different applicable
  criteria and coverage), and the "weakest link" headline is a convenience, not a
  combined score.

## Project structure

```
data/
  lexicon.json            # versioned coded-language pre-scan lexicon (seed)
  designated_orgs.json    # versioned designated-org resolution dataset (seed)
src/
  app/
    page.tsx              # client UI (URL / paste, designation, language)
    api/assess/route.ts   # POST: extract + pre-scan + assess + score
  components/
    results-panel.tsx     # two scores, coverage/confidence, findings, review
  lib/
    rubric.ts             # prompt, tool schema, points, profiles, caps, gate, two-pass consts
    scorer.ts             # deterministic calculate_scores + evidence verification
    lexicon.ts            # load + deterministic pre-scan (on the normalised copy)
    designations.ts       # deterministic org/alias/controlled-body resolver
    extract.ts            # URL / raw-text extraction, OPINION detection
    normalise.ts          # NFKC/homoglyph/leet normalisation + injection detector
    chunk.ts              # overlapping paragraph-boundary chunking
    provider.ts           # provider abstraction: forced tool call + model fallback
    twopass.ts            # prosecutor/judge prompts+schemas, merge, consistency, buildAssessment
    assess.ts             # normalise+prescan+two-pass orchestration; mock -> ANALYSIS_UNAVAILABLE
    scorer.selftest.ts    # 38-fixture regression suite
    adversarial.selftest.ts # 15 offline adversarial checks
    types.ts              # PtsSubScore, Scores, Assessment, Prosecution, Judgement, AuditData, ...
tests/
  adversarial/            # synthetic adversarial fixtures (never dataset/real text)
scripts/
  selftest.mjs            # `npm run selftest`
  adversarial.mjs         # `npm run test:adversarial`
  demo.mjs                # `npm run demo:bad`
  endpoint.test.mjs       # `npm run test:endpoint`
```
