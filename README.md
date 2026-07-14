# traduttore-dialetto

Web app that translates Standard Italian into the dialects of Italy, organized
on three tiers:

1. **Regione** (e.g. Lombardia, Emilia-Romagna, Sicilia)
2. **Città di riferimento** (hub: Milano, Brescia, Roma, Napoli, Catanzaro, …)
3. **Paese / frazione** (local variants: Breno in Val Camonica, Chioggia,
   Lonato del Garda, …)

## Running

The app is fully static but loads its data with `fetch`, so serve the folder
over HTTP:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## How it works

- [`dialects.json`](dialects.json) is the registry of the tier tree. Every
  hub and village points at its own dictionary CSV.
- Dictionaries live under `dictionaries/<regione>/<città>/<parlata>.csv` and
  all share one schema: header `italiano,traduzione`, lowercase Italian keys,
  sorted alphabetically, UTF-8, apostrophe `'` (U+0027). Multi-word entries
  are allowed and encouraged.
- Selecting a village overlays its dictionary on the hub dictionary: the
  village wins on shared entries, everything else falls back to the hub. This
  keeps village CSVs small — they only record what differs.
- The engine ([`script.js`](script.js)) matches the longest phrase first
  (greedy longest match), preserves punctuation and capitalization, handles
  Italian elision (`l'acqua` → `l'` + translation of `acqua`), and does O(1)
  lookups via `Map`.

## Adding a dialect

1. Create `dictionaries/<regione>/<città>/<parlata>.csv` with the shared
   schema (start from any existing file).
2. Register it in `dialects.json` — as a new hub under its region, or as a
   village under an existing hub (with a `note` describing what makes it
   distinct) — then regenerate the script-loadable copy:
   `python3 tools/sync_manifest.py` (writes `dialects.js`, which the page
   loads synchronously so the pickers populate instantly).
3. Normalize it: `python3 tools/normalize_dicts.py` (dedupes, sorts, unifies
   apostrophes).

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
