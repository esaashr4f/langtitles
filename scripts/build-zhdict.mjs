// Builds the built-in Chinese dictionary from CC-CEDICT (MDBG, CC BY-SA 4.0):
//   node scripts/build-zhdict.mjs <cedict_1_0_ts_utf-8_mdbg.txt>
// Writes extension/data/dict/zh-words-N.json, keyed by simplified and traditional forms, with pinyin in
// tone marks (ni3 hao3 -> nǐ hǎo).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [src] = process.argv.slice(2);
if (!src) {
  console.error('usage: node scripts/build-zhdict.mjs cedict_ts.u8');
  process.exit(1);
}
const out = new URL('../extension/data/dict/', import.meta.url);
mkdirSync(out, { recursive: true });
const MARKS = { a: 'āáǎàa', e: 'ēéěèe', i: 'īíǐìi', o: 'ōóǒòo', u: 'ūúǔùu', ü: 'ǖǘǚǜü' };
function syllable(s) {
  const m = /^([a-zü:]+)([1-5])$/i.exec(s);
  if (!m) return s;
  let [, base, tone] = m;
  base = base.replace(/u:/g, 'ü').replace(/v/g, 'ü');
  const t = Number(tone) - 1;
  const lower = base.toLowerCase();
  let at = lower.search(/[ae]/);
  if (at < 0) at = lower.indexOf('ou');
  if (at < 0) {
    for (let i = lower.length - 1; i >= 0; i--) if (MARKS[lower[i]]) { at = i; break; }
  }
  if (at < 0) return base;
  const v = lower[at];
  return base.slice(0, at) + MARKS[v][t] + base.slice(at + 1);
}
const SHARDS = 32;
const shards = Array.from({ length: SHARDS }, () => ({}));
let n = 0;
for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const m = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/.exec(line);
  if (!m) continue;
  const [, trad, simp, py, defs] = m;
  const senses = defs.split('/').filter((d) => d && !/^(see also|variant of|old variant|surname)/i.test(d)).slice(0, 4);
  if (!senses.length) continue;
  const entry = { p: py.split(' ').map(syllable).join(' '), d: senses.slice(0, 3) };
  if (trad !== simp) entry.t = trad;
  const put = (f, v) => {
    const sh = shards[f.codePointAt(0) % SHARDS];
    (sh[f] = sh[f] || []).push(v);
  };
  put(simp, entry);
  // The traditional form points at the simplified one, stored once.
  if (trad !== simp) put(trad, simp);
  n++;
}
shards.forEach((sh, i) => writeFileSync(new URL(`zh-words-${i}.json`, out), JSON.stringify(sh)));
writeFileSync(new URL('zh-words.json', out), JSON.stringify({ source: 'CC-CEDICT (MDBG, CC BY-SA 4.0)', shards: SHARDS, entries: n }));
console.log('chinese words', n);
