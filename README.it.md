# traduttore-dialetto

🇬🇧 [Read in English](README.md)

Traduce l'italiano standard nei dialetti d'Italia — **39 parlate che
coprono tutte e 20 le regioni**, organizzate su tre livelli: *regione* →
*città di riferimento* → *paese/frazione*.

Due motori lavorano insieme:

- **Ricerca a dizionario** — dizionari CSV curati a mano, con ricerca
  della locuzione più lunga, gestione dell'elisione e fallback
  paese→città.
- **Modalità AI** — un piccolo modello statistico di trasduzione di
  caratteri per ogni dialetto (machine learning classico, niente IA
  generativa) predice come suonerebbero le parole *fuori* dal dizionario.
  Servito da un backend FastAPI su Vercel.

## Avvio rapido

```sh
yarn && yarn dev                # frontend su :5173

python3 -m venv .venv && .venv/bin/pip install fastapi uvicorn httpx
yarn api                        # backend su :8000 (per la modalità AI)
```

## Comandi

| Comando | Cosa fa |
|---|---|
| `yarn dev` / `yarn api` | server di sviluppo frontend / backend FastAPI |
| `yarn test` / `yarn test:api` | test del motore JS / test del backend |
| `yarn train [parlata]` | (ri)addestra i modelli dialettali |
| `yarn build` | build di produzione |

## Contribuire

Le voci di dizionario sono il contributo più prezioso — ogni parola
aggiunta migliora sia la ricerca *sia* il modello AI del suo dialetto.
Nella [guida per chi contribuisce](CONTRIBUTING.it.md)
([English](CONTRIBUTING.md)) trovi lo schema dei dizionari, come si
aggiunge un dialetto, il funzionamento del motore AI e il deployment.
