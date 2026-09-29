# PTS-100 · Publication Trust Score

A Next.js web app that assesses a single publication against the **PTS-100
Publication Trust Score** framework — the **IMPRESS Standards Code** combined
with the **IHRA Working Definition of Antisemitism**.

Give it an article by URL or pasted text. The app extracts the publication into
labelled sections, sends it to the Anthropic Messages API with a forced,
structured tool call, then runs a **deterministic scorer** that verifies every
piece of evidence and applies the PTS-100 rules exactly. It is a faithful port
of the reference Python pipeline (`team14-solutionV4.py`).

## The framework

The publication is scored out of 100 across four blocks (14 criteria + conduct):

| Block | Name | Points | Criteria |
| ----- | ---- | ------ | -------- |
| **A** | Antisemitism (IMPRESS Clause 4 + IHRA) | 45 | A1 (15), A2 (10, critical), A3 (10, contested), A4 (5), A5 (5) |
| **B** | Accuracy (IMPRESS Clause 1) | 30 | B1 (7), B2 (10, critical), B3 (5), B4 (5), B5 (3) |
| **C** | Attribution & transparency | 15 | C1 (5), C2 (3), C3 (4), C4 (3) |
| **D** | Conduct | 10 | Clauses 3, 5, 6, 7, 8, 9 (start at 10, −5 per breach) |

### How the deterministic scorer works

The model never computes the final number — software does. `calculate_pts100`
applies these rules (see `src/lib/scorer.ts`):

- **NOT_ASSESSABLE** criteria are excluded from the possible total, and the score
  is rescaled to 100 (so a clean article with unassessable criteria can still
  reach 100).
- **Evidence verification** — every `FAIL` must carry an exact quotation. Each
  quote is checked against the article text (after light normalisation). A
  failure whose quote is **not** in the text is *rejected* (no deduction, points
  kept) and queued for human review.
- **Stance gate** — the stance-gated criteria (A1, A2, A3, B2) cannot fail unless
  the offending passage is `OWN_VOICE` or `UNCRITICAL_AMPLIFICATION`. Failures
  attributed to `REPORTED_CONTEXTUALISED` or `COUNTERED` material are rejected
  and queued.
- **Critical cap** — an A2 or B2 failure in the publication's **own voice** caps
  the final score at **39**. It is never applied to quoted material.
- **Human review routing** — every A2, A3 and B2 failure, any `human_review_required`
  flag, the contested zone (A3), and any accepted failure with confidence below
  `0.5` are routed to a de-duplicated review queue.
- **Block D conduct** — starts at 10; each verified engaged-and-breached clause
  deducts 5 (floor 0). An unverifiable breach is rejected and queued.
- **Legal flag** — a separate routing flag (`INCITEMENT` / `HOLOCAUST_DENIAL`),
  never a legal finding, and never part of the score.

### Designations

- **ARTICLE** — journalistic/editorial publication (all 14 criteria + Block D).
- **POST** — social-media content; scored on A1–A5, B1–B3 and Block D only,
  rescaled to 100.
- **DOCUMENTARY** — research/monitoring material; scored like an article.
- **SATIRE** — labelled, **not** scored (`final_score` is `null`).

### Tier bands

`≥100` Compliant (A) · `≥75` Generally compliant (B) · `≥60` Compliant with
exceptions (C) · `≥40` Breach (D) · else Serious breach (F).

## Getting started

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY (optional)
npm run dev
```

The dev server runs on port **43127** → http://localhost:43127

Without `ANTHROPIC_API_KEY` the app runs entirely on a clearly-labelled **mock**
assessment, so you can explore the full flow with no credentials.

## Self-test

The deterministic scorer ships with the reference 7-scenario self-test:

```bash
npm run selftest
```

It verifies: a clean article reaching 100 (88/100 coverage), an unverifiable A1
failure being rejected, a verified own-voice A2 failure capping at 39, the A3
stance gate, POST-profile rescaling, Block D verification, and SATIRE returning
no score.

## Environment variables

| Variable             | Required          | Default             | Purpose                              |
| -------------------- | ----------------- | ------------------- | ------------------------------------ |
| `ANTHROPIC_API_KEY`  | For real scoring  | –                   | Enables live PTS-100 assessment.     |
| `PTS_MODEL`          | No                | `claude-haiku-4-5`  | Override the Anthropic model.        |
| `ANTHROPIC_BASE_URL` | No                | `https://api.anthropic.com` | Custom / regional (EU) endpoint. |

## Deploy to Vercel

1. Push this repo to GitHub/GitLab.
2. Import it at [vercel.com/new](https://vercel.com/new) — Next.js is
   auto-detected.
3. Add `ANTHROPIC_API_KEY` (and optionally `PTS_MODEL` / `ANTHROPIC_BASE_URL`)
   under **Project → Settings → Environment Variables**.
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
    results-panel.tsx     # score, block bars, findings, review queue, provenance
  lib/
    rubric.ts             # prompt, tool schema, points, profiles, tier()
    scorer.ts             # deterministic calculate_pts100 + evidence verification
    extract.ts            # URL / raw-text extraction, buildPublicationText
    assess.ts             # Anthropic call, mock, scorePublication/scoreFromParts
    scorer.selftest.ts    # 7-scenario self-test
    types.ts
scripts/
  selftest.mjs            # `npm run selftest` runner
```
