# Contributor's Guide

🇮🇹 [Leggi in italiano](CONTRIBUTING.it.md)

Thank you for helping preserve and celebrate Italy's dialects! This guide
covers everything from adding a single word to shipping a new dialect,
plus the internals of the AI engine and the deployment pipeline.

## Table of contents

1. [Ways to contribute](#ways-to-contribute)
2. [Project architecture](#project-architecture)
3. [Development setup](#development-setup)
4. [The dictionaries](#the-dictionaries)
5. [Adding a new dialect](#adding-a-new-dialect)
6. [The AI engine](#the-ai-engine)
7. [The backend API](#the-backend-api)
8. [Testing](#testing)
9. [Data sources and attribution](#data-sources-and-attribution)
10. [Deployment](#deployment)
11. [Pull request checklist](#pull-request-checklist)

## Ways to contribute

In rough order of impact:

1. **Expand an existing dictionary.** Most dictionaries are seed
   vocabularies (15–230 entries). Every entry you add improves both the
   lookup and the statistical model trained from it. If you grew up
   speaking a dialect, twenty words from memory are a real contribution.
2. **Correct entries.** Orthography for dialects is rarely standardized;
   if a rendering is off for your area, fix it and mention the convention
   you follow in the PR.
3. **Add a new dialect or local variant** — see
   [Adding a new dialect](#adding-a-new-dialect).
4. **Improve the code**: frontend, translation engine, statistical model,
   backend, tooling.

## Project architecture

```
public/dictionaries/<regione>/<città>/<parlata>.csv   the data (source of truth)
src/data/dialects.json      registry: regione → città (hub) → paese tree
src/lib/engine.js           browser engine: dictionary lookup only
src/App.jsx                 UI; "Modalità AI" calls the backend
api/index.py                FastAPI app (Vercel serverless function)
api/_lib/engine.py          Python engine: dictionary + model fallback
api/_lib/transducer.py      beam-search decoder for the statistical model
api/_models/*.json          one trained model per dialect (committed)
tools/train_models.py       trains the models from the CSVs
tools/normalize_dicts.py    normalizes/sorts/dedupes the CSVs
tests/engine.test.js        JS engine + dictionary integrity tests
tests/api_test.py           backend tests (FastAPI TestClient)
```

Two design rules explain most of the layout:

- **Dictionaries are the single source of truth.** Models are derived
  artifacts, regenerated deterministically from the CSVs (CI fails if
  they're stale). Never edit `api/_models/*.json` by hand.
- **Village dictionaries are overlays.** A village CSV only records what
  *differs* from its hub city; everything else falls back to the hub. Keep
  them small and distinctive.

## Development setup

```sh
yarn                                   # JS dependencies
python3 -m venv .venv
.venv/bin/pip install fastapi uvicorn httpx

yarn dev        # frontend with HMR on :5173
yarn api        # backend on :8000 — vite proxies /api to it
```

The frontend works without the backend (dictionary mode only); the
"Modalità AI" checkbox needs `yarn api` running.

## The dictionaries

Every dictionary is a CSV at
`public/dictionaries/<regione>/<città>/<parlata>.csv` with one shared
schema:

```csv
italiano,traduzione
acqua,aqua
andare,andà
una volta,'na ólta
```

Conventions (enforced by `python3 tools/normalize_dicts.py`):

- Header exactly `italiano,traduzione`.
- Italian keys lowercase, sorted alphabetically, no duplicates.
- UTF-8, apostrophe `'` (U+0027) — not the curly `’`.
- **Multi-word entries are allowed and encouraged** ("devo andare",
  "come stai") — the engine matches the longest phrase first.
- Keep the dialect side's accents/diacritics faithful to the orthography
  you follow; state that orthography in your PR if it's not obvious.

Workflow for editing:

```sh
# 1. edit the CSV
# 2. normalize (dedupe, sort, unify apostrophes)
python3 tools/normalize_dicts.py
# 3. retrain that dialect's model (CI checks it's in sync)
yarn train <parlata>          # e.g. yarn train bresciano
# 4. test
yarn test && yarn test:api
```

💡 **Tip:** the backend can propose candidate translations for words you're
unsure about — start `yarn api` and try
`POST /api/predict {"word": "...", "dialect": "<id>"}` (or use
`/api/docs`). The model's guess is a starting point, not an authority:
only commit entries you can vouch for.

## Adding a new dialect

1. **Create the CSV** at
   `public/dictionaries/<regione>/<città>/<parlata>.csv` (start from any
   existing file). Aim for at least ~30 well-attested words; more is
   better — the statistical model learns from every pair.
2. **Register it in [`src/data/dialects.json`](src/data/dialects.json)**:
   - as a new *hub* under its region, or
   - as a *village* under an existing hub, with a `note` describing what
     makes it distinct (e.g. Camuno's s→h aspiration). Village CSVs only
     record differences from the hub.
3. **Normalize**: `python3 tools/normalize_dicts.py`.
4. **Train its model**: `yarn train <parlata>` — this writes
   `api/_models/<...>.json` and updates the model index. Commit those
   files too.
5. **Test**: `yarn test && yarn test:api` (verifies every manifest entry
   has a parseable dictionary and a model).

## The AI engine

Each dialect has its own small model — classical statistical ML, no
generative AI, no external services. Understanding it helps you improve
it:

**Training** ([`tools/train_models.py`](tools/train_models.py), stdlib
only):

1. The dialect's merged dictionary (village overlaid on hub) is split
   into Italian↔dialect word pairs.
2. Each pair is **character-aligned** with weighted Levenshtein (accent
   changes cost less than substitutions).
3. Contiguous edits become **rewrite rules** keyed by position in the
   word (start/mid/end/whole) and up to 2 characters of context — so it
   learns things like `-are → -à` (Bresciano) or word-initial `b- → v-`
   (Neapolitan).
4. A **character-trigram language model** is fitted on the dialect side.

**Inference** ([`api/_lib/transducer.py`](api/_lib/transducer.py)): a beam
search rewrites an unseen Italian word using the rules, scored by rule
probability + LM + a length-bias correction. Each prediction carries a
confidence (softmax over the top candidates).

**Commands:**

```sh
yarn train                    # interactive picker
yarn train bresciano          # one dialect (matches id/name/city/region)
yarn train brescia            # a hub retrains its villages too
yarn train --all              # everything
yarn train --eval lonatino    # with held-out evaluation
```

Training is **deterministic**: same CSVs → byte-identical models. CI
retrains everything and fails if `api/_models/` doesn't match — so always
commit the retrained models with your dictionary changes.

Model quality tracks dictionary size. Reference numbers (held-out):
Lonatino (~660 pairs) reaches 42% exact@1 / 56% exact@3 and halves the
edit distance vs. copying the Italian word. Small seed dictionaries
produce rougher guesses — which is precisely why dictionary entries are
the most valuable contribution.

## The backend API

FastAPI app in [`api/index.py`](api/index.py), deployed by Vercel's
Python runtime; `vercel.json` rewrites `/api/*` to it.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | status + model count |
| `GET /api/dialects` | all dialects with metadata |
| `POST /api/translate` | `{text, dialect, use_model?}` → translation with per-word provenance (`dict`/`model`/`copy`) and confidence |
| `POST /api/predict` | `{word, dialect, topk?}` → ranked candidates for one word |

Dialect ids are the CSV path without prefix/extension, e.g.
`lombardia/brescia/bresciano`.

Notes:

- In **production** the API only answers same-origin requests (the web
  frontend) and the OpenAPI docs are disabled. Locally and on previews
  everything is open and interactive docs live at `/api/docs`.
- `_lib/` and `_models/` start with `_` so Vercel doesn't expose them as
  endpoints.
- Keep the backend dependency-light: `requirements.txt` is just FastAPI;
  the model runtime is pure stdlib. Think twice before adding packages —
  they inflate the serverless bundle.

## Testing

```sh
yarn test          # JS: engine behavior + all dictionaries parse
yarn test:api      # Python: API endpoints, engine parity, prod gating
```

Both suites run in CI on every push/PR, along with the model-freshness
check and the production build. PRs get a Vercel preview deployment;
pushes to `master` deploy to production.

If you change engine behavior, update **both** engines
([`src/lib/engine.js`](src/lib/engine.js) and
[`api/_lib/engine.py`](api/_lib/engine.py)) and add matching tests to both
suites — the Python engine must translate identically to the JS one when
the model is off.

## Data sources and attribution

Dictionary data must be attributable:

- Cite your source in the PR: a published dictionary, a documented
  vocabulary (e.g. the Forzati dataset for Brescia, Gian dij Cordòla's
  vocabulary for Franco-Provençal), or first-hand knowledge ("native
  speaker, Lonato area").
- Don't bulk-import copyrighted dictionaries without permission.
- Existing provenance notes live in this file's history and in
  `src/data/dialects.json` `note` fields; keep them accurate.

Current notable sources: Brescia-area dataset by Marco Forzati
(dialetdebresa); Franco-Provençal of Mocchie e Laietto from "Parlèn a moda
'd nos" by Gian dij Cordòla; Valdostano follows the Cerlogne/patoisvda.org
orthography; Ladin fascian uses the cazet variant of upper Val di Fassa.

## Deployment

One Vercel project serves both halves: the static Vite build (`dist/`)
and the FastAPI function (`api/index.py`, dependencies from
`requirements.txt`, `/api/*` rewritten to it in
[`vercel.json`](vercel.json)). The trained models are committed, so
nothing is trained at deploy time.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on
every push and PR: JS tests → model-freshness check → API tests → build →
deploy (PRs get a preview, `master` goes to production). It needs three
repository secrets:

- `VERCEL_TOKEN` — vercel.com → Settings → Tokens
- `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` — run `npx vercel link` once
  locally and copy them from `.vercel/project.json`

If the project uses Vercel's own Git integration instead, disable it or
drop the workflow's `deploy` job to avoid double deployments.

## Pull request checklist

- [ ] CSVs normalized (`python3 tools/normalize_dicts.py` produces no diff)
- [ ] Models retrained and committed (`yarn train --all`, or the affected
      dialects)
- [ ] `yarn test` and `yarn test:api` pass
- [ ] New dialects registered in `dialects.json` with an accurate `note`
- [ ] Sources stated in the PR description
- [ ] Engine changes mirrored in both JS and Python engines
