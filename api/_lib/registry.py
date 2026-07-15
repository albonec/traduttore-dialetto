"""Caricamento pigro dei modelli per parlata (api/_models/*.json).

I motori restano in cache nel processo: sulle funzioni serverless le
invocazioni "calde" riusano i modelli già deserializzati.
"""

import json
from functools import lru_cache
from pathlib import Path

from .engine import DialectEngine

MODELS_DIR = Path(__file__).resolve().parent.parent / '_models'


def list_dialects():
    index = json.loads((MODELS_DIR / 'index.json').read_text('utf-8'))
    return index['dialects']


def model_path(dialect_id):
    safe = dialect_id.strip('/').replace('/', '--')
    if not safe or '..' in safe:
        return None
    path = MODELS_DIR / f'{safe}.json'
    return path if path.is_file() else None


@lru_cache(maxsize=64)
def get_engine(dialect_id):
    path = model_path(dialect_id)
    if path is None:
        return None
    return DialectEngine(json.loads(path.read_text('utf-8')))
