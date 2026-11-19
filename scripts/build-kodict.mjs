// Builds the built-in Korean dictionary from the English Wiktionary extract at kaikki.org
// (Wiktionary, CC BY-SA 4.0 / GFDL):  node scripts/build-kodict.mjs <kaikki.org-dictionary-Korean.jsonl>
// Writes extension/data/dict/ko-words-N.json (sharded by first character) and ko-hanja.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [src] = process.argv.slice(2);
if (!src) {
  console.error('usage: node scripts/build-kodict.mjs kaikki.org-dictionary-Korean.jsonl');
  process.exit(1);
}
const out = new URL('../extension/data/dict/', import.meta.url);
mkdirSync(out, { recursive: true });
const KEEP = new Set(['noun', 'verb', 'adj', 'adv', 'suffix', 'prefix', 'intj', 'num', 'pron', 'det', 'particle', 'phrase', 'proverb', 'counter', 'postp', 'conj']);
const SHARDS = 16;
const shards = Array.from({ length: SHARDS }, () => ({}));
const hanja = {};
let n = 0;
for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line) continue;
  let d;
  try {
    d = JSON.parse(line);
  } catch (e) {
    continue;
  }
  const word = d.word;
  if (!word) continue;
  const senses = (d.senses || []).filter((s) => Array.isArray(s.glosses) && s.glosses.length && !s.form_of && !s.alt_of && !(s.tags || []).includes('form-of'));
  if (d.pos === 'character') {
    // Hanja: the Korean reading (eumhun) and meaning.
    const eum = (d.forms || []).find((f) => (f.tags || []).includes('eumhun'));
    const gl = senses.flatMap((s) => s.glosses).slice(0, 3);
    if (eum || gl.length) hanja[word] = { e: eum ? eum.form : '', m: gl.join('; ') };
    continue;
  }
  // Conjugated forms (먹어요) point at their dictionary form (먹다).
  const formOf = (d.head_templates || []).find((t) => /-form$/.test(t.name || '') && t.args && t.args.root);
  if (formOf && /[가-힣]/.test(word)) {
    const sh = shards[word.codePointAt(0) % SHARDS];
    (sh[word] = sh[word] || []).push({ w: word, root: formOf.args.root });
    continue;
  }
  if (!KEEP.has(d.pos) || !senses.length || !/[가-힣]/.test(word)) continue;
  const hj = (d.forms || []).find((f) => (f.tags || []).includes('hanja'));
  // No romanization in glosses: "(meokda, “to eat”)" becomes "(“to eat”)".
  const clean = (g) => g.replace(/\(([A-Za-z'’\- ]+), “/g, '(“').slice(0, 160);
  const entry = { w: word, p: d.pos, s: senses.slice(0, 4).map((s) => clean(s.glosses.slice(-1)[0])) };
  if (hj) entry.h = hj.form;
  const sh = shards[word.codePointAt(0) % SHARDS];
  (sh[word] = sh[word] || []).push(entry);
  n++;
}
shards.forEach((sh, i) => writeFileSync(new URL(`ko-words-${i}.json`, out), JSON.stringify(sh)));
writeFileSync(new URL('ko-words.json', out), JSON.stringify({ source: 'Wiktionary via kaikki.org (CC BY-SA 4.0)', shards: SHARDS, entries: n }));
writeFileSync(new URL('ko-hanja.json', out), JSON.stringify(hanja));
console.log('korean words', n, 'hanja', Object.keys(hanja).length);
