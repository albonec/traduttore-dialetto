# traduttore-dialetto

Web app (React + Tailwind, built with Vite) that translates Standard Italian
into the dialects of Italy, organized on three tiers:

1. **Regione** (e.g. Lombardia, Emilia-Romagna, Sicilia)
2. **Città di riferimento** (hub: Milano, Brescia, Roma, Napoli, Catanzaro, …)
3. **Paese / frazione** (local variants: Breno in Val Camonica, Chioggia,
   Lonato del Garda, …)

## Development

```sh
yarn            # install dependencies
yarn dev        # dev server with HMR
yarn test       # engine + dictionary integrity tests
yarn build      # production build into dist/
yarn preview    # serve the production build locally
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
`yarn build` as the build command.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every
push and PR: installs with `yarn --frozen-lockfile`, runs the tests, builds,
then deploys — PRs get a preview deployment, pushes to `master` go to
production. It needs three repository secrets:

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
- The other dictionaries are seed vocabularies of well-attested words and
  should be expanded over time — contributions welcome.
