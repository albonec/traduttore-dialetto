# Guida per chi contribuisce

🇬🇧 [Read in English](CONTRIBUTING.md)

Grazie per aiutare a preservare e celebrare i dialetti d'Italia! Questa
guida copre tutto: dall'aggiunta di una singola parola alla pubblicazione
di un nuovo dialetto, fino agli interni del motore AI e alla pipeline di
deployment.

## Indice

1. [Come contribuire](#come-contribuire)
2. [Architettura del progetto](#architettura-del-progetto)
3. [Ambiente di sviluppo](#ambiente-di-sviluppo)
4. [I dizionari](#i-dizionari)
5. [Aggiungere un nuovo dialetto](#aggiungere-un-nuovo-dialetto)
6. [Il motore AI](#il-motore-ai)
7. [Il backend API](#il-backend-api)
8. [Test](#test)
9. [Fonti e attribuzione](#fonti-e-attribuzione)
10. [Deployment](#deployment)
11. [Checklist per le pull request](#checklist-per-le-pull-request)

## Come contribuire

In ordine approssimativo di impatto:

1. **Ampliare un dizionario esistente.** La maggior parte dei dizionari è
   un vocabolario seme (15–230 voci). Ogni voce aggiunta migliora sia la
   ricerca sia il modello statistico che ne viene addestrato. Se sei
   cresciuto parlando un dialetto, venti parole a memoria sono un
   contributo vero.
2. **Correggere le voci.** L'ortografia dei dialetti è raramente
   standardizzata; se una resa non torna per la tua zona, correggila e
   indica nella PR la convenzione che segui.
3. **Aggiungere un nuovo dialetto o una variante locale** — vedi
   [Aggiungere un nuovo dialetto](#aggiungere-un-nuovo-dialetto).
4. **Migliorare il codice**: frontend, motore di traduzione, modello
   statistico, backend, strumenti.

## Architettura del progetto

```
public/dictionaries/<regione>/<città>/<parlata>.csv   i dati (fonte di verità)
src/data/dialects.json      registro: albero regione → città → paese
src/lib/engine.js           motore browser: solo ricerca a dizionario
src/App.jsx                 interfaccia; "Modalità AI" chiama il backend
api/index.py                app FastAPI (funzione serverless Vercel)
api/_lib/engine.py          motore Python: dizionario + fallback sul modello
api/_lib/transducer.py      decoder beam-search del modello statistico
api/_models/*.json          un modello addestrato per parlata (committati)
tools/train_models.py       addestra i modelli dai CSV
tools/normalize_dicts.py    normalizza/ordina/deduplica i CSV
tests/engine.test.js        test del motore JS + integrità dei dizionari
tests/api_test.py           test del backend (TestClient FastAPI)
```

Due regole di progetto spiegano quasi tutto:

- **I dizionari sono l'unica fonte di verità.** I modelli sono artefatti
  derivati, rigenerati deterministicamente dai CSV (la CI fallisce se
  sono stantii). Non modificare mai `api/_models/*.json` a mano.
- **I dizionari di paese sono sovrapposizioni.** Il CSV di un paese
  registra solo ciò che *differisce* dalla sua città di riferimento; per
  il resto si ricade sulla città. Teniamoli piccoli e distintivi.

## Ambiente di sviluppo

```sh
yarn                                   # dipendenze JS
python3 -m venv .venv
.venv/bin/pip install fastapi uvicorn httpx

yarn dev        # frontend con HMR su :5173
yarn api        # backend su :8000 — vite vi inoltra /api
```

Il frontend funziona anche senza backend (solo dizionario); la casella
"Modalità AI" richiede `yarn api` in esecuzione.

## I dizionari

Ogni dizionario è un CSV in
`public/dictionaries/<regione>/<città>/<parlata>.csv` con un unico schema
condiviso:

```csv
italiano,traduzione
acqua,aqua
andare,andà
una volta,'na ólta
```

Convenzioni (applicate da `python3 tools/normalize_dicts.py`):

- Intestazione esattamente `italiano,traduzione`.
- Chiavi italiane minuscole, in ordine alfabetico, senza duplicati.
- UTF-8, apostrofo `'` (U+0027) — non quello ricurvo `’`.
- **Le voci multi-parola sono ammesse e incoraggiate** ("devo andare",
  "come stai") — il motore cerca prima la locuzione più lunga.
- Sul lato dialettale mantieni accenti e diacritici fedeli all'ortografia
  che segui; se non è ovvia, dichiarala nella PR.

Flusso di lavoro per le modifiche:

```sh
# 1. modifica il CSV
# 2. normalizza (deduplica, ordina, unifica gli apostrofi)
python3 tools/normalize_dicts.py
# 3. riaddestra il modello di quella parlata (la CI verifica che sia in pari)
yarn train <parlata>          # es. yarn train bresciano
# 4. testa
yarn test && yarn test:api
```

💡 **Suggerimento:** il backend può proporre traduzioni candidate per le
parole di cui non sei sicuro — avvia `yarn api` e prova
`POST /api/predict {"word": "...", "dialect": "<id>"}` (oppure usa
`/api/docs`). La proposta del modello è un punto di partenza, non
un'autorità: committa solo voci di cui puoi garantire.

## Aggiungere un nuovo dialetto

1. **Crea il CSV** in
   `public/dictionaries/<regione>/<città>/<parlata>.csv` (parti da un
   file esistente). Punta ad almeno ~30 parole ben attestate; più sono,
   meglio è — il modello statistico impara da ogni coppia.
2. **Registralo in [`src/data/dialects.json`](src/data/dialects.json)**:
   - come nuova *città di riferimento* nella sua regione, oppure
   - come *paese* sotto una città esistente, con una `note` che descriva
     cosa lo distingue (es. l'aspirazione s→h del camuno). Il CSV di un
     paese registra solo le differenze dalla città.
3. **Normalizza**: `python3 tools/normalize_dicts.py`.
4. **Addestra il suo modello**: `yarn train <parlata>` — scrive
   `api/_models/<...>.json` e aggiorna l'indice dei modelli. Committa
   anche quei file.
5. **Testa**: `yarn test && yarn test:api` (verifica che ogni voce del
   manifesto abbia un dizionario leggibile e un modello).

## Il motore AI

Ogni parlata ha il suo piccolo modello — machine learning statistico
classico, niente IA generativa, nessun servizio esterno. Capirlo aiuta a
migliorarlo:

**Addestramento** ([`tools/train_models.py`](tools/train_models.py), solo
libreria standard):

1. Il dizionario fuso della parlata (paese sovrapposto alla città) viene
   diviso in coppie di parole italiano↔dialetto.
2. Ogni coppia viene **allineata carattere per carattere** con Levenshtein
   pesato (i cambi di accento costano meno delle sostituzioni).
3. Le modifiche contigue diventano **regole di riscrittura** indicizzate
   per posizione nella parola (inizio/mezzo/fine/intera) e fino a 2
   caratteri di contesto — così impara cose come `-are → -à` (bresciano)
   o `b- → v-` a inizio parola (napoletano).
4. Sul lato dialettale viene stimato un **language model a trigrammi di
   caratteri**.

**Inferenza** ([`api/_lib/transducer.py`](api/_lib/transducer.py)): una
ricerca a fascio riscrive una parola italiana mai vista applicando le
regole, con punteggio = probabilità delle regole + LM + una correzione del
bias di lunghezza. Ogni predizione porta una confidenza (softmax sui
candidati migliori).

**Comandi:**

```sh
yarn train                    # scelta interattiva
yarn train bresciano          # una parlata (corrisponde a id/nome/città/regione)
yarn train brescia            # una città riaddestra anche i suoi paesi
yarn train --all              # tutto
yarn train --eval lonatino    # con valutazione held-out
```

L'addestramento è **deterministico**: stessi CSV → modelli identici al
byte. La CI riaddestra tutto e fallisce se `api/_models/` non corrisponde
— quindi committa sempre i modelli riaddestrati insieme alle modifiche ai
dizionari.

La qualità del modello segue la dimensione del dizionario. Numeri di
riferimento (held-out): il lonatino (~660 coppie) raggiunge il 42% di
exact@1 / 56% di exact@3 e dimezza la distanza di edit rispetto a copiare
la parola italiana. I vocabolari seme piccoli producono ipotesi più grezze
— ed è esattamente per questo che le voci di dizionario sono il contributo
più prezioso.

## Il backend API

App FastAPI in [`api/index.py`](api/index.py), pubblicata dal runtime
Python di Vercel; `vercel.json` riscrive `/api/*` verso di essa.

| Endpoint | Scopo |
|---|---|
| `GET /api/health` | stato + numero di modelli |
| `GET /api/dialects` | tutte le parlate con i metadati |
| `POST /api/translate` | `{text, dialect, use_model?}` → traduzione con provenienza per parola (`dict`/`model`/`copy`) e confidenza |
| `POST /api/predict` | `{word, dialect, topk?}` → candidati ordinati per una parola |

Gli id delle parlate sono il percorso del CSV senza prefisso ed
estensione, es. `lombardia/brescia/bresciano`.

Note:

- In **produzione** l'API risponde solo alle richieste same-origin (il
  frontend web) e la documentazione OpenAPI è disattivata. In locale e
  sulle preview è tutto aperto e la documentazione interattiva è su
  `/api/docs`.
- `_lib/` e `_models/` iniziano con `_` così Vercel non li espone come
  endpoint.
- Mantieni il backend leggero: `requirements.txt` contiene solo FastAPI;
  il runtime del modello è pura libreria standard. Pensaci due volte
  prima di aggiungere pacchetti — gonfiano il bundle serverless.

## Test

```sh
yarn test          # JS: comportamento del motore + parsing di tutti i dizionari
yarn test:api      # Python: endpoint, parità col motore JS, protezioni di produzione
```

Entrambe le suite girano in CI a ogni push/PR, insieme al controllo di
freschezza dei modelli e alla build di produzione. Le PR ricevono una
preview su Vercel; i push su `master` vanno in produzione.

Se cambi il comportamento del motore, aggiorna **entrambi** i motori
([`src/lib/engine.js`](src/lib/engine.js) e
[`api/_lib/engine.py`](api/_lib/engine.py)) e aggiungi test corrispondenti
a entrambe le suite — a modello spento il motore Python deve tradurre in
modo identico a quello JS.

## Fonti e attribuzione

I dati dei dizionari devono essere attribuibili:

- Cita la fonte nella PR: un dizionario pubblicato, un vocabolario
  documentato (es. il dataset Forzati per Brescia, il vocabolario di Gian
  dij Cordòla per il francoprovenzale) o conoscenza diretta ("madrelingua,
  zona di Lonato").
- Non importare in blocco dizionari protetti da diritto d'autore senza
  permesso.
- Le note di provenienza esistenti vivono nei campi `note` di
  `src/data/dialects.json`; mantienile accurate.

Fonti notevoli attuali: dataset del basso Garda bresciano di Marco Forzati
(dialetdebresa); francoprovenzale di Mocchie e Laietto dal vocabolario
"Parlèn a moda 'd nos" di Gian dij Cordòla; il valdostano segue
l'ortografia Cerlogne/patoisvda.org; il ladino fascian usa la variante
cazet dell'alta Val di Fassa.

## Deployment

Un unico progetto Vercel serve entrambe le metà: la build statica di Vite
(`dist/`) e la funzione FastAPI (`api/index.py`, dipendenze da
`requirements.txt`, `/api/*` riscritto verso di essa in
[`vercel.json`](vercel.json)). I modelli addestrati sono committati:
niente addestramento al momento del deploy.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) gira a
ogni push e PR: test JS → controllo freschezza dei modelli → test API →
build → deploy (le PR ricevono una preview, `master` va in produzione).
Servono tre secret di repository:

- `VERCEL_TOKEN` — vercel.com → Settings → Tokens
- `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` — esegui una volta
  `npx vercel link` in locale e copiali da `.vercel/project.json`

Se il progetto usa invece l'integrazione Git di Vercel, disattivala
oppure togli il job `deploy` dal workflow per evitare deploy doppi.

## Checklist per le pull request

- [ ] CSV normalizzati (`python3 tools/normalize_dicts.py` non produce diff)
- [ ] Modelli riaddestrati e committati (`yarn train --all`, o le parlate
      toccate)
- [ ] `yarn test` e `yarn test:api` passano
- [ ] Nuovi dialetti registrati in `dialects.json` con una `note` accurata
- [ ] Fonti dichiarate nella descrizione della PR
- [ ] Modifiche al motore replicate sia nel motore JS sia in quello Python
