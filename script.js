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

    /*
     * Menu a tendina custom: i <select> nativi su alcuni temi di sistema
     * mostrano le opzioni con colori illeggibili. Qui il pannello è un
     * elemento della pagina, con colori espliciti e lista scorrevole.
     */
    function createDropdown(id, onChange) {
        const root = $(id);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'dropdown-toggle';
        toggle.setAttribute('aria-haspopup', 'listbox');
        toggle.setAttribute('aria-expanded', 'false');
        const labelSpan = document.createElement('span');
        labelSpan.className = 'dropdown-label';
        const caret = document.createElement('span');
        caret.className = 'dropdown-caret';
        caret.textContent = '▾';
        toggle.append(labelSpan, caret);
        const menu = document.createElement('ul');
        menu.className = 'dropdown-menu';
        menu.setAttribute('role', 'listbox');
        root.append(toggle, menu);

        let items = [];
        let value = null;

        function close() {
            root.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        }
        function open() {
            root.classList.add('open');
            toggle.setAttribute('aria-expanded', 'true');
            const sel = menu.querySelector('.selected');
            if (sel) sel.scrollIntoView({ block: 'nearest' });
        }

        toggle.addEventListener('click', () => {
            if (toggle.disabled) return;
            root.classList.contains('open') ? close() : open();
        });
        document.addEventListener('click', e => {
            if (!root.contains(e.target)) close();
        });
        toggle.addEventListener('keydown', e => {
            if (e.key === 'Escape') close();
        });

        function renderMenu() {
            menu.innerHTML = '';
            for (const item of items) {
                const li = document.createElement('li');
                li.setAttribute('role', 'option');
                li.textContent = item.label;
                li.setAttribute('aria-selected', String(item.value === value));
                if (item.value === value) li.classList.add('selected');
                li.addEventListener('click', () => {
                    const changed = value !== item.value;
                    setValue(item.value);
                    close();
                    if (changed) onChange();
                });
                menu.appendChild(li);
            }
        }
        function setValue(v) {
            value = v;
            const item = items.find(i => i.value === v);
            labelSpan.textContent = item ? item.label : '';
            renderMenu();
        }

        return {
            setItems(newItems, selected) {
                items = newItems;
                const fallback = newItems.length ? newItems[0].value : null;
                setValue(selected !== undefined ? selected : fallback);
            },
            setDisabled(disabled) {
                toggle.disabled = disabled;
                if (disabled) close();
            },
            get value() { return value; },
        };
    }

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

    let regionDD, hubDD, villageDD;

    function currentSelection() {
        const region = state.manifest.regions.find(r => r.id === regionDD.value);
        const hub = region.hubs.find(h => h.id === hubDD.value);
        const village = hub.villages.find(v => v.id === villageDD.value) || null;
        return { region, hub, village };
    }

    function refreshHubs() {
        const region = state.manifest.regions.find(r => r.id === regionDD.value);
        hubDD.setItems(region.hubs.map(h => ({
            value: h.id,
            label: `${h.name} — ${h.dialect}`,
        })));
        refreshVillages();
    }

    function refreshVillages() {
        const region = state.manifest.regions.find(r => r.id === regionDD.value);
        const hub = region.hubs.find(h => h.id === hubDD.value);
        villageDD.setItems([
            { value: '', label: `Parlata cittadina (${hub.endonym})` },
            ...hub.villages.map(v => ({
                value: v.id,
                label: `${v.name} — ${v.dialect}`,
            })),
        ]);
        villageDD.setDisabled(hub.villages.length === 0);
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

    function initPickers() {
        regionDD.setItems(
            state.manifest.regions.map(r => ({ value: r.id, label: r.name })),
            'lombardia'
        );
        refreshHubs();
        reloadChain();
    }

    document.addEventListener('DOMContentLoaded', () => {
        // I menu esistono da subito; i dati arrivano sincroni da dialects.js
        // (fetch di dialects.json solo come ripiego).
        regionDD = createDropdown('regionDropdown', () => { refreshHubs(); reloadChain(); });
        hubDD = createDropdown('hubDropdown', () => { refreshVillages(); reloadChain(); });
        villageDD = createDropdown('villageDropdown', reloadChain);

        $('inputText').addEventListener('input', debounce(translateText, 250));
        $('copyButton').addEventListener('click', () => {
            navigator.clipboard.writeText($('outputText').value);
        });

        if (typeof window.DIALECTS !== 'undefined') {
            state.manifest = window.DIALECTS;
            initPickers();
        } else {
            fetchManifest()
                .then(manifest => { state.manifest = manifest; initPickers(); })
                .catch(err => {
                    $('dictInfo').textContent =
                        `Impossibile caricare dialects.json (${err.message}). Servire la cartella via HTTP.`;
                });
        }
    });
}

// Esporta le funzioni pure per i test in Node.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeKey, buildDictionary, tokenize, translate, preserveCapitalization };
}
