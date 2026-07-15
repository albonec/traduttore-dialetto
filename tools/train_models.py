#!/usr/bin/env python3
"""Addestra i modelli statistici italiano → dialetto.

Per ogni parlata del manifesto (src/data/dialects.json):

  1. carica il dizionario CSV (con la catena di fallback: la variante locale
     sovrapposta alla città di riferimento, come fa il frontend);
  2. allinea carattere per carattere le coppie italiano/dialetto (Levenshtein
     pesato) e ne estrae regole di riscrittura con posizione e contesto;
  3. addestra un language model a trigrammi di caratteri sul lato dialettale;
  4. serializza tutto (regole + LM + dizionario fuso) in un JSON compatto in
     api/_models/, pronto per la funzione serverless FastAPI.

Ogni parlata ha il SUO modello, addestrabile singolarmente in qualunque
momento. Solo libreria standard. Uso:

  python3 tools/train_models.py --all              # tutti i modelli
  python3 tools/train_models.py bresciano          # solo il bresciano
  python3 tools/train_models.py brescia napoli     # più parlate/città insieme
  python3 tools/train_models.py                    # elenco + scelta interattiva
  python3 tools/train_models.py --eval bresciano   # con valutazione held-out

I selettori accettano id ("lombardia/brescia/bresciano"), nome del dialetto,
città o regione (sottostringa, senza distinzione di maiuscole). Riaddestrare
una città di riferimento riaddestra anche le sue varianti locali, perché i
loro dizionari fusi ne dipendono.
"""

import argparse
import csv
import json
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'api' / '_lib'))

from transducer import BOS, EOS, Transducer  # noqa: E402

MODELS_DIR = ROOT / 'api' / '_models'
WORD_CHARS_EXTRA = "'’-"
MAX_CONTEXT = 2          # caratteri di contesto attorno a ogni regola
MAX_TARGETS_PER_RULE = 4  # traduzioni alternative conservate per regola


def normalize_key(text):
    return ' '.join(text.lower().replace('’', "'").replace('‘', "'").split())


def strip_accents(ch):
    return unicodedata.normalize('NFD', ch)[0]


def is_wordlike(token):
    return bool(token) and all(c.isalpha() or c in WORD_CHARS_EXTRA for c in token)


def load_csv(rel_path):
    entries = {}
    with open(ROOT / 'public' / rel_path, encoding='utf-8') as fh:
        for row in csv.DictReader(fh):
            ita = normalize_key(row.get('italiano') or '')
            tra = (row.get('traduzione') or '').strip()
            if ita and tra and ita not in entries:
                entries[ita] = tra
    return entries


def training_pairs(entries):
    """Coppie parola→parola: voci singole + locuzioni allineabili 1:1."""
    pairs = []
    for ita, tra in entries.items():
        src_words = ita.split(' ')
        tgt_words = normalize_key(tra).split(' ')
        if len(src_words) == len(tgt_words):
            for s, t in zip(src_words, tgt_words):
                if is_wordlike(s) and is_wordlike(t):
                    pairs.append((s, t))
        elif len(src_words) == 1 and is_wordlike(src_words[0]) and all(
            is_wordlike(t) for t in tgt_words
        ):
            pairs.append((src_words[0], normalize_key(tra)))
    return pairs


# ---------------------------------------------------------------------------
# Allineamento di caratteri (Levenshtein pesato) e estrazione delle regole
# ---------------------------------------------------------------------------

def align(src, tgt):
    """Allinea src→tgt; ritorna la lista di chunk (s_seg, t_seg, matched)."""
    n, m = len(src), len(tgt)
    INF = float('inf')
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            c = cost[i][j]
            if c == INF:
                continue
            if i < n and j < m:
                if src[i] == tgt[j]:
                    step = 0.0
                elif strip_accents(src[i]) == strip_accents(tgt[j]):
                    step = 0.4  # stessa lettera, accento diverso
                else:
                    step = 1.0
                if c + step < cost[i + 1][j + 1]:
                    cost[i + 1][j + 1] = c + step
                    back[i + 1][j + 1] = 'd'
            if i < n and c + 1.0 < cost[i + 1][j]:
                cost[i + 1][j] = c + 1.0
                back[i + 1][j] = 'u'
            if j < m and c + 1.0 < cost[i][j + 1]:
                cost[i][j + 1] = c + 1.0
                back[i][j + 1] = 'l'

    ops = []  # (s_char|'', t_char|'', matched)
    i, j = n, m
    while i or j:
        move = back[i][j]
        if move == 'd':
            ops.append((src[i - 1], tgt[j - 1], src[i - 1] == tgt[j - 1]))
            i, j = i - 1, j - 1
        elif move == 'u':
            ops.append((src[i - 1], '', False))
            i -= 1
        else:
            ops.append(('', tgt[j - 1], False))
            j -= 1
    ops.reverse()

    # comprime le operazioni contigue non-match in un unico chunk
    chunks = []
    for s, t, matched in ops:
        if chunks and not matched and not chunks[-1][2]:
            prev = chunks[-1]
            chunks[-1] = (prev[0] + s, prev[1] + t, False)
        else:
            chunks.append((s, t, matched))
    # un'inserzione pura (sorgente vuota) viene ancorata al match adiacente,
    # così il decoder non ha mai regole con sorgente vuota
    fixed = []
    for chunk in chunks:
        s, t, matched = chunk
        if not matched and s == '':
            if fixed and fixed[-1][2]:
                ps, pt, _ = fixed.pop()
                fixed.append((ps + s, pt + t, False))
                continue
        fixed.append(chunk)
    merged = []
    for chunk in fixed:  # inserzione a inizio parola: ancora al match dopo
        if merged and not merged[-1][2] and merged[-1][0] == '' and chunk[2]:
            ps, pt, _ = merged.pop()
            merged.append((ps + chunk[0], pt + chunk[1], False))
        else:
            merged.append(chunk)
    return merged


def pos_tag(start, end, length):
    if start == 0 and end == length:
        return 'w'
    if start == 0:
        return 's'
    if end == length:
        return 'e'
    return 'm'


def extract_rules(pairs):
    """rules[(src_seg, pos)] = Counter(tgt_seg) da tutte le coppie allineate."""
    rules = defaultdict(Counter)
    for src, tgt in pairs:
        chunks = align(src, tgt)
        # offset di ogni chunk nella parola sorgente
        offsets, off = [], 0
        for s, _t, _m in chunks:
            offsets.append(off)
            off += len(s)
        src_len = len(src)

        for idx, (s, t, matched) in enumerate(chunks):
            if matched:
                # evidenza d'identità: il carattere resta se stesso
                start = offsets[idx]
                rules[(s, pos_tag(start, start + 1, src_len))][t] += 1
                continue
            if s == '':
                continue  # non ancorabile (parola sorgente vuota): scarta
            start, end = offsets[idx], offsets[idx] + len(s)
            # contesto: estende la regola con i match adiacenti (0..MAX)
            left_run = chunks[idx - 1] if idx and chunks[idx - 1][2] else None
            right_run = (
                chunks[idx + 1]
                if idx + 1 < len(chunks) and chunks[idx + 1][2]
                else None
            )
            max_l = min(MAX_CONTEXT, len(left_run[0])) if left_run else 0
            max_r = min(MAX_CONTEXT, len(right_run[0])) if right_run else 0
            for dl in range(max_l + 1):
                for dr in range(max_r + 1):
                    lctx = left_run[0][len(left_run[0]) - dl:] if dl else ''
                    rctx = right_run[0][:dr] if dr else ''
                    key = (lctx + s + rctx, pos_tag(start - dl, end + dr, src_len))
                    rules[key][lctx + t + rctx] += 1
    return rules


def train_lm(entries):
    """Trigrammi di caratteri sulle parole dialettali del dizionario."""
    lm = defaultdict(Counter)
    charset = {EOS}
    for tra in entries.values():
        for word in normalize_key(tra).split(' '):
            if not is_wordlike(word):
                continue
            charset.update(word)
            hist = BOS + BOS
            for ch in word + EOS:
                lm[hist][ch] += 1
                hist = hist[1] + ch
    return lm, len(charset)


def build_model(meta, entries, pairs):
    rules = extract_rules(pairs)
    lm, charset_size = train_lm(entries)
    return {
        **meta,
        'entries': entries,
        'max_words': max((len(k.split(' ')) for k in entries), default=1),
        'pairs': len(pairs),
        'charset_size': charset_size,
        'rules': {
            f'{src}|{pos}': dict(counter.most_common(MAX_TARGETS_PER_RULE))
            for (src, pos), counter in rules.items()
        },
        'lm': {hist: dict(counter) for hist, counter in lm.items()},
    }


# ---------------------------------------------------------------------------
# Valutazione held-out (solo per i dizionari abbastanza grandi)
# ---------------------------------------------------------------------------

def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def evaluate(label, pairs, entries, min_pairs=120, seed=42):
    if len(pairs) < min_pairs:
        return None
    import random

    rng = random.Random(seed)
    shuffled = pairs[:]
    rng.shuffle(shuffled)
    cut = max(1, len(shuffled) // 10)
    held, train = shuffled[:cut], shuffled[cut:]
    train_keys = {s for s, _ in train}
    held = [(s, t) for s, t in held if s not in train_keys]
    if not held:
        return None

    model = build_model({}, entries, train)
    decoder = Transducer(model)
    top1 = top3 = 0
    dist_model = dist_base = 0.0
    for src, gold in held:
        cands = [c for c, _ in decoder.decode(src, topk=3)]
        top1 += cands[0] == gold
        top3 += gold in cands
        dist_model += edit_distance(cands[0], gold) / max(1, len(gold))
        dist_base += edit_distance(src, gold) / max(1, len(gold))
    n = len(held)
    return (
        f'    eval {label}: held-out {n} — exact@1 {top1 / n:.0%}, '
        f'exact@3 {top3 / n:.0%}, dist {dist_model / n:.2f} '
        f'(baseline copia: {dist_base / n:.2f})'
    )


# ---------------------------------------------------------------------------

def catalog():
    """Elenca tutte le parlate del manifesto come task addestrabili."""
    manifest = json.loads((ROOT / 'src/data/dialects.json').read_text('utf-8'))
    tasks = []
    for region in manifest['regions']:
        for hub in region['hubs']:
            for entry, parent in [(hub, None)] + [(v, hub) for v in hub['villages']]:
                dialect_id = (
                    entry['dict'].removeprefix('dictionaries/').removesuffix('.csv')
                )
                tasks.append(
                    {
                        'id': dialect_id,
                        'label': entry['dialect'],
                        'endonym': entry.get('endonym', ''),
                        'region': region['name'],
                        'place': (
                            f"{entry['name']}, {parent['name']}" if parent else entry['name']
                        ),
                        'dict': entry['dict'],
                        'hub_dict': parent['dict'] if parent else None,
                        'hub_id': (
                            parent['dict'].removeprefix('dictionaries/').removesuffix('.csv')
                            if parent
                            else None
                        ),
                    }
                )
    return tasks


def matches(task, selector):
    sel = selector.lower()
    return any(
        sel in field.lower()
        for field in (task['id'], task['label'], task['place'], task['region'])
    )


def train_one(task, do_eval=False):
    """Addestra la singola parlata e salva il modello al posto giusto."""
    entries = dict(load_csv(task['hub_dict'])) if task['hub_dict'] else {}
    entries.update(load_csv(task['dict']))
    pairs = training_pairs(entries)
    meta = {k: task[k] for k in ('id', 'label', 'endonym', 'region', 'place')}
    model = build_model(meta, entries, pairs)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = MODELS_DIR / (task['id'].replace('/', '--') + '.json')
    out_path.write_text(
        json.dumps(model, ensure_ascii=False, separators=(',', ':')), 'utf-8'
    )
    kb = out_path.stat().st_size / 1024
    print(
        f"{task['id']}: {len(entries)} voci, {len(pairs)} coppie, "
        f"{len(model['rules'])} regole, {kb:.0f} KB → {out_path.relative_to(ROOT)}"
    )
    if do_eval:
        report = evaluate(task['label'], pairs, entries)
        print(report or f"    eval {task['label']}: dizionario troppo piccolo, saltata")

    update_index({**meta, 'entries': len(entries), 'pairs': len(pairs)})


def update_index(record):
    """Aggiorna (upsert) la voce della parlata in index.json."""
    index_path = MODELS_DIR / 'index.json'
    dialects = []
    if index_path.exists():
        dialects = json.loads(index_path.read_text('utf-8')).get('dialects', [])
    dialects = [d for d in dialects if d['id'] != record['id']] + [record]
    dialects.sort(key=lambda d: d['id'])
    index_path.write_text(
        json.dumps({'dialects': dialects}, ensure_ascii=False, indent=1), 'utf-8'
    )


def resolve(tasks, selectors):
    """Selettori → parlate da addestrare (con le varianti dipendenti)."""
    chosen = {}
    for sel in selectors:
        hits = [t for t in tasks if matches(t, sel)]
        if not hits:
            sys.exit(f'nessuna parlata corrisponde a "{sel}" (vedi elenco senza argomenti)')
        for t in hits:
            chosen[t['id']] = t
    # una variante locale dipende dal dizionario della sua città: se
    # riaddestriamo la città, riaddestriamo anche le varianti
    for t in tasks:
        if t['hub_id'] and t['hub_id'] in chosen:
            chosen[t['id']] = t
    return [t for t in tasks if t['id'] in chosen]  # ordine del manifesto


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('selectors', nargs='*', help='parlate da addestrare')
    parser.add_argument('--all', action='store_true', help='addestra tutti i modelli')
    parser.add_argument('--eval', action='store_true', help='valutazione held-out')
    args = parser.parse_args()

    tasks = catalog()
    if args.all:
        todo = tasks
    elif args.selectors:
        todo = resolve(tasks, args.selectors)
    else:
        # modalità interattiva: elenca e chiedi cosa addestrare
        print('Parlate disponibili:\n')
        for t in tasks:
            print(f"  {t['id']:55s} {t['label']} ({t['place']})")
        print()
        try:
            reply = input('Quale addestrare? (nome/id, "all" per tutte, vuoto per uscire) ').strip()
        except EOFError:
            reply = ''
        if not reply:
            return
        todo = tasks if reply.lower() == 'all' else resolve(tasks, reply.split())

    for task in todo:
        train_one(task, do_eval=args.eval)
    print(f'\n{len(todo)} modello/i aggiornato/i in {MODELS_DIR.relative_to(ROOT)}/')


if __name__ == '__main__':
    main()
