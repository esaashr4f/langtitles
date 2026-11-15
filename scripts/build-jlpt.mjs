// Builds extension/data/jlpt.json from Jonathan Waller's JLPT vocabulary lists
// (tanos.co.uk, CC BY), as matched to JMdict by github.com/stephenmk/yomichan-jlpt-vocab.
// Run: node scripts/build-jlpt.mjs
import { writeFileSync } from 'node:fs';

const BASE = 'https://cdn.jsdelivr.net/gh/stephenmk/yomichan-jlpt-vocab@main/original_data/';

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const kanji = {}; // written form with kanji -> level (5 = N5, easiest)
const kana = {}; // kana-only words -> level
for (const n of [5, 4, 3, 2, 1]) {
  const res = await fetch(`${BASE}n${n}.csv`);
  if (!res.ok) throw new Error(`n${n}: HTTP ${res.status}`);
  for (const [, reading, written] of parseCsv(await res.text())) {
    // A word listed at several levels counts at its easiest one.
    if (written) { if (!(written in kanji) || kanji[written] < n) kanji[written] = n; }
    else if (reading) { if (!(reading in kana) || kana[reading] < n) kana[reading] = n; }
  }
}
const out = { source: "Jonathan Waller's JLPT Resources (tanos.co.uk), CC BY; via stephenmk/yomichan-jlpt-vocab", kanji, kana };
writeFileSync(new URL('../extension/data/jlpt.json', import.meta.url), JSON.stringify(out));
console.log(`jlpt.json: ${Object.keys(kanji).length} words with kanji, ${Object.keys(kana).length} kana-only`);
