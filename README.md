# PTS-100 · Article Assessment

A Next.js web app for the **Team 14 PTS-100 pipeline**. It takes an article
(by URL or pasted text), extracts the labelled sections
(headline / standfirst / byline / published / source / body), and scores it
against criteria **C1–C3** using the Anthropic Messages API — with every point
backed by a verbatim quote from the article.

Non-assessable criteria are excluded and the overall score is rescaled to 100.

## Features

- **Two inputs:** paste a live URL (auto-extracted with
  `@extractus/article-extractor`) or paste raw article text.
- **Evidence-backed scoring:** each criterion returns a 0–100 score (or
  `NOT_ASSESSABLE`), a rationale, and quoted evidence.
- **Rescaled overall score** with a banded verdict (Failing → Exemplary).
- **Works without a key:** ships a labelled mock fallback so the UI is usable
  before you add credentials.

## Getting started

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```

Then open the printed URL (this project runs on port **43127** by default).

```bash
npm run dev -- -p 43127
```

## Environment variables

| Variable             | Required | Default                    | Purpose                          |
| -------------------- | -------- | -------------------------- | -------------------------------- |
| `ANTHROPIC_API_KEY`  | For real scoring | –                  | Enables live PTS-100 assessment. |
| `ANTHROPIC_MODEL`    | No       | `claude-3-5-haiku-latest`  | Override the model.              |
| `ANTHROPIC_BASE_URL` | No       | –                          | Custom / regional endpoint.      |

Without `ANTHROPIC_API_KEY` the app returns a clearly-labelled **mock**.

## Deploy to Vercel

1. Push this repo to GitHub/GitLab.
2. Import it at [vercel.com/new](https://vercel.com/new) — the framework is
   auto-detected as Next.js.
3. Add `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) under
   **Project → Settings → Environment Variables**.
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
    page.tsx              # client UI (input modes, states)
    api/assess/route.ts   # POST: extract + assess
  components/
    results-panel.tsx     # score ring + per-criterion cards
  lib/
    rubric.ts             # C1–C3 definitions + score bands
    extract.ts            # URL / raw-text extraction
    assess.ts             # Anthropic call + scoring + mock
    types.ts
```

## Notes

The `C1–C3` rubric in `src/lib/rubric.ts` is a scaffold interpretation of the
original `team14-solutionV4.py`. Replace the criterion definitions, weights, and
prompt in `rubric.ts` / `assess.ts` to match the exact PTS-100 rules from the
source pipeline.
