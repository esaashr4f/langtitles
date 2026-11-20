// The built-in Japanese dictionary (JMdict and KANJIDIC2 from EDRDG, CC BY-SA 4.0), loaded a small file
// at a time as words are looked up. Instant, free, and used to ground guides and find phrases.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});
  const shards = new Map(); // shard number -> Promise<map form -> entries>
  let meta = null;
  let kanji = null;

  async function json(path) {
    const res = await fetch(browser.runtime.getURL(path));
    if (!res.ok) throw new Error(path);
    return res.json();
  }
  async function info() {
    if (!meta) meta = json('data/dict/ja-words.json').catch(() => ({ shards: 0 }));
    return meta;
  }
  async function shardFor(form) {
    const m = await info();
    if (!m.shards || !form) return {};
    const n = form.codePointAt(0) % m.shards;
    if (!shards.has(n)) {
      shards.set(n, json(`data/dict/ja-words-${n}.json`).catch(() => ({})));
      if (shards.size > 24) shards.delete(shards.keys().next().value);
    }
    return shards.get(n);
  }

  // Entries written exactly as `form`.
  async function exact(form) {
    return (await shardFor(form))[form] || [];
  }

  // The best entries for a word as it appears (deinflected if needed); `d` is a dictionary form to try first.
  async function lookup(s, d) {
    for (const f of [d, s].filter(Boolean)) {
      const hit = await exact(f);
      if (hit.length) return { form: f, entries: hit, steps: [] };
    }
    for (const c of SG.deinflect.deinflect(s || d || '').slice(1)) {
      const hit = (await exact(c.form)).filter((e) => SG.deinflect.fits(e, c.type));
      if (hit.length) return { form: c.form, entries: hit, steps: c.steps };
    }
    return null;
  }

  async function kanjiInfo(ch) {
    if (!kanji) kanji = json('data/dict/ja-kanji.json').then((j) => j.kanji || {}).catch(() => ({}));
    return (await kanji)[ch] || null;
  }

  // Multi-word expressions in a line that the dictionary knows (歯切れが悪い, 店を出す, に関して):
  // runs of two to four words, the last one in its dictionary form. Returns [{ w: [indexes], d, entry }].
  // Only real expressions (JMdict "exp"), and only when the entry is read the way the line reads it:
  // 彼の is an entry read あの / かの ("that"), which is not 彼の read かれの ("his").
  const KANA = /^[\u3040-\u30ff\u30fc]*$/;
  const toHira = (t) => String(t || '').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  function readsAs(entry, words) {
    const parts = words.slice(0, -1).map((w) => (w.r ? w.r : KANA.test(w.s || '') ? w.s : null));
    if (parts.some((p) => p == null)) return false; // can't tell how the line reads it: don't guess
    const pre = toHira(parts.join(''));
    return (entry.r || []).some((r) => toHira(r).startsWith(pre));
  }
  async function expressions(words) {
    const found = [];
    for (let i = 0; i < words.length; i++) {
      for (let len = 4; len >= 2; len--) {
        const j = i + len - 1;
        if (j >= words.length) continue;
        const head = words.slice(i, j).map((w) => w.s).join('');
        const last = words[j];
        for (const tail of [last.s, last.d].filter(Boolean)) {
          const form = head + tail;
          const hit = (await exact(form)).find((e) => e.s.some((x) => /\bexp\b/.test(x[0])) && readsAs(e, words.slice(i, j + 1)));
          if (hit) {
            found.push({ w: Array.from({ length: len }, (_, n) => i + n), d: form, entry: hit });
            break;
          }
        }
        if (found.length && found[found.length - 1].w[0] === i) break;
      }
    }
    return found;
  }

  // A short text of what the dictionary says, for grounding a guide.
  function describe(res) {
    if (!res) return '';
    return res.entries.slice(0, 2).map((e) => `${(e.k[0] || e.r[0])} [${e.r.join(', ')}]: ` + e.s.map((x, i) => `${i + 1}. (${x[0]}) ${x[1]}`).join(' ')).join('\n');
  }

  // ---- Korean (Wiktionary via kaikki.org): looked up by dictionary form, with a few common endings
  // stripped when the form given is conjugated.
  let koMeta = null;
  const koShards = new Map();
  let hanja = null;
  async function koExact(form) {
    if (!koMeta) koMeta = json('data/dict/ko-words.json').catch(() => ({ shards: 0 }));
    const m = await koMeta;
    if (!m.shards || !form) return [];
    const n = form.codePointAt(0) % m.shards;
    if (!koShards.has(n)) koShards.set(n, json(`data/dict/ko-words-${n}.json`).catch(() => ({})));
    return (await koShards.get(n))[form] || [];
  }
  const KO_ENDINGS = ['습니다', '었습니다', '았습니다', '했습니다', '어요', '아요', '해요', '었어요', '았어요', '했어요', '었다', '았다', '했다', '어서', '아서', '해서', '지만', '는데', '은데', '고', '면', '으면', '니까', '으니까', '세요', '으세요', '겠다', '네요', '죠', '지요', '자', '어', '아', '해'];
  async function koLookup(s, d) {
    for (const f of [d, s].filter(Boolean)) {
      let hit = await koExact(f);
      const root = hit.find((x) => x.root);
      if (root) hit = await koExact(root.root);
      hit = hit.filter((x) => !x.root);
      if (hit.length) return { form: root ? root.root : f, entries: hit, steps: root ? [f] : [] };
    }
    for (const e of KO_ENDINGS) {
      if (s && s.endsWith(e) && s.length > e.length) {
        const stem = s.slice(0, -e.length);
        for (const f of [stem + '다', stem + (e.startsWith('해') || e.startsWith('했') ? '하다' : '다')]) {
          const hit = await koExact(f);
          if (hit.length) return { form: f, entries: hit, steps: [e] };
        }
      }
    }
    return null;
  }
  async function hanjaInfo(ch) {
    if (!hanja) hanja = json('data/dict/ko-hanja.json').catch(() => ({}));
    return (await hanja)[ch] || null;
  }

  // ---- Chinese (CC-CEDICT): simplified forms hold the entry; traditional forms point at them.
  let zhMeta = null;
  const zhShards = new Map();
  async function zhExact(form, depth) {
    if (!zhMeta) zhMeta = json('data/dict/zh-words.json').catch(() => ({ shards: 0 }));
    const m = await zhMeta;
    if (!m.shards || !form) return [];
    const n = form.codePointAt(0) % m.shards;
    if (!zhShards.has(n)) {
      zhShards.set(n, json(`data/dict/zh-words-${n}.json`).catch(() => ({})));
      if (zhShards.size > 16) zhShards.delete(zhShards.keys().next().value);
    }
    const list = (await zhShards.get(n))[form] || [];
    const out = [];
    for (const e of list) {
      if (typeof e === 'string') {
        if (!depth) out.push(...(await zhExact(e, 1)).map((x) => Object.assign({ s: e }, x)));
      } else out.push(Object.assign({ s: form }, e));
    }
    return out;
  }

  // One entry point for the word card: { source, form, entries } in a common shape.
  async function card(lang, s, d) {
    if (lang === 'ko') {
      const r = await koLookup(s, d);
      if (!r) return null;
      return { source: 'Wiktionary', form: r.form, entries: r.entries.slice(0, 2).map((e) => ({ head: e.w, read: e.h || '', senses: e.s.map((g) => [e.p, g]), common: false })) };
    }
    if (lang === 'zh') {
      for (const f of [d, s].filter(Boolean)) {
        const hit = await zhExact(f);
        if (hit.length) return { source: 'CC-CEDICT', form: f, entries: hit.slice(0, 2).map((e) => ({ head: e.s + (e.t ? ` (${e.t})` : ''), read: e.p, senses: e.d.map((g) => ['', g]), common: false })) };
      }
      return null;
    }
    if (lang === 'ja') {
      const r = await lookup(s, d);
      if (!r) return null;
      return { source: 'JMdict', form: r.form, steps: r.steps, entries: r.entries.slice(0, 2).map((e) => ({ head: e.k[0] || e.r[0], read: e.k.length ? e.r.join('、') : '', senses: e.s, common: Boolean(e.c) })) };
    }
    return null;
  }

  SG.dict = { lookup, exact, kanjiInfo, expressions, describe, koLookup, hanjaInfo, zhExact, card };
})(typeof globalThis !== 'undefined' ? globalThis : this);
