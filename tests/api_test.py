#!/usr/bin/env python3
"""Test del backend FastAPI (motore Python + trasduttore statistico).

Esecuzione:  .venv/bin/python tests/api_test.py
Richiede i modelli addestrati (python3 tools/train_models.py --all).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'api'))

from fastapi.testclient import TestClient  # noqa: E402

from index import app  # noqa: E402

client = TestClient(app)
failures = 0


def check(name, actual, expected):
    global failures
    ok = actual == expected
    if not ok:
        failures += 1
    print(f'{"OK" if ok else "FAIL"} {name}: {actual!r}'
          + ('' if ok else f' (atteso {expected!r})'))


def translate(text, dialect, use_model=False):
    res = client.post(
        '/api/translate',
        json={'text': text, 'dialect': dialect, 'use_model': use_model},
    )
    assert res.status_code == 200, res.text
    return res.json()


# 1. Salute e indice: tutte le parlate del manifesto hanno un modello
health = client.get('/api/health').json()
check('health', health['status'], 'ok')
check('39 parlate', client.get('/api/dialects').json()['dialects'].__len__(), 39)

# 2. Parità con il motore JS (solo dizionario, use_model=False)
check(
    'bresciano caps+punct',
    translate('Testa, cuore!', 'lombardia/brescia/bresciano')['text'],
    'Có, cör!',
)
check(
    'lonatino phrase',
    translate('io vado a casa', 'lombardia/brescia/lonatino')['text'],
    "me 'ndó a ca'",
)
check(
    'camuno overlay',
    translate('cinque', 'lombardia/brescia/camuno')['text'],
    'hich',
)
check(
    'camuno fallback su hub',
    translate('cuore', 'lombardia/brescia/camuno')['text'],
    'cör',
)
check(
    'elisione',
    translate("l'uomo", 'campania/napoli/napoletano')['text'],
    "l'ommo",
)
check(
    'maiuscole',
    translate('SOLDI', 'sicilia/palermo/palermitano')['text'],
    'PICCIULI',
)
check(
    'a capo conservato',
    translate('testa\nsoldi', 'campania/napoli/napoletano')['text'],
    'capa\nsorde',
)
check(
    'sconosciuta invariata senza modello',
    translate('xilofono blu', 'campania/napoli/napoletano')['text'],
    'xilofono blu',
)

# 3. Provenienza dei segmenti
data = translate('testa xilofono', 'campania/napoli/napoletano', use_model=True)
segments = data['lines'][0]
check('provenienza dict', segments[0]['source'], 'dict')
check('provenienza model', segments[1]['source'], 'model')
check('confidenza presente', 'confidence' in segments[1], True)
check('parola trasformata', segments[1]['text'] != 'xilofono', True)

# 4. Il modello rispetta le maiuscole
data = translate('Formaggio', 'lombardia/brescia/bresciano', use_model=True)
seg = data['lines'][0][0]
check('modello + maiuscola', seg['text'][0].isupper(), True)

# 5. /api/predict: parola nota e parola nuova
res = client.post(
    '/api/predict',
    json={'word': 'mangiare', 'dialect': 'sicilia/palermo/palermitano'},
).json()
check('predict in dizionario', res['in_dictionary'], True)
check('predict dict traduzione', res['dictionary_translation'], 'manciari')
check('predict top1 = dizionario', res['candidates'][0]['translation'], 'manciari')

res = client.post(
    '/api/predict',
    json={'word': 'portare', 'dialect': 'lombardia/brescia/bresciano', 'topk': 5},
).json()
check('predict fuori dizionario', res['in_dictionary'], False)
check('predict 5 candidati max', len(res['candidates']) <= 5, True)
check('predict candidati non vuoti', len(res['candidates']) >= 1, True)

# 6. Errori: parlata inesistente e path traversal
check(
    '404 parlata ignota',
    client.post('/api/translate', json={'text': 'ciao', 'dialect': 'x/y/z'}).status_code,
    404,
)
check(
    '404 path traversal',
    client.post(
        '/api/translate', json={'text': 'ciao', 'dialect': '../../etc/passwd'}
    ).status_code,
    404,
)

# 7. In produzione l'API risponde solo al frontend (stessa origine)
import importlib  # noqa: E402
import os  # noqa: E402

import index as index_module  # noqa: E402

os.environ['VERCEL_ENV'] = 'production'
try:
    prod = TestClient(importlib.reload(index_module).app)
    payload = {'text': 'ciao', 'dialect': 'lazio/roma/romanesco'}
    check(
        'prod: senza origine → 403',
        prod.post('/api/translate', json=payload).status_code,
        403,
    )
    check(
        'prod: stessa origine → 200',
        prod.post(
            '/api/translate', json=payload, headers={'origin': 'http://testserver'}
        ).status_code,
        200,
    )
    check(
        'prod: origine estranea → 403',
        prod.post(
            '/api/translate', json=payload, headers={'origin': 'https://altrosito.example'}
        ).status_code,
        403,
    )
    check(
        'prod: sec-fetch-site cross-site → 403',
        prod.post(
            '/api/translate',
            json=payload,
            headers={'origin': 'http://testserver', 'sec-fetch-site': 'cross-site'},
        ).status_code,
        403,
    )
    check(
        'prod: docs non raggiungibili',
        prod.get('/api/docs', headers={'origin': 'http://testserver'}).status_code,
        404,
    )
finally:
    del os.environ['VERCEL_ENV']
    importlib.reload(index_module)

check('dev: docs raggiungibili', client.get('/api/docs').status_code, 200)

if failures:
    print(f'\n{failures} test falliti')
    sys.exit(1)
print('\nTutti i test API superati')
