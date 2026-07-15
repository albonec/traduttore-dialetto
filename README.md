# traduttore-dialetto

Web app (React + Tailwind, built with Vite) that translates Standard Italian
into the dialects of Italy — 39 varieties covering **all 20 regions** —
organized on three tiers:

1. **Regione** (all twenty, from Valle d'Aosta to Sardegna)
2. **Città di riferimento** (hub: Milano, Brescia, Trieste, Roma, Napoli,
   Catanzaro, Nuoro, …)
3. **Paese / frazione** (local variants: Breno in Val Camonica, Chioggia,
   Lonato del Garda, Mocchie e Laietto in Val di Susa, Canazei in Val di
   Fassa, …)

## Development

```sh
yarn            # install dependencies
yarn dev        # dev server with HMR
yarn test       # engine + dictionary integrity tests
yarn build      # production build into dist/
yarn preview    # serve the production build locally
```

Python backend (AI mode):

```sh
python3 -m venv .venv && .venv/bin/pip install fastapi uvicorn httpx
yarn api        # FastAPI dev server on :8000 (vite proxies /api to it)
yarn test:api   # backend test suite
yarn train      # retrain dialect models (interactive; or `yarn train --all`)
```

## How it works

- [`src/data/dialects.json`](src/data/dialects.json) is the registry of the
  tier tree (bundled into the app). Every hub and village points at its own
  dictionary CSV.
- Dictionaries live under `public/dictionaries/<regione>/<città>/<parlata>.csv`
  and are fetched on demand (and cached). They all share one schema: header
  `italiano,traduzione`, lowercase Italian keys, sorted alphabetically, UTF-8,
  apostrophe `'` (U+0027). Multi-word entries are allowed and encouraged.
- Selecting a village overlays its dictionary on the hub dictionary: the
  village wins on shared entries, everything else falls back to the hub. This
  keeps village CSVs small — they only record what differs.
- The engine ([`src/lib/engine.js`](src/lib/engine.js)) matches the longest
  phrase first (greedy longest match), preserves punctuation and
  capitalization, handles Italian elision (`l'acqua` → `l'` + translation of
  `acqua`), and does O(1) lookups via `Map`. Translation is live as you type.

## AI engine (statistical, not generative)

Besides the dictionary lookup, every dialect has its **own small
machine-learning model** that predicts how *out-of-dictionary* Italian words
would sound in that dialect — classical statistical ML, no generative AI:

- **Training** ([`tools/train_models.py`](tools/train_models.py), stdlib
  only): character-aligns each dictionary's Italian/dialect pairs (weighted
  Levenshtein), extracts weighted rewrite rules keyed by position in the word
  (start/mid/end/whole) and up to 2 characters of context (so it learns rules
  like `-are → -à` for Bresciano or `b- → v-` for Neapolitan), and fits a
  character-trigram language model on the dialect side. Each parlata's model
  is a self-contained JSON in `api/_models/` (all 39 together: ~400 KB).
  Train any dialect at any time: `yarn train bresciano`, `yarn train --all`,
  or plain `yarn train` for an interactive picker. Retraining a hub city
  automatically retrains its village variants (their merged dictionaries
  depend on it). `--eval` reports held-out accuracy for the bigger
  dictionaries.
- **Inference** ([`api/_lib/transducer.py`](api/_lib/transducer.py)): a beam
  search combines rule probabilities and the character LM to transduce an
  unseen Italian word into the dialect; each prediction carries a confidence.
  On the largest dictionary (Lonatino, ~660 pairs) held-out evaluation gets
  42% exact@1 / 56% exact@3 and halves the edit distance vs. copying the
  Italian word (0.34 vs 0.77).
- **Backend** ([`api/index.py`](api/index.py)): FastAPI app served by
  Vercel's Python runtime as a serverless function (`/api/*` is rewritten to
  it in [`vercel.json`](vercel.json)). Endpoints: `GET /api/dialects`,
  `POST /api/translate` (dictionary + model fallback, with per-word
  provenance and confidence), `POST /api/predict` (top-k candidates for one
  word — handy for expanding the dictionaries).
- **Frontend**: the "Modalità AI" checkbox routes translation through the
  backend and lists which output words were model-predicted rather than
  found in a dictionary.

## Adding a dialect

1. Create `public/dictionaries/<regione>/<città>/<parlata>.csv` with the
   shared schema (start from any existing file).
2. Register it in `src/data/dialects.json` — as a new hub under its region,
   or as a village under an existing hub (with a `note` describing what makes
   it distinct).
3. Normalize it: `python3 tools/normalize_dicts.py` (dedupes, sorts, unifies
   apostrophes).
4. `yarn test` verifies every dictionary referenced by the manifest exists
   and parses.

## Deploying (Vercel)

The site is a static Vite build (`dist/`); [`vercel.json`](vercel.json) pins
`yarn build` as the build command. The FastAPI backend in `api/index.py` is
deployed automatically by Vercel's Python runtime (dependencies from
[`requirements.txt`](requirements.txt)); the `rewrites` entry in
`vercel.json` routes every `/api/*` request to it. The trained models in
`api/_models/` are committed, so no training happens at deploy time.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every
push and PR: installs with `yarn --frozen-lockfile`, runs the JS engine
tests, retrains the models and fails if `api/_models/` is out of sync with
the dictionary CSVs (training is deterministic), runs the FastAPI tests,
builds, then deploys — PRs get a preview deployment, pushes to `master` go
to production. It needs three repository secrets:

- `VERCEL_TOKEN` — create at vercel.com → Settings → Tokens
- `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` — run `npx vercel link` once
  locally and copy them from `.vercel/project.json`

(Alternatively, Vercel's own Git integration can build and deploy without the
workflow; the workflow adds the test gate and PR previews.)

## Data notes

- The Brescia-area dataset (`lonatino.csv`, ~660 entries) was compiled by
  Marco Forzati (dialetdebresa); the Brescia hub dictionary is a core subset
  of it.
- The Camuno (Breno) variant encodes the documented s→h aspiration of Val
  Camonica ("hich hach de hòch hèch höl holér a hecà").
- The Chioggiotto variant keeps the /l/ that mainstream Venetian drops
  (bèlo vs bèo) plus some lagoon/fishing lexicon.
- The Franco-Provençal of Mocchie e Laietto (Condove, Val di Susa) comes from
  the "Parlèn a moda 'd nos" vocabulary by Gian dij Cordòla (~230 entries).
- The Valdostano seed follows the Cerlogne/patoisvda.org orthography; the
  Ladin fascian seed uses the cazet variant documented for the upper Val di
  Fassa.
- The other dictionaries are seed vocabularies of well-attested words and
  should be expanded over time — contributions welcome. Seeds vary in size
  (15–230 entries); the engine's hub fallback means village dictionaries only
  need to record what differs.
