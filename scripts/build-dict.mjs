// Builds the built-in Japanese dictionary from EDRDG's JMdict and KANJIDIC2 (CC BY-SA 4.0):
//   node scripts/build-dict.mjs <path to JMdict_e> <path to kanjidic2.xml>
// Writes extension/data/dict/ja-words.json and ja-kanji.json. Keeps common words (priority-tagged),
// all expressions (set phrases, compound particles: に関して, 歯切れが悪い) and the senses' English glosses.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [jmPath, kdPath] = process.argv.slice(2);
if (!jmPath || !kdPath) {
  console.error('usage: node scripts/build-dict.mjs JMdict_e kanjidic2.xml');
  process.exit(1);
}
const out = new URL('../extension/data/dict/', import.meta.url);
mkdirSync(out, { recursive: true });

const all = (re, s) => Array.from(s.matchAll(re), (m) => m[1]);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const COMMON = /news1|ichi1|spec1|spec2|gai1/;
// Part-of-speech codes kept short; anything else is dropped from the tag list.
const POS = /^&(n|n-adv|n-t|n-suf|n-pref|pn|adj-i|adj-na|adj-no|adj-t|adj-pn|adv|adv-to|aux|aux-v|aux-adj|conj|cop|ctr|exp|int|pref|prt|suf|v1|v5[a-z]+|vk|vs|vs-i|vs-s|vz|vi|vt|unc|num|pron)[;]$/;

const xml = readFileSync(jmPath, 'utf8');
const words = [];
let kept = 0;
for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  const e = m[1];
  const kEle = Array.from(e.matchAll(/<k_ele>([\s\S]*?)<\/k_ele>/g), (x) => x[1]);
  const rEle = Array.from(e.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/g), (x) => x[1]);
  const common = kEle.concat(rEle).some((x) => COMMON.test(all(/<(?:ke|re)_pri>([^<]+)</g, x).join(' ')));
  const senses = Array.from(e.matchAll(/<sense>([\s\S]*?)<\/sense>/g), (x) => x[1]);
  const isExp = /<pos>&exp;<\/pos>/.test(e);
  const k = kEle.map((x) => decode(all(/<keb>([^<]+)</g, x)[0] || '')).filter(Boolean);
  const r = rEle.map((x) => decode(all(/<reb>([^<]+)</g, x)[0] || '')).filter(Boolean);
  let lastPos = [];
  const s = [];
  for (const sense of senses.slice(0, 5)) {
    const pos = all(/<pos>([^<]+)</g, sense).filter((p) => POS.test(p)).map((p) => p.slice(1, -1));
    if (pos.length) lastPos = pos;
    const gl = all(/<gloss[^>]*>([^<]+)</g, sense).map(decode).slice(0, 4).join('; ');
    if (gl) s.push([lastPos.slice(0, 3).join(','), gl]);
  }
  if (!r.length || !s.length) continue;
  // Rare words keep two senses; common words and expressions keep up to five.
  // Rare loanwords written only in katakana are left out (the analysis handles them); rare words keep
  // their first sense, common words and expressions up to five.
  if (!common && !isExp && !k.length && r.every((x) => /^[\u30a0-\u30ff・ー]+$/.test(x))) continue;
  const entry = common ? { k, r, s, c: 1 } : { k, r, s: isExp ? s : s.slice(0, 1) };
  // Words usually written in kana are found by their reading too.
  if (/<misc>&uk;<\/misc>/.test(e)) entry.uk = 1;
  words.push(entry);
  kept++;
}
// Sharded by the first character of each written form, so a lookup loads one small file.
const SHARDS = 64;
const shards = Array.from({ length: SHARDS }, () => ({}));
const shardOf = (form) => form.codePointAt(0) % SHARDS;
words.forEach((w) => {
  const forms = w.k.length ? (w.uk ? w.k.concat(w.r) : w.k) : w.r;
  for (const f of new Set(forms)) {
    const sh = shards[shardOf(f)];
    (sh[f] = sh[f] || []).push(w);
  }
});
let total = 0;
shards.forEach((sh, i) => {
  const text = JSON.stringify(sh);
  total += text.length;
  writeFileSync(new URL(`ja-words-${i}.json`, out), text);
});
writeFileSync(new URL('ja-words.json', out), JSON.stringify({ source: 'JMdict (EDRDG, CC BY-SA 4.0)', shards: SHARDS, entries: kept }));
console.log('words', kept, 'total bytes', total);

const kd = readFileSync(kdPath, 'utf8');
const kanji = {};
for (const m of kd.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
  const c = m[1];
  const lit = all(/<literal>([^<]+)</g, c)[0];
  const grade = Number(all(/<grade>(\d+)</g, c)[0] || 0);
  const freq = Number(all(/<freq>(\d+)</g, c)[0] || 0);
  const jlpt = Number(all(/<jlpt>(\d+)</g, c)[0] || 0);
  if (!grade && !freq && !jlpt) continue;
  kanji[lit] = {
    m: all(/<meaning>([^<]+)</g, c).map(decode).slice(0, 5),
    on: all(/<reading r_type="ja_on">([^<]+)</g, c),
    kun: all(/<reading r_type="ja_kun">([^<]+)</g, c),
    st: Number(all(/<stroke_count>(\d+)</g, c)[0] || 0),
    g: grade || undefined,
    f: freq || undefined,
    j: jlpt || undefined,
  };
}
writeFileSync(new URL('ja-kanji.json', out), JSON.stringify({ source: 'KANJIDIC2 (EDRDG, CC BY-SA 4.0)', kanji }));
console.log('kanji', Object.keys(kanji).length);
