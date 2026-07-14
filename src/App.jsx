import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import manifest from './data/dialects.json';
import { buildDictionary, translate } from './lib/engine.js';
import Dropdown from './components/Dropdown.jsx';

function parseCSV(text) {
  const { data } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  return data;
}

export default function App() {
  const [regionId, setRegionId] = useState('lombardia');
  const [hubId, setHubId] = useState('milano');
  const [villageId, setVillageId] = useState('');
  const [chain, setChain] = useState([]);
  const [status, setStatus] = useState({ kind: 'loading', text: 'Caricamento dizionari…' });
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const dictCache = useRef(new Map());

  const region = manifest.regions.find((r) => r.id === regionId);
  const hub = region.hubs.find((h) => h.id === hubId) ?? region.hubs[0];
  const village = hub.villages.find((v) => v.id === villageId) ?? null;

  const selectRegion = (id) => {
    const next = manifest.regions.find((r) => r.id === id);
    setRegionId(id);
    setHubId(next.hubs[0].id);
    setVillageId('');
  };
  const selectHub = (id) => {
    setHubId(id);
    setVillageId('');
  };

  useEffect(() => {
    let cancelled = false;
    const loadDictionary = async (path, label) => {
      if (!dictCache.current.has(path)) {
        dictCache.current.set(
          path,
          fetch(`/${path}`).then(async (res) => {
            if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
            return buildDictionary(parseCSV(await res.text()), label);
          })
        );
      }
      return dictCache.current.get(path);
    };

    setStatus({ kind: 'loading', text: 'Caricamento dizionari…' });
    const wanted = village ? [[village.dict, village.dialect]] : [];
    wanted.push([hub.dict, hub.dialect]);
    Promise.all(wanted.map(([path, label]) => loadDictionary(path, label)))
      .then((dicts) => {
        if (cancelled) return;
        setChain(dicts);
        const parts = dicts.map((d) => `${d.label}: ${d.map.size} voci`);
        const place = village ? `${village.name}, ${hub.name}` : hub.name;
        setStatus({ kind: 'ok', text: `${place} (${region.name}) — ${parts.join(' + ')}` });
      })
      .catch((err) => {
        if (cancelled) return;
        setChain([]);
        setStatus({ kind: 'error', text: `Errore nel caricamento: ${err.message}` });
      });
    return () => {
      cancelled = true;
    };
  }, [region, hub, village]);

  const output = useMemo(() => translate(input, chain), [input, chain]);

  const copy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-cover p-5"
      style={{ backgroundImage: "url('/assets/flag.png')", backgroundSize: '100% 100%' }}
    >
      <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-lg">
        <header className="mb-5 text-center">
          <h1 className="text-3xl font-bold text-gray-800">Traduttore Dialettico</h1>
          <p className="mt-1 text-sm text-gray-500">
            Dall'italiano ai dialetti d'Italia: regione, città, paese.
          </p>
        </header>

        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Dropdown
            label="Regione"
            items={manifest.regions.map((r) => ({ value: r.id, label: r.name }))}
            value={regionId}
            onChange={selectRegion}
          />
          <Dropdown
            label="Città di riferimento"
            items={region.hubs.map((h) => ({
              value: h.id,
              label: `${h.name} — ${h.dialect}`,
            }))}
            value={hub.id}
            onChange={selectHub}
          />
          <Dropdown
            label="Paese / frazione"
            items={[
              { value: '', label: `Parlata cittadina (${hub.endonym})` },
              ...hub.villages.map((v) => ({
                value: v.id,
                label: `${v.name} — ${v.dialect}`,
              })),
            ]}
            value={villageId}
            onChange={setVillageId}
            disabled={hub.villages.length === 0}
          />
        </div>

        <p
          className={`mb-1 text-[13px] ${
            status.kind === 'error' ? 'text-red-700' : 'text-gray-600'
          }`}
        >
          {status.text}
        </p>
        <p className="mb-3 min-h-4 text-xs italic text-gray-500">{village?.note ?? ''}</p>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <div className="rounded-md bg-indigo-50 px-3 py-2.5 text-lg font-bold text-gray-800">
              Italiano
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={7}
              spellCheck={false}
              placeholder="Inserisci testo in italiano..."
              className="w-full resize-none rounded-md border border-gray-300 p-3 text-base
                         focus:outline-2 focus:outline-offset-2 focus:outline-red-700"
            />
          </section>

          <section className="flex flex-col gap-2">
            <div className="rounded-md bg-indigo-50 px-3 py-2.5 text-lg font-bold text-gray-800">
              Dialetto
            </div>
            <textarea
              value={output}
              readOnly
              rows={7}
              spellCheck={false}
              placeholder="Il testo tradotto apparirà qui..."
              className="w-full resize-none rounded-md border border-gray-300 bg-gray-50 p-3
                         text-base focus:outline-2 focus:outline-offset-2 focus:outline-red-700"
            />
          </section>

          <button
            type="button"
            onClick={copy}
            disabled={!output}
            className="cursor-pointer rounded-md bg-green-700 px-4 py-2.5 text-base font-bold
                       text-white hover:bg-green-800 disabled:cursor-not-allowed
                       disabled:opacity-60"
          >
            {copied ? 'Copiato!' : 'Copia traduzione'}
          </button>
        </div>
      </div>
    </div>
  );
}
