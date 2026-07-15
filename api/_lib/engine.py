"""Motore di traduzione italiano → dialetto (porting Python di src/lib/engine.js)
con fallback sul trasduttore statistico per le parole fuori dizionario.

Ogni token tradotto riporta la sua provenienza:
  - "dict":  trovato nel dizionario (catena variante → città già fusa
             nel modello a addestramento);
  - "model": predetto dal trasduttore statistico (con confidenza);
  - "copy":  lasciato com'è (punteggiatura, numeri, parole troppo corte
             o modello non abbastanza sicuro non previsto: si copia).
"""

import re
from .transducer import Transducer

TOKEN_RE = re.compile(
    r"^([^\w]*?)([\w'’‘-]*?)([^\w]*)$", re.UNICODE
)
WORDLIKE_RE = re.compile(r"^[^\W\d_]['’‘\-]?[\w'’‘-]*$", re.UNICODE)
MIN_MODEL_LEN = 3  # sotto questa lunghezza il modello non viene interpellato


def normalize_key(text):
    return ' '.join(text.lower().replace('’', "'").replace('‘', "'").split())


def preserve_capitalization(original, translation):
    if not original or not translation:
        return translation
    if original == original.upper() and len(original) > 1 and original.lower() != original:
        return translation.upper()
    first = original[0]
    if first == first.upper() and first != first.lower():
        return translation[0].upper() + translation[1:]
    return translation


def tokenize(text):
    """Righe di token {lead, word, trail}: la punteggiatura si conserva."""
    lines = []
    for line in text.split('\n'):
        tokens = []
        for raw in line.split():
            m = TOKEN_RE.match(raw)
            if m:
                tokens.append({'lead': m.group(1), 'word': m.group(2), 'trail': m.group(3)})
            else:
                tokens.append({'lead': '', 'word': raw, 'trail': ''})
        lines.append(tokens)
    return lines


class DialectEngine:
    """Dizionario fuso + trasduttore di una singola parlata."""

    def __init__(self, model):
        self.meta = {
            k: model.get(k, '') for k in ('id', 'label', 'endonym', 'region', 'place')
        }
        self.entries = model['entries']
        self.max_words = model.get('max_words', 1)
        self.pairs = model.get('pairs', 0)
        self.transducer = Transducer(model)

    # -- fallback statistico ------------------------------------------------

    def predict(self, word, topk=3):
        """Candidati dialettali per una parola fuori dizionario."""
        return self.transducer.decode(normalize_key(word), topk=topk)

    def _model_or_copy(self, word, use_model):
        if (
            use_model
            and len(word) >= MIN_MODEL_LEN
            and WORDLIKE_RE.match(word)
            and self.pairs > 0
        ):
            # topk=3 anche se serve solo il migliore: la confidenza è la
            # softmax sui candidati, con un solo candidato sarebbe sempre 1
            best, confidence = self.predict(word, topk=3)[0]
            if best != normalize_key(word):
                return best, 'model', round(confidence, 3)
        return word, 'copy', None

    # -- traduzione ---------------------------------------------------------

    def _translate_tokens(self, tokens, use_model):
        out = []
        i = 0
        while i < len(tokens):
            matched = False
            limit = min(self.max_words, len(tokens) - i)
            for n in range(limit, 0, -1):
                # la punteggiatura interna spezza la locuzione
                if any(
                    tokens[i + k]['trail'] or tokens[i + k + 1]['lead']
                    for k in range(n - 1)
                ):
                    continue
                words = [tokens[i + k]['word'] for k in range(n)]
                if any(not w for w in words):
                    continue
                key = normalize_key(' '.join(words))
                hit = self.entries.get(key)
                prefix = ''

                # elisione: "l'acqua" → "l'" + traduzione("acqua")
                if hit is None and n == 1 and "'" in key and not key.endswith("'"):
                    cut = key.rfind("'") + 1
                    tail = self.entries.get(key[cut:])
                    if tail is not None:
                        prefix = words[0][:cut]
                        hit = tail

                if hit is not None:
                    cap_source = words[0][len(prefix):] if prefix else words[0]
                    out.append(
                        {
                            'text': tokens[i]['lead']
                            + prefix
                            + preserve_capitalization(cap_source, hit)
                            + tokens[i + n - 1]['trail'],
                            'source': 'dict',
                        }
                    )
                    i += n
                    matched = True
                    break

            if not matched:
                tok = tokens[i]
                word, source, confidence = self._model_or_copy(tok['word'], use_model)
                rendered = preserve_capitalization(tok['word'], word) if word else word
                item = {'text': tok['lead'] + rendered + tok['trail'], 'source': source}
                if confidence is not None:
                    item['confidence'] = confidence
                out.append(item)
                i += 1
        return out

    def translate(self, text, use_model=True):
        """Ritorna (testo tradotto, righe di segmenti con provenienza)."""
        lines = [self._translate_tokens(toks, use_model) for toks in tokenize(text)]
        rendered = '\n'.join(' '.join(seg['text'] for seg in line) for line in lines)
        return rendered, lines
