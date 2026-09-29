# PTS · Publication Trust Score

A Next.js web app that assesses a single publication on **two independent
100-point scores**:

- **PTS-A — Antisemitism Score**, based on the **IHRA Working Definition of
  Antisemitism** (criteria AS1–AS6).
- **PTS-J — Journalistic Standards Score**, based on the **IMPRESS Standards
  Code** (criteria J1–J11 plus a conduct block, JD).

The two scores are **never blended**. The UI shows both side by side, plus a
convenience "weakest link" headline (`min(PTS-A, PTS-J)`).

Give it an article by URL or pasted text. The app extracts the publication into
labelled sections, sends it to a model with a forced, structured tool call, then
runs a **deterministic scorer** that verifies every piece of evidence and applies
the PTS rules exactly. It descends from the reference Python pipeline
(`team14-solutionV4.py`), upgraded to the two-score model.

### Model providers

The app selects a provider in this order:

1. **OpenRouter** — if `OPENROUTER_API_KEY` is set (OpenAI-compatible function
   calling; default model `anthropic/claude-haiku-4.5`).
2. **Anthropic** — if `ANTHROPIC_API_KEY` is set (Messages API + tool use;
   default model `claude-haiku-4-5`).
3. **Mock** — if neither is set, a clearly-labelled all-PASS assessment so the
   flow is still usable with no credentials.

> Note: the original Team 14 spec forbids third-party routers. OpenRouter support
> is opt-in for convenience/testing; use the Anthropic path for spec compliance.

## The framework

### PTS-A — Antisemitism (IHRA), 100 points

| Criterion | Points | Scope |
| --------- | ------ | ----- |
| **AS1** | 20 (critical) | Violence & incitement (IHRA 1) |
| **AS2** | 20 | Collective tropes & imagery (IHRA 2) |
| **AS3** | 15 | Collective responsibility & dual loyalty (IHRA 3, 6, 11) |
| **AS4** | 20 (critical) | Holocaust denial & distortion (IHRA 4, 5) |
| **AS5** | 15 (contested) | Israel-related (IHRA 7, 8, 9, 10) |
| **AS6** | 10 | Amplification & gratuitous identity (EJN; IMPRESS 4.2) |

### PTS-J — Journalistic standards (IMPRESS), 100 points

80 criteria points (J1–J11) + a 20-point conduct block (JD). Clause 4
(Discrimination) is **not** part of PTS-J — it lives entirely in PTS-A.

| Criterion | Points | Scope |
| --------- | ------ | ----- |
| **J1** | 20 | Accuracy — no inaccuracy/distortion (1.1/1.4) |
| **J2** | 10 | Fact vs opinion (1.3) |
| **J3** | 8 | Corrections with due prominence (1.2) |
| **J4** | 7 | Headline/standfirst match body (1.5) |
| **J5** | 7 | Attribution, no plagiarism (2.1) |
| **J6** | 3 | Failure to credit corrected (2.2) |
| **J7** | 8 | Conflicts of interest & ownership (10.2) |
| **J8** | 6 | Sponsored content labelled (10.1) |
| **J9** | 3 | Financial information (10.3) |
| **J10** | 3 | Failure to disclose corrected (10.4) |
| **J11** | 5 | Public-interest justification |
| **JD** | 20 | Conduct clauses 3, 5, 6, 7, 8, 9 (start 20, −10 per breach) |

### How the deterministic scorer works

The model never computes the numbers — software does. `calculate_scores`
(see `src/lib/scorer.ts`) produces the two `PtsSubScore` objects independently:

- **NOT_ASSESSABLE** criteria are excluded from that score's possible total, and
  the score is rescaled to 100 (so a clean article with unassessable criteria can
  still reach 100 while its coverage is below 100).
- **Evidence verification** — every `FAIL` must carry a quotation. Each quote is
  checked against the article text with tolerant matching (whitespace/curly-quote
  normalisation, ellipsis splitting, section-label stripping, and approximate
  matching ≥ 0.85). A failure whose quote is **not** in the text is *rejected*
  (no deduction, points kept) and queued for human review.
- **Stance gate (PTS-A only)** — AS1–AS5 cannot fail unless the offending passage
  is `OWN_VOICE` or `UNCRITICAL_AMPLIFICATION`. Failures attributed to
  `REPORTED_CONTEXTUALISED` or `COUNTERED` material are rejected and queued. A
  `FAIL` with `failure_stance: NONE` inherits `overall_stance`.
- **Critical caps** — an **AS1** or **AS4** failure in the publication's own
  voice caps **PTS-A** at **39**. **Fabrication** (J1, or a fabricated source
  under conduct clause 8) caps **PTS-J** at **39**.
- **Human review routing** — AS1, AS4 and AS5 failures, any `human_review_required`
  flag, the contested zone (AS5), and any accepted failure with confidence below
  `0.5` are routed to a de-duplicated review queue (per score).
- **Conduct block (JD, PTS-J)** — starts at 20; each verified engaged-and-breached
  clause deducts 10 (floor 0). An unverifiable breach is rejected and queued.
- **Legal flag** — a separate routing flag (`INCITEMENT` / `HOLOCAUST_DENIAL`),
  never a legal finding, and never part of either score.

### Designations

- **ARTICLE** — journalistic/editorial publication (all AS + all J + JD).
- **POST** — social-media content; PTS-A in full, PTS-J on J1, J2, J5 and JD only.
- **DOCUMENTARY** — research/monitoring material; scored like an article.
- **SATIRE** — labelled, **not** scored (both `PtsSubScore.score` are `null`).

### Tier bands

**PTS-A:** `≥100` No indicators · `≥75` Minor concerns · `≥60` Amplification or
contested · `≥40` Antisemitic content present · else Severe.

**PTS-J:** `≥100` Compliant · `≥75` Generally compliant · `≥60` Compliant with
exceptions · `≥40` Breach · else Serious breach.

## Getting started

```bash
npm install
cp .env.example .env.local   # add a model key (optional)
npm run dev
```

The dev server runs on port **43127** → http://localhost:43127

Without `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` the app runs entirely on a
clearly-labelled **mock** assessment, so you can explore the full flow with no
credentials.

## Self-test

The deterministic scorer ships with an 8-scenario self-test (`a`–`h`):

```bash
npm run selftest
```

It verifies: (a) a clean article reaching PTS-A 100 / PTS-J 100 with PTS-J
coverage below 100; (b) own-voice AS2/AS3/AS4 capping PTS-A at 39 with AS4 in
review while PTS-J is untouched; (c) the `failure_stance: NONE` fallback deducting
rather than rejecting; (d) the AS5 stance gate rejecting a `COUNTERED` failure;
(e) the POST profile limiting PTS-J to J1/J2/J5/JD; (f) J1 fabrication capping
PTS-J at 39 while PTS-A is untouched; (g) conduct verification (unverifiable
breach rejected, verified breach −10 from JD); and (h) SATIRE leaving both scores
null.

### Demo

An offline, deterministic demo runs a **synthetic** antisemitic own-voice fixture
through the scorer (no network, no key, no real data):

```bash
npm run demo:bad          # == npx tsx scripts/demo.mjs --demo-bad --debug
```

### Endpoint integration test

With the dev server running and a model key set:

```bash
npm run test:endpoint
# or against production:
BASE_URL=https://pts-100-article-assessment.vercel.app npm run test:endpoint
```

It posts a synthetic antisemitic own-voice fixture (asserts `pts_a.score <= 39`,
`pts_a.cap_applied`, PTS-A findings include a conspiracy/incitement criterion and
AS4, review contains AS4) and the clean Chicago-park sample (asserts PTS-A 100,
PTS-J 100 with PTS-J coverage below 100).

### Debugging a failed assessment

Add `?debug=1` to the endpoint (or set `PTS_DEBUG=1`) to include the raw model
assessment, the provider, the model `stop_reason`/`finish_reason` and token usage
in the response. Every call also logs `stop_reason` and `usage` server-side. If
the model output is truncated, the API returns HTTP 502 with a clear
"output truncated; increase max_tokens" message and the `stop_reason`, instead of
passing a partial object to the scorer.

## Environment variables

| Variable             | Required          | Default             | Purpose                              |
| -------------------- | ----------------- | ------------------- | ------------------------------------ |
| `ANTHROPIC_API_KEY`  | One key for real scoring | –            | Enables the Anthropic (spec) path.   |
| `PTS_MODEL`          | No                | `claude-haiku-4-5`  | Override the Anthropic model.        |
| `ANTHROPIC_BASE_URL` | No                | `https://api.anthropic.com` | Custom / regional (EU) endpoint. |
| `OPENROUTER_API_KEY` | One key for real scoring | –            | Enables the OpenRouter path (opt-in).|
| `OPENROUTER_MODEL`   | No                | `anthropic/claude-haiku-4.5` | Override the OpenRouter model. |
| `OPENROUTER_BASE_URL`| No                | `https://openrouter.ai/api/v1` | Custom OpenRouter base URL.  |

Set **either** `ANTHROPIC_API_KEY` **or** `OPENROUTER_API_KEY` for real scoring;
with neither, the app returns a labelled mock.

## Deploy to Vercel

1. Push this repo to GitHub/GitLab.
2. Import it at [vercel.com/new](https://vercel.com/new) — Next.js is
   auto-detected.
3. Add `ANTHROPIC_API_KEY` **or** `OPENROUTER_API_KEY` (and optionally the model
   overrides) under **Project → Settings → Environment Variables**.
4. Deploy.

Or from the CLI:

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

## Project structure

```
src/
  app/
    page.tsx              # client UI (URL / paste tabs, designation, language)
    api/assess/route.ts   # POST: extract + assess + score
  components/
    results-panel.tsx     # two scores side by side, findings, review, provenance
  lib/
    rubric.ts             # prompt, tool schema, AS/J points, profiles, tierA/tierJ
    scorer.ts             # deterministic calculate_scores + evidence verification
    extract.ts            # URL / raw-text extraction, buildPublicationText
    assess.ts             # model call, mock, scorePublication/scoreFromParts
    scorer.selftest.ts    # 8-scenario (a-h) self-test
    types.ts              # PtsSubScore, Scores, Assessment, ...
scripts/
  selftest.mjs            # `npm run selftest` runner
  demo.mjs                # `npm run demo:bad` offline demo (--demo-bad --debug)
  endpoint.test.mjs       # `npm run test:endpoint` live integration test
```
