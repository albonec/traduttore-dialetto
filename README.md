# traduttore-dialetto

🇮🇹 [Leggi in italiano](README.it.md)

Translate Standard Italian into the dialects of Italy — **39 varieties
covering all 20 regions**, organized in three tiers: *regione* → *città di
riferimento* → *paese/frazione*.

Two engines work together:

- **Dictionary lookup** — hand-curated CSV dictionaries with greedy
  longest-phrase matching, elision handling, and village→city fallback.
- **AI mode** — a small statistical character-transduction model per
  dialect (classical machine learning, no generative AI) predicts how
  words *outside* the dictionary would sound. Served by a FastAPI backend
  on Vercel.

## Quick start

```sh
yarn && yarn dev                # frontend on :5173

python3 -m venv .venv && .venv/bin/pip install fastapi uvicorn httpx
yarn api                        # backend on :8000 (for AI mode)
```

## Commands

| Command | What it does |
|---|---|
| `yarn dev` / `yarn api` | frontend dev server / FastAPI backend |
| `yarn test` / `yarn test:api` | JS engine tests / backend tests |
| `yarn train [dialect]` | (re)train dialect models |
| `yarn build` | production build |

## Contributing

Dictionary entries are the most valuable contribution — every added word
improves both the lookup *and* the AI model of its dialect. See the
[contributor's guide](CONTRIBUTING.md) ([italiano](CONTRIBUTING.it.md)) for
the dictionary schema, how to add a dialect, the AI engine internals, and
deployment.
