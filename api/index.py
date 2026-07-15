"""Backend FastAPI del traduttore dialettale (funzione serverless Vercel).

Endpoint (tutti sotto /api, vedi il rewrite in vercel.json):

  GET  /api/health              stato del servizio
  GET  /api/dialects            elenco delle parlate con modello addestrato
  POST /api/translate           {text, dialect} → traduzione con provenienza
  POST /api/predict             {word, dialect, topk?} → candidati per una
                                parola fuori dizionario (espansione lessico)

Il motore combina il dizionario CSV (fuso con la catena di fallback
variante → città) e un trasduttore statistico di caratteri addestrato con
tools/train_models.py — machine learning classico, nessuna IA generativa.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from _lib.registry import get_engine, list_dialects

MAX_TEXT = 5000

app = FastAPI(
    title='Traduttore Dialettico API',
    description='Traduzione italiano → dialetti d\'Italia: dizionario + '
    'trasduttore statistico di caratteri (ML classico).',
    version='1.0.0',
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


class TranslateRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT)
    dialect: str = Field(examples=['lombardia/brescia/bresciano'])
    use_model: bool = True  # False = solo dizionario, come il frontend statico


class PredictRequest(BaseModel):
    word: str = Field(min_length=1, max_length=64)
    dialect: str
    topk: int = Field(default=3, ge=1, le=10)


def engine_or_404(dialect_id):
    engine = get_engine(dialect_id)
    if engine is None:
        raise HTTPException(404, f'parlata sconosciuta: {dialect_id!r}')
    return engine


@app.get('/api/health')
def health():
    return {'status': 'ok', 'dialects': len(list_dialects())}


@app.get('/api/dialects')
def dialects():
    return {'dialects': list_dialects()}


@app.post('/api/translate')
def translate(req: TranslateRequest):
    engine = engine_or_404(req.dialect)
    text, lines = engine.translate(req.text, use_model=req.use_model)
    return {'dialect': engine.meta, 'text': text, 'lines': lines}


@app.post('/api/predict')
def predict(req: PredictRequest):
    engine = engine_or_404(req.dialect)
    word = req.word.strip().lower()
    known = engine.entries.get(word)
    candidates = [
        {'translation': cand, 'confidence': round(conf, 3)}
        for cand, conf in engine.predict(word, topk=req.topk)
    ]
    return {
        'dialect': engine.meta,
        'word': word,
        'in_dictionary': known is not None,
        'dictionary_translation': known,
        'candidates': candidates,
    }
