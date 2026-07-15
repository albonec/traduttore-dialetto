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

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from _lib.registry import get_engine, list_dialects

MAX_TEXT = 5000

# In produzione niente documentazione OpenAPI (/api/docs, /api/redoc,
# /api/openapi.json): resta disponibile in locale e sulle preview.
IS_PRODUCTION = os.environ.get('VERCEL_ENV') == 'production'

app = FastAPI(
    title='Traduttore Dialettico API',
    description='Traduzione italiano → dialetti d\'Italia: dizionario + '
    'trasduttore statistico di caratteri (ML classico).',
    version='1.0.0',
    docs_url=None if IS_PRODUCTION else '/api/docs',
    redoc_url=None if IS_PRODUCTION else '/api/redoc',
    openapi_url=None if IS_PRODUCTION else '/api/openapi.json',
)
# In produzione l'API risponde solo al frontend (stessa origine). Il
# frontend e l'API condividono il dominio su Vercel, quindi niente CORS:
# le richieste legittime sono sempre same-origin. Nota: è una protezione
# a livello di browser (blocca altri siti e i client occasionali), non
# autenticazione — le intestazioni si possono falsificare da curl.
@app.middleware('http')
async def same_origin_only(request: Request, call_next):
    if IS_PRODUCTION and not _from_frontend(request):
        return JSONResponse(
            {'detail': 'accesso riservato al frontend'}, status_code=403
        )
    return await call_next(request)


def _from_frontend(request):
    host = request.headers.get('x-forwarded-host') or request.headers.get('host', '')
    fetch_site = request.headers.get('sec-fetch-site')
    if fetch_site is not None:
        return fetch_site == 'same-origin'
    for header in ('origin', 'referer'):
        value = request.headers.get(header)
        if value is not None:
            return urlparse(value).netloc == host
    return False


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
