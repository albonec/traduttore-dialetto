'use strict';

/*
 * Traduttore Dialettico — motore di traduzione
 *
 * Le parlate sono organizzate su tre livelli (vedi dialects.json):
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

// ---------------------------------------------------------------------------
// Motore (funzioni pure, testabili anche fuori dal browser)
// ---------------------------------------------------------------------------

function normalizeKey(text) {
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
function buildDictionary(rows, label) {
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
function tokenize(text) {
    const lines = text.split('\n');
    return lines.map(line =>
        line.split(/\s+/).filter(Boolean).map(raw => {
            const m = raw.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'’‘-]*?)([^\p{L}\p{N}]*)$/u);
            if (!m) return { lead: '', word: raw, trail: '' };
            return { lead: m[1], word: m[2], trail: m[3] };
        })
    );
}

function preserveCapitalization(original, translation) {
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
    const maxWords = Math.max(1, ...chain.map(d => d.maxWords));
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

            const words = tokens.slice(i, i + n).map(t => t.word);
            if (words.some(w => !w)) continue;
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
                    tokens[i].lead + prefix +
                    preserveCapitalization(capSource, hit) +
                    tokens[i + n - 1].trail
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

function translate(text, chain) {
    if (!chain.length) return text;
    return tokenize(text).map(line => translateTokens(line, chain)).join('\n');
}

// ---------------------------------------------------------------------------
// Interfaccia (solo nel browser)
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
    const state = { manifest: null, chain: [] };
    const $ = id => document.getElementById(id);

    async function fetchManifest() {
        const res = await fetch('dialects.json');
        if (!res.ok) throw new Error(`dialects.json: HTTP ${res.status}`);
        return res.json();
    }

    function parseCSV(text) {
        return new Promise((resolve, reject) => {
            Papa.parse(text, {
                header: true,
                skipEmptyLines: true,
                transformHeader: h => h.trim().toLowerCase(),
                complete: results => resolve(results.data),
                error: reject,
            });
        });
    }

    async function loadDictionary(path, label) {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        const rows = await parseCSV(await res.text());
        return buildDictionary(rows, label);
    }

    function currentSelection() {
        const region = state.manifest.regions.find(r => r.id === $('regionSelect').value);
        const hub = region.hubs.find(h => h.id === $('hubSelect').value);
        const village = hub.villages.find(v => v.id === $('villageSelect').value) || null;
        return { region, hub, village };
    }

    function fillSelect(select, items, labelOf) {
        select.innerHTML = '';
        for (const item of items) {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = labelOf(item);
            select.appendChild(opt);
        }
    }

    function refreshHubs() {
        const region = state.manifest.regions.find(r => r.id === $('regionSelect').value);
        fillSelect($('hubSelect'), region.hubs, h => `${h.name} — ${h.dialect}`);
        refreshVillages();
    }

    function refreshVillages() {
        const { hub } = currentSelection();
        const select = $('villageSelect');
        select.innerHTML = '';
        const base = document.createElement('option');
        base.value = '';
        base.textContent = `Parlata cittadina (${hub.endonym})`;
        select.appendChild(base);
        for (const v of hub.villages) {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = `${v.name} — ${v.dialect}`;
            select.appendChild(opt);
        }
        select.disabled = hub.villages.length === 0;
    }

    async function reloadChain() {
        const { region, hub, village } = currentSelection();
        $('dictInfo').textContent = 'Caricamento dizionari…';
        try {
            const chain = [];
            if (village) chain.push(await loadDictionary(village.dict, village.dialect));
            chain.push(await loadDictionary(hub.dict, hub.dialect));
            state.chain = chain;

            const parts = chain.map(d => `${d.label}: ${d.map.size} voci`);
            const place = village ? `${village.name}, ${hub.name}` : hub.name;
            $('dictInfo').textContent = `${place} (${region.name}) — ${parts.join(' + ')}`;
            const note = village && village.note ? village.note : '';
            $('dictNote').textContent = note;
            translateText();
        } catch (err) {
            state.chain = [];
            $('dictInfo').textContent = `Errore nel caricamento: ${err.message}`;
        }
    }

    function translateText() {
        $('outputText').value = translate($('inputText').value, state.chain);
    }
    window.translateText = translateText;

    function debounce(fn, ms) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            state.manifest = await fetchManifest();
        } catch (err) {
            $('dictInfo').textContent =
                `Impossibile caricare dialects.json (${err.message}). Servire la cartella via HTTP.`;
            return;
        }
        fillSelect($('regionSelect'), state.manifest.regions, r => r.name);
        $('regionSelect').value = 'lombardia';
        refreshHubs();

        $('regionSelect').addEventListener('change', () => { refreshHubs(); reloadChain(); });
        $('hubSelect').addEventListener('change', () => { refreshVillages(); reloadChain(); });
        $('villageSelect').addEventListener('change', reloadChain);
        $('inputText').addEventListener('input', debounce(translateText, 250));
        $('copyButton').addEventListener('click', () => {
            navigator.clipboard.writeText($('outputText').value);
        });

        await reloadChain();
    });
}

// Esporta le funzioni pure per i test in Node.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeKey, buildDictionary, tokenize, translate, preserveCapitalization };
}
