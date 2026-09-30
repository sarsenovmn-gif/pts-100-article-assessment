# PTS · Publication Trust Score (v6, strict)

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
labelled sections, runs a deterministic **coded-language pre-scan**, sends it to a
model with a forced, structured tool call, then runs a **deterministic scorer**
that verifies every piece of evidence, resolves designated organisations from
versioned lists, and applies the PTS rules exactly.

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

## Getting started

```bash
npm install
cp .env.example .env.local   # add a model key for real scoring
npm run dev
```

The dev server runs on port **43127** → http://localhost:43127

## Tests

```bash
npm run selftest      # 38-fixture deterministic regression suite
npm run demo:bad      # offline synthetic antisemitic fixture through the scorer
npm run test:endpoint # live integration test (needs the dev server + a key)
```

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
| `PTS_MODEL` / `OPENROUTER_MODEL` | Override the model. |
| `ANTHROPIC_BASE_URL` / `OPENROUTER_BASE_URL` | Custom/regional endpoints. |
| `PTS_ALLOW_MOCK` | `1` enables the dev/test mock (never in production). |
| `PTS_DEBUG` | `1` adds debug payloads to API responses. |

## Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

Add `ANTHROPIC_API_KEY` **or** `OPENROUTER_API_KEY` under
**Project → Settings → Environment Variables**.

## Limitations (read before relying on the output)

PTS is an **analytical decision-support framework, not a legal determination** and
not a substitute for expert human judgement. In particular:

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
    rubric.ts             # prompt, tool schema, points, profiles, caps, gate consts
    scorer.ts             # deterministic calculate_scores + evidence verification
    lexicon.ts            # load + deterministic pre-scan with context windows
    designations.ts       # deterministic org/alias/controlled-body resolver
    extract.ts            # URL / raw-text extraction, OPINION detection
    assess.ts             # provider call, mock gating -> ANALYSIS_UNAVAILABLE
    scorer.selftest.ts    # 38-fixture regression suite
    types.ts              # PtsSubScore, Scores, Assessment, Severity, ...
scripts/
  selftest.mjs            # `npm run selftest`
  demo.mjs                # `npm run demo:bad`
  endpoint.test.mjs       # `npm run test:endpoint`
```
