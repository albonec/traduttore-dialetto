import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDictionary, translate } from '../src/lib/engine.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(root, 'src/data/dialects.json'), 'utf8'));

function loadCSV(rel) {
  const text = readFileSync(path.join(root, 'public', rel), 'utf8').trim();
  return text
    .split('\n')
    .slice(1)
    .map((line) => {
      const idx = line.indexOf(',');
      return { italiano: line.slice(0, idx), traduzione: line.slice(idx + 1) };
    });
}

// 1. Every dict referenced in the manifest exists and parses
let dictCount = 0;
for (const region of manifest.regions) {
  for (const hub of region.hubs) {
    for (const entry of [hub, ...hub.villages]) {
      const rows = loadCSV(entry.dict);
      if (!rows.length) throw new Error(`empty dict: ${entry.dict}`);
      buildDictionary(rows, entry.dialect);
      dictCount++;
    }
  }
}
console.log(`OK manifest: ${dictCount} dictionaries load and parse`);

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}: "${actual}"${ok ? '' : ` (expected "${expected}")`}`);
}

// 2. Bresciano hub: multi-word phrase + single words + punctuation + caps
const bresciano = [buildDictionary(loadCSV('dictionaries/lombardia/brescia/bresciano.csv'), 'Bresciano')];
const lonato = [
  buildDictionary(loadCSV('dictionaries/lombardia/brescia/lonatino.csv'), 'Lonatino'),
  ...bresciano,
];
check('bresciano caps+punct', translate('Testa, cuore!', bresciano), 'Có, cör!');
check('lonatino phrase', translate('io vado a casa', lonato), "me 'ndó a ca'");
check('lonatino phrase caps', translate('Devo andare, una volta.', lonato), "Gó de na, 'na ólta.");

// 3. Camuno overlay beats hub, rest falls back
const camuno = [
  buildDictionary(loadCSV('dictionaries/lombardia/brescia/camuno.csv'), 'Camuno'),
  ...bresciano,
];
check('camuno overlay', translate('cinque', camuno), 'hich');
check('camuno fallback', translate('cuore', camuno), 'cör');

// 4. Chioggiotto overlay on Venetian: bello differs, soldi falls back
const chioggia = [
  buildDictionary(loadCSV('dictionaries/veneto/venezia/chioggiotto.csv'), 'Chioggiotto'),
  buildDictionary(loadCSV('dictionaries/veneto/venezia/veneziano.csv'), 'Veneziano'),
];
check('chioggiotto overlay', translate('bello', chioggia), 'bèlo');
check('venezian direct', translate('bello', chioggia.slice(1)), 'bèo');
check('chioggiotto fallback', translate('soldi', chioggia), 'schèi');

// 5. Elision, unknown words pass through, newlines preserved
const nap = [buildDictionary(loadCSV('dictionaries/campania/napoli/napoletano.csv'), 'Napoletano')];
check('elision', translate("l'uomo", nap), "l'ommo");
check('unknown passthrough', translate('xilofono blu', nap), 'xilofono blu');
check('newline', translate('testa\nsoldi', nap), 'capa\nsorde');
check('phrase napoletano', translate('Come stai?', nap), 'Comme staje?');

// 6. Uppercase word
const sic = [buildDictionary(loadCSV('dictionaries/sicilia/palermo/palermitano.csv'), 'Palermitano')];
check('all caps', translate('SOLDI', sic), 'PICCIULI');

// 7. Empty chain returns input untouched
check('empty chain', translate('ciao mondo', []), 'ciao mondo');

// 8. Franco-Provençal village overlays the Piemontese hub
const fp = [
  buildDictionary(loadCSV('dictionaries/piemonte/torino/francoprovenzale-mocchie.csv'), 'Francoprovenzale'),
  buildDictionary(loadCSV('dictionaries/piemonte/torino/piemontese.csv'), 'Piemontese'),
];
check('francoprovenzale overlay', translate('acqua', fp), 'aiva');
check('piemontese fallback', translate('grazie', fp), 'mersì');

// 9. Logudorese (Nuoro)
const log = [buildDictionary(loadCSV('dictionaries/sardegna/nuoro/logudorese.csv'), 'Logudorese')];
check('logudorese', translate('domani mangiare', log), 'cras mandigare');

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll engine tests passed');
