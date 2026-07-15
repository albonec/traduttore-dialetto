"""Trasduttore statistico di caratteri italiano → dialetto.

Modello classico di machine learning (nessuna IA generativa):

  1. regole di riscrittura pesate (sorgente → destinazione, con posizione
     nella parola e contesto) apprese per allineamento di caratteri sulle
     coppie del dizionario — vedi tools/train_models.py;
  2. un language model a trigrammi di caratteri sul lato dialettale che
     giudica quanto "suona" dialettale ogni candidato;
  3. una ricerca a fascio (beam search) che combina i due punteggi.

Serve a predire la resa dialettale delle parole italiane che NON sono nel
dizionario. Tutto è puro Python + JSON: gira in una funzione serverless.
"""

import math

# Marcatori di confine parola usati dal LM a trigrammi.
BOS = '^'
EOS = '$'

# Pesi del punteggio combinato e penalità (log-prob).
LM_WEIGHT = 0.6
LENGTH_BONUS = 0.4                     # compensa il bias verso output corti
FALLBACK_POS_PENALTY = math.log(0.25)  # regola usata fuori dalla sua posizione
COPY_PENALTY = math.log(0.05)          # copia di un carattere senza regola

POSITIONS = ('s', 'm', 'e', 'w')  # start, mid, end, whole


class Transducer:
    """Decoder per un modello addestrato (dict deserializzato dal JSON)."""

    def __init__(self, model):
        self.lm = model['lm']
        self.lm_vocab = max(1, model.get('charset_size', 30))
        # rules: {"src|pos": {tgt: count}} → {(src,pos): [(tgt, logp), ...]}
        self.rules = {}
        self.max_src_len = 1
        for key, targets in model.get('rules', {}).items():
            src, pos = key.rsplit('|', 1)
            total = sum(targets.values())
            self.rules[(src, pos)] = [
                (tgt, math.log(n / total)) for tgt, n in targets.items()
            ]
            self.max_src_len = max(self.max_src_len, len(src))

    def _lm_logp(self, hist, char):
        """log P(char | ultimi due caratteri), add-k smoothing."""
        k = 0.1
        row = self.lm.get(hist)
        if row is None:
            return math.log(k / (k * self.lm_vocab))
        total = sum(row.values())
        return math.log((row.get(char, 0) + k) / (total + k * self.lm_vocab))

    def _lm_extend(self, hist, seg):
        """Punteggio LM incrementale aggiungendo seg alla storia hist."""
        score = 0.0
        for ch in seg:
            score += LM_WEIGHT * self._lm_logp(hist, ch)
            hist = hist[1] + ch
        return hist, score

    def _candidates(self, word, i):
        """Regole applicabili in word[i:]: (lunghezza sorgente, tgt, logp)."""
        n = len(word)
        out = []
        limit = min(self.max_src_len, n - i)
        for length in range(limit, 0, -1):
            src = word[i:i + length]
            at_start, at_end = i == 0, i + length == n
            if at_start and at_end:
                exact = 'w'
            elif at_start:
                exact = 's'
            elif at_end:
                exact = 'e'
            else:
                exact = 'm'
            for pos in POSITIONS:
                hits = self.rules.get((src, pos))
                if not hits:
                    continue
                # fuori posizione: solo le regole "di mezzo" sono riusabili
                if pos != exact and pos != 'm':
                    continue
                penalty = 0.0 if pos == exact else FALLBACK_POS_PENALTY
                for tgt, logp in hits:
                    out.append((length, tgt, logp + penalty))
        return out

    def decode(self, word, beam_width=12, topk=3):
        """Traduce una parola sconosciuta.

        Ritorna una lista di (candidato, confidenza) ordinata per punteggio;
        la confidenza è la softmax dei punteggi finali dei candidati.
        """
        word = word.lower()
        n = len(word)
        if n == 0:
            return [(word, 1.0)]

        # states[i]: migliori ipotesi che hanno consumato word[:i]
        # ogni ipotesi: (score, out, hist)
        states = {0: [(0.0, '', BOS + BOS)]}
        finals = {}

        for i in range(n):
            beam = states.pop(i, None)
            if not beam:
                continue
            beam.sort(reverse=True)
            candidates = self._candidates(word, i)
            # copia letterale come rete di sicurezza (sempre disponibile)
            candidates.append((1, word[i], COPY_PENALTY))
            for score, out, hist in beam[:beam_width]:
                for length, tgt, logp in candidates:
                    hist2, lm_score = self._lm_extend(hist, tgt)
                    gain = logp + lm_score + LENGTH_BONUS * len(tgt)
                    new = (score + gain, out + tgt, hist2)
                    j = i + length
                    if j == n:
                        total = new[0] + LM_WEIGHT * self._lm_logp(hist2, EOS)
                        prev = finals.get(new[1])
                        if prev is None or total > prev:
                            finals[new[1]] = total
                    else:
                        bucket = states.setdefault(j, [])
                        bucket.append(new)
                        if len(bucket) > beam_width * 4:
                            bucket.sort(reverse=True)
                            del bucket[beam_width:]

        if not finals:
            return [(word, 1.0)]

        ranked = sorted(finals.items(), key=lambda kv: kv[1], reverse=True)[:topk]
        best = ranked[0][1]
        weights = [math.exp((s - best) / max(1, len(word))) for _, s in ranked]
        z = sum(weights)
        return [(cand, w / z) for (cand, _), w in zip(ranked, weights)]
