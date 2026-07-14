/*
 * Motore di traduzione italiano → dialetto.
 *
 * Le parlate sono organizzate su tre livelli (vedi src/data/dialects.json):
 *   regione → città di riferimento (hub) → paese/frazione (variante locale)
 *
 * Ogni parlata ha un dizionario CSV (schema: italiano,traduzione).
 * Selezionando una variante locale il suo dizionario viene sovrapposto a
 * quello della città di riferimento: la variante vince sulle voci comuni,
 * il resto ricade sul dizionario cittadino ("catena di fallback").
 *
 * La traduzione cerca prima le locuzioni più lunghe (greedy longest match),
 * così le voci multi-parola del dizionario ("una volta", "devo andare")
 * vengono davvero usate; la punteggiatura spezza le locuzioni e viene
 * conservata, come pure le maiuscole.
 */

export function normalizeKey(text) {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(key) {
  return key.split(' ').length;
}

/** Costruisce un dizionario consultabile dalle righe del CSV. */
export function buildDictionary(rows, label) {
  const map = new Map();
  let maxWords = 1;
  for (const row of rows) {
    const ita = normalizeKey(row.italiano || '');
    const tra = (row.traduzione || '').trim();
    if (!ita || !tra) continue;
    if (!map.has(ita)) {
      map.set(ita, tra);
      maxWords = Math.max(maxWords, countWords(ita));
    }
  }
  return { label, map, maxWords };
}

/** Consulta la catena di dizionari (variante locale prima, poi città). */
function lookup(chain, key) {
  for (const dict of chain) {
    const hit = dict.map.get(key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * Scompone il testo in righe di token { lead, word, trail }:
 * lead/trail sono punteggiatura da conservare, word la parola da tradurre.
 */
export function tokenize(text) {
  const lines = text.split('\n');
  return lines.map((line) =>
    line
      .split(/\s+/)
      .filter(Boolean)
      .map((raw) => {
        const m = raw.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'’‘-]*?)([^\p{L}\p{N}]*)$/u);
        if (!m) return { lead: '', word: raw, trail: '' };
        return { lead: m[1], word: m[2], trail: m[3] };
      })
  );
}

export function preserveCapitalization(original, translation) {
  if (!original || !translation) return translation;
  if (original === original.toUpperCase() && original.length > 1) {
    return translation.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return translation.charAt(0).toUpperCase() + translation.slice(1);
  }
  return translation;
}

/** Traduce una riga di token con greedy longest match sulle locuzioni. */
function translateTokens(tokens, chain) {
  const maxWords = Math.max(1, ...chain.map((d) => d.maxWords));
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    const limit = Math.min(maxWords, tokens.length - i);
    for (let n = limit; n >= 1 && !matched; n--) {
      // la punteggiatura interna spezza la locuzione
      let breaksPhrase = false;
      for (let k = 0; k < n - 1 && !breaksPhrase; k++) {
        if (tokens[i + k].trail || tokens[i + k + 1].lead) breaksPhrase = true;
      }
      if (breaksPhrase) continue;

      const words = tokens.slice(i, i + n).map((t) => t.word);
      if (words.some((w) => !w)) continue;
      const key = normalizeKey(words.join(' '));
      let hit = lookup(chain, key);
      let prefix = '';

      // elisione: "l'acqua" → "l'" + traduzione("acqua")
      if (hit === undefined && n === 1 && key.includes("'") && !key.endsWith("'")) {
        const cut = key.lastIndexOf("'") + 1;
        const tail = lookup(chain, key.slice(cut));
        if (tail !== undefined) {
          prefix = words[0].slice(0, cut);
          hit = tail;
        }
      }

      if (hit !== undefined) {
        const capSource = prefix ? words[0].slice(prefix.length) : words[0];
        out.push(
          tokens[i].lead + prefix + preserveCapitalization(capSource, hit) + tokens[i + n - 1].trail
        );
        i += n;
        matched = true;
      }
    }
    if (!matched) {
      const t = tokens[i];
      out.push(t.lead + t.word + t.trail);
      i += 1;
    }
  }
  return out.join(' ');
}

export function translate(text, chain) {
  if (!chain.length) return text;
  return tokenize(text)
    .map((line) => translateTokens(line, chain))
    .join('\n');
}
