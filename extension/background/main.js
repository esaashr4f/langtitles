// Background page: owns the API key, the analysis queue and the captured subtitle tracks.
(function (root) {
  'use strict';
  const SG = root.SG;
  const { claude, cache, sniffer, prompt } = SG;

  let settings = Object.assign({}, SG.DEFAULTS);
  const ready = SG.loadSettings().then((s) => {
    settings = s;
  });

  // Saved guides get any pending library fixes once (rewritten guides, phrases instead of words…).
  ready.then(() => SG.libraryFixes.applyAll(cache, (k) => guideKey(k))).catch((e) => console.warn('Langtitles: library fixes', e));
  ready.then(() => mergeDuplicateGuides()).catch((e) => console.warn('Langtitles: guide merge', e));

  // Guides saved under different names for the same form (ko.casual_speech / ko.casual_banmal …) become one:
  // the oldest text is kept, notes and lines met are combined, the duplicates go to history. Runs once per
  // change to the name list.
  const MERGE_VERSION = 2; // 2: Chinese name matching and built-in Chinese guides
  async function mergeDuplicateGuides() {
    const done = (await browser.storage.local.get('guideMergeVersion')).guideMergeVersion || 0;
    if (done >= MERGE_VERSION) return;
    const all = await cache.getAll('guides');
    const byKey = new Map(all.map((g) => [g.key, g]));
    let merged = 0;
    for (const g of all) {
      if (!g.k || /^(word|phrase|song|show)\./.test(g.k) || g.kind === 'song') continue;
      const want = SG.canonicalForm(g.k);
      if (want === g.k) continue;
      const newKey = guideKey(want);
      const target = byKey.get(newKey);
      if (target) {
        const keep = (target.savedAt || 0) <= (g.savedAt || 0) ? target : g;
        const other = keep === target ? g : target;
        const combined = Object.assign({}, keep, {
          key: newKey, k: want,
          notes: (keep.notes || []).concat((other.notes || []).filter((n) => !(keep.notes || []).some((m) => m.text === n.text))),
          encounters: (keep.encounters || []).concat(other.encounters || []).slice(-30),
        });
        await cache.putMany('guides', [[newKey, combined]]);
        await cache.putMany('history', [[g.key + '|merged|' + Date.now(), Object.assign({}, other, { retiredAt: Date.now(), mergedInto: newKey })]]);
        byKey.set(newKey, combined);
      } else {
        await cache.putMany('guides', [[newKey, Object.assign({}, g, { key: newKey, k: want })]]);
        byKey.set(newKey, g);
      }
      await cache.remove('guides', g.key);
      byKey.delete(g.key);
      merged++;
    }
    // Korean and Chinese grammar guides written from a single line give way to the built-in ones (notes and lines kept).
    let swapped = 0;
    for (const g of byKey.values()) {
      if (!g || !/^(ko|zh)\./.test(g.k || '') || g.model === 'built-in') continue;
      const built = await builtinGuide(g.k);
      if (!built) continue;
      await cache.putMany('history', [[g.key + '|builtin|' + Date.now(), Object.assign({}, g, { retiredAt: Date.now() })]]);
      await cache.putMany('guides', [[g.key, Object.assign({}, g, { text: built.text, name: built.name, model: 'built-in', updatedAt: Date.now() })]]);
      swapped++;
    }
    await browser.storage.local.set({ guideMergeVersion: MERGE_VERSION });
    if (merged || swapped) await browser.storage.local.set({ libraryFixNote: { seen: false, summary: swapped ? [{ added: swapped, retired: 0 }] : [], merged } });
  }

  const ports = new Map(); // tabId -> Set(port)
  const tabStatus = new Map(); // tabId -> last state reported by the content script
  let lastError = null;

  // ---- concurrency -------------------------------------------------------

  let running = 0;
  const waiting = [];

  function withSlot(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        running++;
        fn().then(resolve, reject).finally(() => {
          running--;
          const next = waiting.shift();
          if (next) next();
        });
      };
      if (running < Math.max(1, settings.concurrency || 1)) run();
      else waiting.push(run);
    });
  }

  // ---- analysis ----------------------------------------------------------

  const inflight = new Map(); // cache key -> promise of analysis

  function fingerprint() {
    return [prompt.PROMPT_VERSION, claude.lineModelOf(settings), settings.nativeLang].join('|');
  }

  // Ask Claude for a batch; if the reply was cut off, split the batch and try the halves.
  // Settings for one request, tagged with the tab it is for, so its cost can be shown there.
  const tabShows = new Map(); // tabId -> show / episode name, for the spending log
  function forTab(tabId) {
    return Object.assign({}, settings, { costTag: tabId, costShow: tabShows.get(tabId) || '' });
  }

  async function analyzeBatch(texts, context, langHint, s, song) {
    try {
      return await withSlot(() => claude.analyzeLines(s || settings, texts, context, langHint, song));
    } catch (err) {
      if (err.code === 'truncated' && texts.length > 1) {
        const mid = Math.ceil(texts.length / 2);
        const first = await analyzeBatch(texts.slice(0, mid), context, langHint, s, song);
        const second = await analyzeBatch(texts.slice(mid), context.concat(texts.slice(0, mid)).slice(-3), langHint, s, song);
        return first.concat(second);
      }
      throw err;
    }
  }

  // A guide to a whole song, written once and kept with the other guides (kind 'song').
  async function songGuide(req, onPart) {
    await ready;
    const key = 'song.' + SG.lyrics.songKey(req);
    if (!req.again) {
      const have = (await cache.getMany('guides', [key])).get(key);
      if (have && have.text) return { text: have.text, model: have.model, cached: true };
    }
    if (!settings.apiKey) return { error: 'Add your Anthropic API key in Options first.' };
    const model = req.model || SG.modelFor(settings, 'songGuides');
    let sofar = '';
    const raw = await claude.songGuide(forTab(null), Object.assign({ model }, req), (d) => {
      sofar += d;
      if (onPart) onPart(sofar);
    });
    const text = SG.guideText ? SG.guideText.stripRomaji(raw) : raw;
    await cache.putMany('guides', [[key, {
      key, k: key, name: `${req.track}${req.artist ? ' — ' + req.artist : ''}`, kind: 'song', lang: req.lang || '', nativeLang: settings.nativeLang,
      text, sentence: '', word: '', model, savedAt: Date.now(), song: { track: req.track, artist: req.artist || '', album: req.album || '', art: req.art || '', url: req.url || '' },
    }]]);
    return { text, model, cached: false };
  }

  // Every saved breakdown also lives under a version-free key, so updates and model changes never make an
  // episode get bought again. Lines saved before this existed are found by trying the older versions.
  const LINE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'];
  function anyKey(lineKey, song) {
    return ['any', settings.nativeLang, song ? 'song' : 'sub', lineKey].join('|');
  }
  async function savedLines(lines, song) {
    const out = new Map();
    if (!lines.length) return out;
    const fp = fingerprint();
    const cur = (l) => fp + (song ? '|song' : '') + '|' + l.key;
    const first = await cache.getMany('lines', lines.flatMap((l) => [cur(l), anyKey(l.key, song)]));
    let missing = [];
    for (const l of lines) {
      const a = first.get(cur(l)) || first.get(anyKey(l.key, song));
      if (a) out.set(l.key, a.fp && a.fp !== fp ? Object.assign({}, a, { older: true }) : a);
      else missing.push(l);
    }
    // Older versions and other line models (only for lines not found above).
    for (let v = prompt.PROMPT_VERSION; v >= 1 && missing.length; v--) {
      const fps = LINE_MODELS.map((m) => [v, m, settings.nativeLang].join('|')).filter((x) => x !== fp);
      const keys = missing.flatMap((l) => fps.map((f) => f + (song ? '|song' : '') + '|' + l.key));
      const got = await cache.getMany('lines', keys);
      const still = [];
      for (const l of missing) {
        const hit = fps.map((f) => got.get(f + (song ? '|song' : '') + '|' + l.key)).find(Boolean);
        if (hit) {
          out.set(l.key, Object.assign({}, hit, { older: true }));
          cache.putMany('lines', [[anyKey(l.key, song), Object.assign({ fp: 'older' }, hit)]]).catch(() => {});
        } else still.push(l);
      }
      missing = still;
    }
    return out;
  }

  // lines: [{ key, text }]. Resolves to { results: { key: analysis }, error? }.
  async function analyze(req, tabId) {
    await ready;
    const fp = fingerprint();
    const results = {};
    // Song lines are analysed with the song's own rules (sung readings, poetic forms), so cached apart.
    const fullKey = (l) => fp + (req.song ? '|song' : '') + '|' + l.key;
    // Saved breakdowns are reused whatever version or line model wrote them (marked "older"); a redo
    // (req.force) is the only way a saved line is bought again.
    const saved = req.force ? new Map() : await savedLines(req.lines, Boolean(req.song));
    const pending = [];
    const fresh = [];
    for (const line of req.lines) {
      const k = fullKey(line);
      if (saved.has(line.key)) results[line.key] = saved.get(line.key);
      else if (inflight.has(k)) pending.push(inflight.get(k).then((a) => a && (results[line.key] = a)));
      else if (!req.savedOnly) fresh.push(line);
    }
    let error = null;
    if (fresh.length) {
      const batch = analyzeBatch(fresh.map((l) => l.text), req.context || [], req.lang, forTab(tabId), req.song || null);
      fresh.forEach((line, i) => {
        const p = batch.then((out) => out[i], () => null);
        inflight.set(fullKey(line), p);
        p.finally(() => inflight.delete(fullKey(line)));
      });
      try {
        const out = await batch;
        const store = [];
        fresh.forEach((line, i) => {
          if (!out[i]) return;
          results[line.key] = out[i];
          store.push([fullKey(line), out[i]], [anyKey(line.key, Boolean(req.song)), Object.assign({ fp }, out[i])]);
        });
        cache.putMany('lines', store).catch(() => {});
        lastError = null;
      } catch (err) {
        error = { code: err.code || 'unknown', message: err.message };
        lastError = Object.assign({ at: Date.now() }, error);
      }
    }
    await Promise.all(pending);
    for (const a of Object.values(results)) await addDictPhrases(a).catch(() => {});
    return { results, error };
  }

  // Set phrases and compound particles the dictionary knows (歯切れが悪い, 店を出す, に関して) are added to
  // a Japanese line's phrases when the analysis didn't list them. Local and free.
  async function addDictPhrases(a) {
    if (!a || !Array.isArray(a.w) || !a.w.length || !/^ja/.test(a.lang || '')) return;
    const have = (a.phrases || []).map((p) => (p.w || []).join(','));
    const covered = new Set((a.phrases || []).flatMap((p) => p.w || []));
    const found = await SG.dict.expressions(a.w);
    const add = [];
    for (const f of found) {
      if (have.includes(f.w.join(',')) || f.w.every((i) => covered.has(i))) continue;
      const allParticles = f.w.every((i) => /particle|助詞/i.test(a.w[i].pos || '') || (a.w[i].s || '').length <= 2);
      const gloss = (f.entry.s[0] || ['', ''])[1].split(';')[0].replace(/\s*\.\.\.\s*/g, ' ').trim();
      add.push({ w: f.w, kind: allParticles ? 'compound particle' : 'set phrase', d: f.d, r: f.entry.k.length ? f.entry.r[0] : '', m: gloss, k: 'phrase.ja.' + f.d, b: [], fromDict: true });
      f.w.forEach((i) => covered.add(i));
    }
    if (add.length) a.phrases = (a.phrases || []).concat(add);
  }

  function guideKey(k) {
    return ['guide', prompt.GUIDE_VERSION, settings.nativeLang, k].join('|');
  }

  const guidesInflight = new Map(); // guide key -> Set(port, reqId) waiting for it

  // Guides that ship with Langtitles (extension/data/grammar/<lang>.json): no request needed.
  const builtinGuides = new Map();
  async function builtinGuide(k) {
    const lang = String(k).split('.')[0];
    if (!/^[a-z]{2}$/.test(lang) || settings.nativeLang !== 'English') return null;
    if (!builtinGuides.has(lang)) {
      builtinGuides.set(lang, fetch(browser.runtime.getURL(`data/grammar/${lang}.json`)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    }
    const data = await builtinGuides.get(lang);
    return data && data.forms && data.forms[k] ? data.forms[k] : null;
  }

  const norm = (t) => String(t || '').replace(/\s+/g, '');
  // Each line a guide is opened in is remembered (free). Claude checks the guide against the line only when
  // the learner asks ("This doesn't match"); the guide itself is never changed by a check.
  async function checkEncounter(req, key, guide, port, force) {
    if (!req.sentence) return;
    const line = norm(req.sentence);
    const encounters = Array.isArray(guide.encounters) ? guide.encounters.slice() : [];
    const seen = encounters.find((e) => e.line === line);
    if (!force) {
      if (seen && seen.why) send(port, { type: 'deepNote', reqId: req.reqId, why: seen.why, other: seen.other || '' });
      if (!seen) {
        const entry = { line, sentence: req.sentence, meaning: req.meaning || '', word: req.word || '', at: Date.now() };
        const updated = Object.assign({}, guide, { encounters: encounters.concat(entry).slice(-30) });
        await cache.putMany('guides', [[key, updated]]);
      }
      return;
    }
    if (!settings.apiKey) return;
    const res = await claude.matchGuide(forTab(port.sender && port.sender.tab ? port.sender.tab.id : -1), req, guide.text, false);
    bumpGuideStat('checks');
    const entry = { line, sentence: req.sentence, meaning: req.meaning || '', word: req.word || '', at: Date.now(), covered: Boolean(res.covered), why: res.covered ? '' : res.why || '', other: res.covered ? '' : res.other_form || '' };
    const updated = Object.assign({}, guide, { encounters: encounters.filter((e) => e.line !== line).concat(entry).slice(-30) });
    await cache.putMany('guides', [[key, updated]]);
    send(port, { type: 'deepNote', reqId: req.reqId, why: entry.why, other: entry.other, covered: entry.covered });
  }

  // A grammar form's label without the word it was met on ("object marker 을 웃음을" -> "object marker 을").
  function generalName(name) {
    // The page already trims the word it was met on off the label.
    return String(name || '').trim();
  }

  // How often guides are written vs. opened from what's saved (shown in Progress → Spending).
  async function bumpGuideStat(kind) {
    const st = (await browser.storage.local.get('guideStats')).guideStats || { written: 0, reused: 0, checks: 0, since: Date.now() };
    st[kind] = (st[kind] || 0) + 1;
    await browser.storage.local.set({ guideStats: st });
  }

  // The dictionary's headword for a word guide, so 원해 and 원하다 (or two spellings the line breakdown
  // gave) share one guide.
  async function headwordFor(lang, word, dict) {
    const l = String(lang || '').slice(0, 2);
    if (l !== 'ja' && l !== 'ko') return null;
    try {
      const card = await SG.dict.card(l, word, dict);
      return card && card.form ? card.form : null;
    } catch (e) {
      return null;
    }
  }

  // Sections of older guides that were about one line, not the item: hidden when a guide is shown.
  const LINE_SECTIONS = ['Where you met it', 'Other uses you\'ve met'];

  async function explainGuide(req, port) {
    await ready;
    if (req.kind !== 'wordguide') req.form = Object.assign({}, req.form, { k: SG.canonicalForm(req.form.k) });
    // Guides retired by a library fix (関する -> に関して, なり -> the なり grammar guide…) open their replacement.
    const aliases = (await browser.storage.local.get('guideAliases')).guideAliases || {};
    const alias = aliases[req.form.k];
    if (alias) {
      req.form = Object.assign({}, req.form, { k: alias });
      if (!alias.startsWith('word.')) req.kind = 'guide';
    }
    // Word guides live under the dictionary's headword; one saved under the form the breakdown gave moves there.
    if (req.kind === 'wordguide' && !req.phrase && /^word\./.test(req.form.k)) {
      const lang = req.form.k.split('.')[1];
      const head = await headwordFor(lang, req.word, req.dict);
      const want = head ? `word.${lang}.${head}` : req.form.k;
      if (want !== req.form.k) {
        const oldKey = guideKey(req.form.k);
        const newKey = guideKey(want);
        const got = await cache.getMany('guides', [oldKey, newKey]);
        if (!got.get(newKey) && got.get(oldKey)) {
          await cache.putMany('guides', [[newKey, Object.assign({}, got.get(oldKey), { key: newKey, k: want })]]);
          await cache.remove('guides', oldKey);
        }
        req.form = Object.assign({}, req.form, { k: want });
        req.dict = head;
      }
    }
    const key = guideKey(req.form.k);
    const hit = (await cache.getMany('guides', [key])).get(key);
    const prevGuide = hit || null;
    if (hit && !req.improve) {
      // A saved guide opens for free; the line is only remembered (a paid check only when asked for).
      port.postMessage({ type: 'deepDone', reqId: req.reqId, text: SG.guideText.withoutSections(hit.text, LINE_SECTIONS), model: hit.model || '', sentence: hit.sentence || '', notes: hit.notes || [], name: hit.name || '' });
      if (!req.force) bumpGuideStat('reused');
      checkEncounter(req, key, hit, port, Boolean(req.force)).catch(() => {});
      return;
    }
    // The same form can be hovered in several places at once; write its guide only once.
    if (guidesInflight.has(key)) {
      guidesInflight.get(key).push({ port, reqId: req.reqId });
      return;
    }
    const built = req.kind === 'wordguide' || req.improve ? null : await builtinGuide(req.form.k);
    if (built) {
      // Keep a copy with the guides you've met, so it shows in the Library.
      cache.putMany('guides', [[key, {
        key, k: req.form.k, name: built.name, kind: 'grammar', lang: req.lang || '', nativeLang: settings.nativeLang,
        text: built.text, sentence: req.sentence || '', word: req.word || '', model: 'built-in', savedAt: Date.now(),
      }]]).catch(() => {});
      if (settings.addGrammarToReview) {
        bankSave({ kind: 'grammar', lang: req.lang || '', text: req.form.k, name: built.name, context: req.sentence ? { sentence: req.sentence, savedAt: Date.now() } : null }).catch(() => {});
      }
      port.postMessage({ type: 'deepDone', reqId: req.reqId, text: built.text, model: 'built-in' });
      return;
    }
    const waiters = [{ port, reqId: req.reqId }];
    guidesInflight.set(key, waiters);
    const each = (fn) => {
      for (const w of waiters) {
        try {
          fn(w);
        } catch (e) {
          /* that tab went away */
        }
      }
    };
    try {
      const writer = req.kind === 'wordguide' ? claude.explainWordGuide : claude.explainForm;
      const tabSettings = forTab(port.sender && port.sender.tab ? port.sender.tab.id : -1);
      const waitingNotes = await pendingNotes(req.form.k);
      // Word and phrase guides start from what the dictionary says (readings, senses), so facts are right.
      if (req.kind === 'wordguide') {
        try {
          const lang = req.lang || '';
          const card = await SG.dict.card(lang.startsWith('ko') ? 'ko' : lang.startsWith('ja') ? 'ja' : lang.startsWith('zh') ? 'zh' : '', req.word, req.dict);
          if (card) req.dictInfo = card.entries.map((e) => `${e.head}${e.read ? ' [' + e.read + ']' : ''}: ` + e.senses.map((x, i) => `${i + 1}. (${x[0]}) ${x[1]}`).join(' ')).join('\n') + ` (${card.source})`;
        } catch (e) {
          /* no dictionary entry; the guide is written from the line */
        }
      }
      req.notes = (prevGuide && prevGuide.notes ? prevGuide.notes : []).concat(waitingNotes);
      let text = await writer(tabSettings, req, (delta) => each((w) => w.port.postMessage({ type: 'deepDelta', reqId: w.reqId, delta })));
      // Before it's saved: no romaji, and a proofreading pass for contradictions (fixed only if found).
      text = SG.guideText.stripRomaji(text);
      if (settings.checkGuides !== false) text = (await claude.checkGuide(tabSettings, text)).text;
      const entry = {
        key, k: req.form.k, name: generalName(req.form.name || req.form.k), kind: req.kind === 'wordguide' ? 'word' : 'grammar', lang: req.lang || '', nativeLang: settings.nativeLang,
        text, sentence: req.sentence || '', word: req.word || '', model: req.model || SG.modelFor(settings, req.kind === 'wordguide' ? 'wordGuides' : 'grammarGuides'), savedAt: Date.now(),
      };
      if (req.phrase || String(req.form.k).startsWith('phrase.')) entry.group = 'phrase';
      if (req.notes.length) entry.notes = req.notes;
      entry.encounters = (prevGuide && prevGuide.encounters) || (req.sentence ? [{ line: norm(req.sentence), sentence: req.sentence, meaning: req.meaning || '', word: req.word || '', at: Date.now() }] : []);
      bumpGuideStat('written');
      if (waitingNotes.length) clearPendingNotes(req.form.k).catch(() => {});
      if (req.improve && prevGuide) {
        // Rewritten on request: the old version goes to history, and the guide keeps its first line.
        cache.putMany('history', [[key + '|' + Date.now(), Object.assign({}, prevGuide, { retiredAt: Date.now() })]]).catch(() => {});
        entry.savedAt = prevGuide.savedAt || entry.savedAt;
        entry.sentence = prevGuide.sentence || entry.sentence;
        entry.rewritten = true;
        entry.updatedAt = Date.now();
      }
      cache.putMany('guides', [[key, entry]]).catch(() => {});
      if (req.kind !== 'wordguide' && settings.addGrammarToReview) {
        bankSave({ kind: 'grammar', lang: req.lang || '', text: req.form.k, name: req.form.name || req.form.k, context: req.sentence ? { sentence: req.sentence, savedAt: Date.now() } : null }).catch(() => {});
      }
      each((w) => w.port.postMessage({ type: 'deepDone', reqId: w.reqId, text, model: entry.model, notes: entry.notes || [], name: entry.name }));
    } catch (err) {
      each((w) => w.port.postMessage({ type: 'deepError', reqId: w.reqId, message: err.message }));
    } finally {
      guidesInflight.delete(key);
    }
  }

  async function explain(req, port) {
    if ((req.kind === 'guide' || req.kind === 'wordguide') && req.form && req.form.k) return explainGuide(req, port);
    await ready;
    const key = [fingerprint(), 'deep', req.key, req.word && req.word.s, req.wordIndex].join('|');
    const hit = (await cache.getMany('deep', [key])).get(key);
    if (hit) {
      port.postMessage({ type: 'deepDone', reqId: req.reqId, text: hit });
      return;
    }
    try {
      const text = await claude.explainWord(settings, req, (delta) => {
        try {
          port.postMessage({ type: 'deepDelta', reqId: req.reqId, delta });
        } catch (e) {
          /* the tab went away mid-stream */
        }
      });
      cache.putMany('deep', [[key, text]]).catch(() => {});
      port.postMessage({ type: 'deepDone', reqId: req.reqId, text });
    } catch (err) {
      port.postMessage({ type: 'deepError', reqId: req.reqId, message: err.message });
    }
  }

  // ---- word bank and character entries -----------------------------------

  const pendingSeeks = new Map(); // tabId -> { time, until }

  function charKey(ch, lang) {
    return [prompt.CHAR_VERSION, settings.nativeLang, lang, ch].join('|');
  }

  const charsInflight = new Map();

  async function charInfo(req, tabId) {
    await ready;
    const key = charKey(req.ch, req.lang);
    const hit = (await cache.getMany('chars', [key])).get(key);
    if (hit) return hit.entry;
    if (!charsInflight.has(key)) {
      const p = claude.charEntry(forTab(tabId), req).then((entry) => {
        cache.putMany('chars', [[key, { entry, savedAt: Date.now() }]]).catch(() => {});
        return entry;
      });
      charsInflight.set(key, p);
      p.finally(() => charsInflight.delete(key)).catch(() => {});
    }
    return charsInflight.get(key);
  }

  // Stroke order data: KanjiVG for Japanese, hanzi-writer-data for Chinese, each the
  // other's fallback. Fetched on first use and kept.
  async function strokeData(ch, lang) {
    const key = lang + '|' + ch;
    const hit = (await cache.getMany('strokes', [key])).get(key);
    if (hit) return hit;
    const sources = lang === 'zh'
      ? [['hw', SG.strokes.hanziWriterUrl(ch)], ['kvg', SG.strokes.kanjiVGUrl(ch)]]
      : [['kvg', SG.strokes.kanjiVGUrl(ch)], ['hw', SG.strokes.hanziWriterUrl(ch)]];
    for (const [kind, url] of sources) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const entry = { kind, text: await res.text() };
        cache.putMany('strokes', [[key, entry]]).catch(() => {});
        return entry;
      } catch (e) {
        /* try the other source */
      }
    }
    return null;
  }

  async function wordList(lines, sig, tabId) {
    await ready;
    const key = [prompt.WORDS_VERSION, claude.lineModelOf(settings), settings.nativeLang, 'words', sig].join('|');
    const hit = (await cache.getMany('deep', [key])).get(key);
    if (hit) return hit;
    const words = await claude.episodeWords(forTab(tabId), lines);
    cache.putMany('deep', [[key, words]]).catch(() => {});
    return words;
  }

  // ---- pitch accent (Kanjium, CC BY-SA 4.0) -------------------------------------

  const KANJIUM_URL = 'https://cdn.jsdelivr.net/gh/mifunetoshiro/kanjium@master/data/source_files/raw/accents.txt';
  let pitchMap = null;
  let pitchLoading = null;

  function loadPitch() {
    if (pitchMap) return Promise.resolve(pitchMap);
    if (!pitchLoading) {
      pitchLoading = (async () => {
        const key = 'kanjium-accents';
        let hit = (await cache.getMany('strokes', [key])).get(key);
        if (!hit) {
          const res = await fetch(KANJIUM_URL);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          hit = { kind: 'kanjium', text: await res.text() };
          cache.putMany('strokes', [[key, hit]]).catch(() => {});
        }
        pitchMap = SG.pitch.parseKanjium(hit.text);
        return pitchMap;
      })().catch((e) => {
        pitchLoading = null;
        throw e;
      });
    }
    return pitchLoading;
  }

  // items: [{ d, r, s }] -> [{ r, a } | null]
  async function pitchFor(items) {
    let map;
    try {
      map = await loadPitch();
    } catch (e) {
      return items.map(() => null);
    }
    return items.map((it) => {
      // The surface reading only fits the dictionary form when the word is not inflected.
      const reading = it.s && it.d && it.s !== it.d ? '' : it.r;
      return SG.pitch.lookup(map, it.d || it.s, reading) || (it.s && it.s !== it.d ? SG.pitch.lookup(map, it.s, it.r) : null);
    });
  }

  // ---- history for the progress page ---------------------------------------------

  function dayKey(now) {
    return SG.srs.dayKey(now || Date.now());
  }

  async function updateDay(fn) {
    const r = (await browser.storage.local.get('history')).history || {};
    const k = dayKey();
    r[k] = r[k] || {};
    fn(r[k]);
    await browser.storage.local.set({ history: r });
  }

  let snapTimer = null;
  function snapshotKnown() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(async () => {
      const r = await browser.storage.local.get(['knownWords', 'known']);
      const words = {};
      for (const [lang, list] of Object.entries(r.knownWords || {})) words[lang] = (list || []).length;
      const chars = {};
      for (const [lang, str] of Object.entries(r.known || {})) chars[lang] = Array.from(str || '').length;
      updateDay((d) => {
        d.knownWords = words;
        d.knownChars = chars;
      });
    }, 1500);
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.knownWords || changes.known)) snapshotKnown();
  });
  snapshotKnown();

  // ---- season prep through the batch API -----------------------------------------

  async function getJobs() {
    return (await browser.storage.local.get('seasonJobs')).seasonJobs || [];
  }

  async function saveJob(job) {
    const jobs = await getJobs();
    const i = jobs.findIndex((j) => j.id === job.id);
    if (i >= 0) jobs[i] = job;
    else jobs.unshift(job);
    await browser.storage.local.set({ seasonJobs: jobs.slice(0, 10) });
  }

  // Downloads subtitles for each episode, then sends every line to the batch API at half price.
  // The results land in the same cache as normal analyses, so those episodes play with lines ready.
  async function startSeason(req) {
    await ready;
    const base = req.episode;
    const job = {
      id: 'job' + Date.now(),
      show: SG.episode.describe(Object.assign({}, base, { episode: null })) + ` · season ${req.season}`,
      season: req.season, from: req.from, to: req.to, model: claude.lineModelOf(settings),
      status: 'downloading', created: Date.now(), episodes: [], lines: 0, requests: 0,
    };
    await saveJob(job);
    const fp = fingerprint();
    const requests = [];
    const counts = {};
    const chunks = {};
    const size = Math.max(2, settings.chunkSize || 8);
    for (let n = req.from; n <= req.to; n++) {
      const ep = Object.assign({}, base, { season: req.season, episode: n });
      const entry = { n, status: 'searching' };
      job.episodes.push(entry);
      await saveJob(job);
      try {
        const got = await autoSubtitle(ep, req.langs);
        if (!got.track) {
          entry.status = 'no subtitles found';
          continue;
        }
        const cues = got.track.cues;
        const texts = cues.map((c) => c.text);
        const keys = texts.map((t, i) => SG.subtitles.lineKey(t, i ? texts[i - 1] : ''));
        const cached = await cache.getMany('lines', keys.map((k) => fp + '|' + k));
        const langHint = SG.lang.detectLang(texts.slice(0, 60).join('\n'));
        let added = 0;
        for (let i = 0; i < texts.length; i += size) {
          const idx = [];
          for (let j = i; j < Math.min(texts.length, i + size); j++) if (!cached.has(fp + '|' + keys[j])) idx.push(j);
          if (!idx.length) continue;
          const id = `e${n}c${i}`;
          const lines = idx.map((j) => texts[j]);
          const context = texts.slice(Math.max(0, idx[0] - 3), idx[0]);
          requests.push({ custom_id: id, params: claude.batchAnalysisParams(settings, lines, context, langHint) });
          counts[id] = lines.length;
          chunks[id] = idx.map((j) => keys[j]);
          added += lines.length;
        }
        entry.status = 'subtitles ready';
        entry.lines = added;
        job.lines += added;
      } catch (e) {
        entry.status = e.message || 'failed';
      }
      await saveJob(job);
    }
    if (!requests.length) {
      job.status = job.lines ? 'done' : 'nothing to prepare';
      await saveJob(job);
      return job;
    }
    try {
      const batch = await claude.batchCreate(settings, requests);
      job.batchId = batch.id;
      job.requests = requests.length;
      job.status = 'processing';
      job.fingerprint = fp;
      job.counts = counts;
      job.chunks = chunks;
    } catch (e) {
      job.status = 'failed: ' + e.message;
    }
    await saveJob(job);
    return job;
  }

  let polling = false;
  async function pollJobs() {
    if (polling) return;
    polling = true;
    try {
      await ready;
      for (const job of await getJobs()) {
        if (job.status !== 'processing' || !job.batchId) continue;
        let batch;
        try {
          batch = await claude.batchRetrieve(settings, job.batchId);
        } catch (e) {
          continue;
        }
        job.progress = batch.request_counts;
        if (batch.processing_status !== 'ended') {
          await saveJob(job);
          continue;
        }
        let ok = 0;
        const store = [];
        await claude.batchResults(settings, job.batchId, job.counts || {}, (id, analyses) => {
          const keys = (job.chunks || {})[id];
          if (!analyses || !keys) return;
          analyses.forEach((a, i) => {
            if (a && keys[i]) {
              store.push([job.fingerprint + '|' + keys[i], a], [anyKey(keys[i], false), Object.assign({ fp: job.fingerprint }, a)]);
              ok++;
            }
          });
        });
        await cache.putMany('lines', store);
        job.status = 'done';
        job.ready = ok;
        delete job.chunks;
        delete job.counts;
        await saveJob(job);
      }
    } finally {
      polling = false;
    }
  }
  setInterval(pollJobs, 120000);
  setTimeout(pollJobs, 15000);
  // Whole-show lessons written through the Batch API.
  const pollFinish = () => ready.then(() => SG.episodes.pollFinish(settings)).catch(() => {});
  setInterval(pollFinish, 120000);
  setTimeout(pollFinish, 20000);

  function bankKey(kind, lang, text) {
    return [kind, lang, text].join('|');
  }

  // Save a word or character; saving it again from another line adds that line as another example.
  async function bankSave(item) {
    const key = bankKey(item.kind, item.lang, item.text);
    const prev = (await cache.getMany('bank', [key])).get(key);
    const entry = Object.assign({}, prev || {}, item, { key, savedAt: prev ? prev.savedAt : Date.now(), updatedAt: Date.now() });
    const contexts = (prev && prev.contexts) || [];
    if (item.context && item.context.sentence) {
      const dup = contexts.findIndex((c) => c.sentence === item.context.sentence);
      if (dup >= 0) contexts.splice(dup, 1);
      contexts.unshift(item.context);
    }
    entry.contexts = contexts.slice(0, 12);
    // Every form a word was saved from (食べさせられた, 食べない…) is kept under its dictionary form.
    if (item.word && item.word.s) {
      const met = ((prev && prev.metAs) || []).filter((x) => x.s !== item.word.s);
      met.unshift({ s: item.word.s, m: item.word.m || '', sentence: item.context ? item.context.sentence : '' });
      entry.metAs = met.slice(0, 12);
    }
    delete entry.context;
    await cache.putMany('bank', [[key, entry]]);
    return entry;
  }

  // Words saved as their head verb that were really met inside a set phrase (関する saved from に関して,
  // 出す from 店を出す): found by checking the dictionary for the phrase around the form met.
  async function phraseCandidates() {
    const bank = await cache.getAll('bank');
    const out = [];
    for (const item of bank) {
      if (item.kind !== 'word' || item.lang !== 'ja' || (item.word && item.word.phrase)) continue;
      const forms = [...new Set([].concat((item.metAs || []).map((x) => x.s), item.word && item.word.s ? [item.word.s] : []).filter(Boolean))];
      let best = null;
      for (const c of item.contexts || []) {
        const sentence = c.sentence || '';
        for (const f of forms) {
          const at = sentence.indexOf(f);
          if (at < 0) continue;
          for (let n = 4; n >= 1 && !best; n--) {
            if (at - n < 0) continue;
            const pre = sentence.slice(at - n, at);
            if (/[、。！？\s「」]/.test(pre)) continue;
            for (const tail of [item.text, f]) {
              const hit = (await SG.dict.exact(pre + tail)).find((e) => e.s.some((x) => /exp/.test(x[0])));
              if (hit) {
                best = { phrase: pre + tail, met: pre + f, meaning: hit.s.map((x) => x[1]).slice(0, 2).join('; '), reading: (hit.r || [])[0] || '', sentence };
                break;
              }
            }
          }
          if (best) break;
        }
        if (best) break;
      }
      if (best) out.push(Object.assign({ key: item.key, text: item.text }, best));
    }
    return out;
  }

  // Replace a head-verb save with the phrase, keeping its contexts and review progress.
  async function convertToPhrase(key, phrase, meaning, reading) {
    const old = (await cache.getMany('bank', [key])).get(key);
    if (!old) return { error: 'That word is no longer saved.' };
    const nkey = bankKey('word', old.lang, phrase);
    const word = Object.assign({}, old.word || {}, { s: phrase, d: phrase, r: reading || '', dr: reading || '', m: meaning || (old.word && old.word.m) || '', pos: 'expression', phrase: true, f: [] });
    const entry = Object.assign({}, old, { key: nkey, text: phrase, word, convertedFrom: old.text, updatedAt: Date.now() });
    await cache.putMany('bank', [[nkey, entry]]);
    if (nkey !== key) await cache.remove('bank', key);
    return { ok: true, key: nkey };
  }

  async function bankStatus(keys) {
    const found = await cache.getMany('bank', keys);
    const out = {};
    for (const k of keys) out[k] = found.has(k);
    return out;
  }

  // ---- subtitle sources ----------------------------------------------------

  const SUB_TTL = 90 * 24 * 3600 * 1000;

  function subKey(result) {
    return result.provider + '|' + result.id;
  }

  function trackFrom(result, sub) {
    const source = SG.providers.PROVIDERS[result.provider].name;
    return {
      id: 'remote:' + subKey(result),
      label: `${source} · ${result.name || sub.file || ''}`.slice(0, 90),
      lang: result.lang,
      source: 'remote',
      provider: result.provider,
      cues: sub.cues,
    };
  }

  // Downloads (or reuses) one result and remembers it as the choice for this episode.
  async function loadSubtitle(result, ep) {
    const key = subKey(result);
    const cached = (await cache.getMany('subs', [key])).get(key);
    let sub = cached && Date.now() - cached.savedAt < SUB_TTL ? cached : null;
    let note = '';
    if (!sub) {
      const got = await SG.providers.download(settings, result, ep);
      sub = { cues: got.cues, file: got.file, savedAt: Date.now() };
      note = got.note;
      cache.putMany('subs', [[key, sub]]).catch(() => {});
    }
    if (ep) {
      const pick = { result, savedAt: Date.now() };
      cache.putMany('picks', [[SG.episode.key(ep, result.lang), pick]]).catch(() => {});
      rememberShowChoice(ep, result).catch(() => {});
    }
    return { track: trackFrom(result, sub), note };
  }

  // Rewrites a saved guide (Library → Check my guides). The old version goes to history; notes are kept.
  // An artist overview: recurring words, themes and style across the songs you've studied by them,
  // written from their song guides (Sonnet by default), kept until there are new songs.
  async function artistGuide(artist, again) {
    const songs = (await cache.getAll('guides')).filter((g) => g.kind === 'song' && g.song && (g.song.artist || '').toLowerCase() === String(artist || '').toLowerCase());
    if (!songs.length) return { error: 'Write a song guide for one of their songs first.' };
    const store = (await browser.storage.local.get('artistGuides')).artistGuides || {};
    const have = store[artist.toLowerCase()];
    if (have && !again && have.songs === songs.length) return have;
    if (!settings.apiKey) return { error: 'Add your Anthropic API key in Options first.' };
    const s = Object.assign({}, settings, { model: SG.modelFor(settings, 'wordGuides'), costFeature: 'music' });
    const system = `A learner studies songs by one artist in the language they're learning. From the guides to the songs below, write a short, lively overview in ${settings.nativeLang}: the words and phrases this artist keeps coming back to (as links: [[w:dictionary form|as written]]), the themes and images that recur, how the songs talk (politeness, persona, mixing in English), and which of these songs to study next for the most new language. "## " headings, plain words, no romanization, nothing invented about the artist beyond the songs.`;
    const user = songs.map((g) => `### ${g.song.track}\n${String(g.text).slice(0, 6000)}`).join('\n\n');
    const text = await claude.streamPlain(s, system, `Artist: ${artist}\n\n${user}`, 6000);
    const entry = { text: SG.guideText.stripRomaji(text), model: s.model, at: Date.now(), songs: songs.length };
    store[artist.toLowerCase()] = entry;
    await browser.storage.local.set({ artistGuides: store });
    return entry;
  }

  // Rewrite a saved song guide from the Library: its lyrics come from the song's saved choice or LRCLIB.
  async function songGuideRedo(key, model) {
    const g = (await cache.getMany('guides', [key])).get(key);
    if (!g || !g.song) return { error: 'That song guide is no longer saved.' };
    const np = { track: g.song.track, artist: g.song.artist, album: g.song.album || '' };
    const found = await SG.music.find(np);
    if (!found.track) return { error: (found.error || 'No lyrics found') + ' Open the song and use Song → Rewrite instead.' };
    await cache.putMany('history', [[key + '|' + Date.now(), Object.assign({}, g, { retiredAt: Date.now() })]]);
    return songGuide(Object.assign({}, np, { art: g.song.art, url: g.song.url, lang: g.lang, lyrics: found.track.cues.map((c) => c.text), again: true, model }));
  }

  // A guide opened from a page (a link in a lesson or song guide): the saved one, or written now.
  function pageGuide(msg) {
    return new Promise((resolve) => {
      const fakePort = {
        sender: { tab: { id: -1 } },
        postMessage(m) {
          if (m.type === 'deepDone') resolve({ text: m.text, model: m.model, name: m.name || '' });
          else if (m.type === 'deepError') resolve({ error: m.message });
        },
      };
      const isWord = msg.kind !== 'g';
      const lang = msg.lang || 'ja';
      const k = isWord ? `word.${lang}.${msg.k}` : SG.canonicalForm(msg.k.includes('.') ? msg.k : `${lang}.${msg.k}`);
      explainGuide({ reqId: 0, kind: isWord ? 'wordguide' : 'guide', form: { k, name: msg.label || msg.k }, lang, sentence: msg.sentence || '', word: msg.label || msg.k, dict: isWord ? msg.k : '', meaning: '' }, fakePort).catch((err) => resolve({ error: err.message }));
    });
  }

  // Remove per-line sections from saved guides (free); the old text goes to history.
  async function tidyGuides() {
    const all = await cache.getAll('guides');
    let count = 0;
    for (const g of all) {
      if (!g.text || g.kind === 'song') continue;
      const clean = SG.guideText.withoutSections(g.text, LINE_SECTIONS);
      if (clean === String(g.text).trim()) continue;
      await cache.putMany('history', [[g.key + '|tidy|' + Date.now(), Object.assign({}, g, { retiredAt: Date.now() })]]);
      await cache.putMany('guides', [[g.key, Object.assign({}, g, { text: clean, updatedAt: Date.now() })]]);
      count++;
    }
    return { count };
  }

  async function rewriteGuide(key, model) {
    const g = (await cache.getMany('guides', [key])).get(key);
    if (!g) return { error: 'Guide not found.' };
    const built = g.kind === 'grammar' ? await builtinGuide(g.k) : null;
    let text;
    let usedModel;
    if (built) {
      text = built.text;
      usedModel = 'built-in';
    } else {
      const s = Object.assign({}, settings, { costTag: -1, costShow: '' });
      const parts = String(g.k).split('.');
      const d = parts.slice(2).join('.') || g.name;
      const req = { form: { k: g.k, name: g.name }, lang: g.lang || (parts[0] === 'word' || parts[0] === 'phrase' ? parts[1] : parts[0]), sentence: g.sentence || '', word: g.word || d, dict: d, notes: g.notes || [], model, phrase: g.group === 'phrase' || parts[0] === 'phrase', pos: g.group === 'phrase' ? 'set phrase' : '' };
      const writer = g.kind === 'grammar' ? claude.explainForm : claude.explainWordGuide;
      text = SG.guideText.stripRomaji(await writer(s, req, () => {}));
      if (settings.checkGuides !== false) text = (await claude.checkGuide(s, text)).text;
      usedModel = model || SG.modelFor(settings, g.kind === 'grammar' ? 'grammarGuides' : 'wordGuides');
    }
    await cache.putMany('history', [[key + '|' + Date.now(), Object.assign({}, g, { retiredAt: Date.now() })]]);
    const entry = Object.assign({}, g, { text, model: usedModel, rewritten: true, updatedAt: Date.now() });
    await cache.putMany('guides', [[key, entry]]);
    return { ok: true, model: usedModel };
  }

  // ---- notes from your questions, kept with the guide they belong to
  function noteKey(t, lang) {
    const l = lang || 'ja';
    if (!t || !t.d && !t.k) return '';
    if (t.kind === 'grammar') return SG.canonicalForm(t.k && t.k.includes('.') ? t.k : `${l}.${t.k || 'fn_' + t.d}`);
    if (t.kind === 'phrase') return `phrase.${l}.${t.d}`;
    return `word.${l}.${t.d}`;
  }
  async function addNote(k, note) {
    const aliases = (await browser.storage.local.get('guideAliases')).guideAliases || {};
    k = aliases[k] || k;
    const key = guideKey(k);
    const entry = (await cache.getMany('guides', [key])).get(key);
    const item = { text: note.text, sentence: note.sentence || '', q: note.q || '', at: Date.now() };
    if (entry) {
      entry.notes = (entry.notes || []).concat(item).slice(-20);
      entry.updatedAt = Date.now();
      await cache.putMany('guides', [[key, entry]]);
      return 'guide';
    }
    const pending = (await browser.storage.local.get('guideNotes')).guideNotes || {};
    pending[k] = (pending[k] || []).concat(item).slice(-20);
    await browser.storage.local.set({ guideNotes: pending });
    return 'pending';
  }
  async function pendingNotes(k) {
    return ((await browser.storage.local.get('guideNotes')).guideNotes || {})[k] || [];
  }
  async function clearPendingNotes(k) {
    const pending = (await browser.storage.local.get('guideNotes')).guideNotes || {};
    if (!pending[k]) return;
    delete pending[k];
    await browser.storage.local.set({ guideNotes: pending });
  }

  // ---- questions asked about lines: kept for good, shown again under the same line
  function questionKey(sentence) {
    return String(sentence || '').replace(/\s+/g, '');
  }
  async function saveQuestion(msg, answer) {
    const id = ['q', Date.now(), Math.random().toString(36).slice(2, 7)].join('|');
    const item = {
      id, line: questionKey(msg.sentence), sentence: msg.sentence || '', translation: msg.translation || '',
      q: msg.question, a: answer, show: msg.show || '', episode: msg.episode || null, lang: msg.lang || '',
      url: msg.url || '', time: msg.time == null ? null : msg.time, model: settings.model, savedAt: Date.now(), frame: msg.frame || undefined,
    };
    await cache.putMany('questions', [[id, item]]);
    return item;
  }
  async function questionsFor(sentence) {
    const line = questionKey(sentence);
    const all = await cache.getAll('questions');
    return all.filter((x) => x.line === line).sort((a, b) => a.savedAt - b.savedAt);
  }

  // The show's usual subtitles: the site and fansub group last used for it, so every episode comes from them.
  async function showChoice(ep, lang) {
    const k = SG.episode.showKey(ep, lang);
    return (await cache.getMany('picks', [k])).get(k) || null;
  }
  async function rememberShowChoice(ep, result, offset) {
    const k = SG.episode.showKey(ep, result.lang);
    const old = await showChoice(ep, result.lang);
    const group = SG.episode.releaseGroup(result.name);
    const same = old && old.provider === result.provider && old.group === group;
    const choice = {
      provider: result.provider, group, entry: result.entry || null, name: result.name, title: result.title || ep.title || '',
      offset: offset != null ? offset : same ? old.offset : null, savedAt: Date.now(),
    };
    await cache.putMany('picks', [[k, choice]]);
  }
  function choiceLabel(c) {
    const site = { opensubtitles: 'OpenSubtitles', subdl: 'SubDL', jimaku: 'Jimaku' }[c.provider] || c.provider;
    return c.group ? `${site} · ${c.group}` : site;
  }

  // How well a search result matches the show's usual subtitles.
  function choiceScore(r, choice) {
    if (!choice) return 0;
    let n = 0;
    if (r.provider === choice.provider) n += 2;
    if (choice.entry && r.entry === choice.entry) n += 3;
    if (choice.group && SG.episode.releaseGroup(r.name) === choice.group) n += 4;
    return n;
  }

  // The file chosen before for this episode, if there is one (no searching), so it loads as soon as the page does.
  async function savedSubtitle(ep, langs) {
    for (const lang of langs) {
      const pick = (await cache.getMany('picks', [SG.episode.key(ep, lang)])).get(SG.episode.key(ep, lang));
      if (pick) {
        const loaded = await loadSubtitle(pick.result, ep);
        return Object.assign(loaded, { reused: true, offset: pick.offset, alternatives: null });
      }
    }
    return { none: true };
  }

  SG.findEpisodeSubs = (ep, langs) => autoSubtitle(ep, langs, { sameSource: true });

  // Automatic loading: a file chosen before for this episode, otherwise the best search result.
  async function autoSubtitle(ep, langs, opts) {
    for (const lang of langs) {
      const pick = (await cache.getMany('picks', [SG.episode.key(ep, lang)])).get(SG.episode.key(ep, lang));
      if (pick) {
        try {
          const loaded = await loadSubtitle(pick.result, ep);
          return Object.assign(loaded, { reused: true, offset: pick.offset, alternatives: null });
        } catch (e) {
          /* fall through to a fresh search */
        }
      }
    }
    const found = await SG.providers.search(settings, ep, langs);
    const errors = Object.entries(found.report).filter(([, r]) => !r.ok).map(([, r]) => r.message);
    // Only take a result that is clearly this episode (or this movie).
    const fits = (r) => ep.type !== 'tv' || r.episode == null || Number(r.episode) === Number(ep.episode);
    let usable = found.results.filter((r) => !r.pack && fits(r)).concat(found.results.filter((r) => r.pack && fits(r)));
    // Results from the show's usual site and group first (a stable sort keeps the rest in order).
    const choices = new Map();
    for (const lang of langs) choices.set(lang, await showChoice(ep, lang));
    usable = usable.map((r, i) => ({ r, i, s: choiceScore(r, choices.get(r.lang)) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
    // Whole-show fetches stay with the show's usual source (site, and group where known).
    if (opts && opts.sameSource) {
      const withChoice = usable.filter((r) => choices.get(r.lang));
      if (withChoice.length || [...choices.values()].some(Boolean)) {
        usable = usable.filter((r) => {
          const c = choices.get(r.lang);
          return c && choiceScore(r, c) >= (c.group ? 4 : 2);
        });
        if (!usable.length) return { track: null, errors: ['not on the show\'s usual subtitle source'], searched: found.providers.length };
      }
    }
    for (const result of usable.slice(0, 3)) {
      try {
        const loaded = await loadSubtitle(result, ep);
        const choice = choices.get(result.lang);
        const usual = choiceScore(result, choice) >= 4 || (choice && !choice.group && choiceScore(result, choice) >= 2);
        return Object.assign(loaded, {
          reused: false, alternatives: found.results.length - 1, usual: usual ? choiceLabel(choice) : null,
          offset: usual && choice.offset != null ? choice.offset : undefined,
        });
      } catch (e) {
        errors.push(e.message);
      }
    }
    return { track: null, errors, searched: found.providers.length };
  }

  function publicJob(j) {
    return { id: j.id, show: j.show, status: j.status, from: j.from, to: j.to, lines: j.lines, ready: j.ready, progress: j.progress, episodes: j.episodes, created: j.created };
  }

  function seekFor(tabId) {
    const s = pendingSeeks.get(tabId);
    if (!s || s.until < Date.now()) return null;
    return s.time;
  }

  async function tabInfo(tabId) {
    try {
      const tab = await browser.tabs.get(tabId);
      let frames = [];
      try {
        frames = (await browser.webNavigation.getAllFrames({ tabId })).map((f) => f.url).filter((u) => /^https?:/.test(u));
      } catch (e) {
        /* no frame list; the frame's own address and the page still help */
      }
      return { url: tab.url || '', title: tab.title || '', frames };
    } catch (e) {
      return { url: '', title: '' };
    }
  }

  // ---- content script connections ----------------------------------------

  function send(port, msg) {
    try {
      port.postMessage(msg);
    } catch (e) {
      /* disconnected */
    }
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'langtitles' || !port.sender || !port.sender.tab) return;
    const tabId = port.sender.tab.id;
    if (!ports.has(tabId)) ports.set(tabId, new Set());
    ports.get(tabId).add(port);

    ready.then(() => {
      let tabHost = '';
      try {
        tabHost = new URL(port.sender.tab.url || '').hostname;
      } catch (e) {
        /* about:blank and similar */
      }
      send(port, {
        type: 'init', settings: SG.publicSettings(settings), tracks: sniffer.tracksFor(tabId), tabHost,
        tabUrl: port.sender.tab.url || '', tabTitle: port.sender.tab.title || '',
        seekTo: seekFor(tabId),
      });
    });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'analyze') {
        analyze(msg, tabId).then((res) => send(port, { type: 'analyzed', reqId: msg.reqId, results: res.results, error: res.error, savedOnly: Boolean(msg.savedOnly) }));
      } else if (msg.type === 'deep') {
        explain(msg, port);
      } else if (msg.type === 'state') {
        tabStatus.set(tabId, Object.assign({ at: Date.now() }, msg.state));
        const ep = msg.state && msg.state.episode;
        tabShows.set(tabId, ep && ep !== 'not detected' ? ep : (port.sender.tab.title || '').slice(0, 80));
      } else if (msg.type === 'openLibrary') {
        const url = browser.runtime.getURL('grammar/grammar.html') + (msg.k ? '#' + encodeURIComponent(msg.k) : '');
        browser.tabs.create({ url, index: port.sender.tab.index + 1 });
      } else if (msg.type === 'saveSettings') {
        SG.saveSettings(msg.patch);
      } else if (msg.type === 'charInfo') {
        charInfo(msg, tabId).then(
          (entry) => send(port, { type: 'charInfo', reqId: msg.reqId, entry }),
          (err) => send(port, { type: 'charInfo', reqId: msg.reqId, error: err.message }),
        );
      } else if (msg.type === 'bankSave') {
        bankSave(msg.item).then(
          (entry) => send(port, { type: 'bankSaved', reqId: msg.reqId, entry }),
          (err) => send(port, { type: 'bankSaved', reqId: msg.reqId, error: String(err && err.message) }),
        );
      } else if (msg.type === 'bankRemove') {
        cache.remove('bank', msg.key).then(() => send(port, { type: 'bankSaved', reqId: msg.reqId, removed: true }));
      } else if (msg.type === 'bankStatus') {
        bankStatus(msg.keys).then((status) => send(port, { type: 'bankStatus', reqId: msg.reqId, status }));
      } else if (msg.type === 'pitch') {
        pitchFor(msg.items || []).then((results) => send(port, { type: 'pitch', reqId: msg.reqId, results }));
      } else if (msg.type === 'ask') {
        ready.then(() => claude.askLine(forTab(tabId), msg, (delta) => send(port, { type: 'askDelta', reqId: msg.reqId, delta })))
          .then(
            (text) => {
              send(port, { type: 'askDone', reqId: msg.reqId, text });
              saveQuestion(msg, text).catch(() => {});
              claude.extractLesson(forTab(tabId), msg, text).then((res) => {
                const targets = (res.targets || []).map((t) => Object.assign(t, { key: noteKey(t, msg.lang) })).filter((t) => t.key);
                send(port, { type: 'askLesson', reqId: msg.reqId, lesson: res.lesson || '', targets, guide: res.guide && res.guide.make ? Object.assign(res.guide, { key: noteKey(res.guide, msg.lang) }) : null });
              }).catch(() => {});
            },
            (err) => send(port, { type: 'askError', reqId: msg.reqId, message: err.message }),
          );
      } else if (msg.type === 'frameSave') {
        SG.episodes.saveFrame(msg.id, msg.data).then((ok) => send(port, { type: 'lyrics', reqId: msg.reqId, ok }));
      } else if (msg.type === 'frameCapture') {
        SG.episodes.captureTab(port.sender.tab, msg.rect, msg.dpr).then((data) => send(port, { type: 'lyrics', reqId: msg.reqId, data }), (err) => send(port, { type: 'lyrics', reqId: msg.reqId, error: err.message }));
      } else if (msg.type === 'episodeFrame') {
        SG.episodes.addFrame(msg).catch(() => {});
      } else if (msg.type === 'episodeSeen') {
        SG.episodes.seen(msg).catch(() => {});
      } else if (msg.type === 'showSongs') {
        SG.music.showSongs(msg.title).then((body) => send(port, Object.assign({ type: 'lyrics', reqId: msg.reqId }, body)), (err) => send(port, { type: 'lyrics', reqId: msg.reqId, error: err.message }));
      } else if (msg.type === 'songGuideFor') {
        // A song guide for a show's opening or ending without playing it: lyrics from LRCLIB first.
        SG.music.find({ track: msg.track, artist: msg.artist }).then(async (res) => {
          if (!res.track) return send(port, { type: 'songGuideDone', reqId: msg.reqId, error: res.error || 'No lyrics found for this song.' });
          const lyrics = res.track.cues.map((c) => c.text);
          const lang = SG.lang ? SG.lang.detectLang(lyrics.join('\n')) : '';
          const body = await songGuide({ track: msg.track, artist: msg.artist, album: msg.show || '', lyrics, lang, url: 'https://music.youtube.com/search?q=' + encodeURIComponent(msg.artist + ' ' + msg.track) }, (text) => {
            if (Date.now() - (msg.sentAt || 0) < 400) return;
            msg.sentAt = Date.now();
            send(port, { type: 'songGuideText', reqId: msg.reqId, text });
          });
          send(port, Object.assign({ type: 'songGuideDone', reqId: msg.reqId }, body));
        }).catch((err) => send(port, { type: 'songGuideDone', reqId: msg.reqId, error: err.message }));
      } else if (msg.type === 'songGuide') {
        let sentAt = 0;
        let pending = null;
        const part = (text) => {
          clearTimeout(pending);
          const go = () => {
            sentAt = Date.now();
            send(port, { type: 'songGuideText', reqId: msg.reqId, text });
          };
          if (Date.now() - sentAt > 400) go();
          else pending = setTimeout(go, 400);
        };
        songGuide(msg, part).then(
          (body) => {
            clearTimeout(pending);
            send(port, Object.assign({ type: 'songGuideDone', reqId: msg.reqId }, body));
          },
          (err) => {
            clearTimeout(pending);
            send(port, { type: 'songGuideDone', reqId: msg.reqId, error: err.message });
          },
        );
      } else if (/^(lyricsFind|lyricsSearch|lyricsUse|lyricsOwn|lyricsOffset|songPlayed|songList)$/.test(msg.type)) {
        const reply = (body) => send(port, Object.assign({ type: 'lyrics', reqId: msg.reqId }, body));
        const np = msg.np || {};
        const job =
          msg.type === 'lyricsFind' ? SG.music.find(np)
            : msg.type === 'lyricsSearch' ? SG.music.search(msg.q, np).then((list) => ({ list }))
              : msg.type === 'lyricsUse' ? SG.music.useRecord(msg.id, np)
                : msg.type === 'lyricsOwn' ? SG.music.useOwn(msg.text, np, msg.from)
                  : msg.type === 'lyricsOffset' ? SG.music.savePick(SG.lyrics.songKey(np), { offset: msg.offset }).then(() => ({ ok: true }))
                    : msg.type === 'songPlayed' ? SG.music.remember(Object.assign({}, np, { site: port.sender && port.sender.url ? new URL(port.sender.url).hostname : '' })).then((song) => ({ song }))
                      : SG.music.songs().then((list) => ({ list }));
        job.then((body) => reply(body || {}), (err) => reply({ error: err.message }));
      } else if (msg.type === 'dictCard') {
        SG.dict.card(msg.lang, msg.s, msg.d).then((card) => send(port, { type: 'dictCard', reqId: msg.reqId, card }), () => send(port, { type: 'dictCard', reqId: msg.reqId, card: null }));
      } else if (msg.type === 'kanjiQuick') {
        (msg.lang === 'ko' ? SG.dict.hanjaInfo(msg.ch) : SG.dict.kanjiInfo(msg.ch)).then((info) => send(port, { type: 'dictCard', reqId: msg.reqId, info }), () => send(port, { type: 'dictCard', reqId: msg.reqId, info: null }));
      } else if (msg.type === 'pickShow') {
        SG.shows.pick(msg.show, msg.siteTitle, msg.lang).then((entry) => send(port, { type: 'showSaved', reqId: msg.reqId, entry }));
      } else if (msg.type === 'removeShow') {
        SG.shows.remove(msg.id).then(() => send(port, { type: 'showSaved', reqId: msg.reqId, ok: true }));
      } else if (msg.type === 'myShows') {
        SG.shows.all().then((list) => send(port, { type: 'showSaved', reqId: msg.reqId, list }));
      } else if (msg.type === 'matchShow') {
        SG.shows.match(msg.episode).then((entry) => send(port, { type: 'showSaved', reqId: msg.reqId, entry }));
      } else if (msg.type === 'useForShow') {
        // "Use for every episode": this site and group become the show's subtitles, ahead of any search order.
        rememberShowChoice(msg.episode, msg.result, msg.offset).then(async () => {
          const entry = await SG.shows.match(msg.episode);
          const group = SG.episode.releaseGroup(msg.result.name);
          const label = ({ opensubtitles: 'OpenSubtitles', subdl: 'SubDL', jimaku: 'Jimaku' }[msg.result.provider] || msg.result.provider) + (group ? ' · ' + group : '');
          if (entry) await SG.shows.update(entry.id, { subs: label });
          send(port, { type: 'showSaved', reqId: msg.reqId, label });
        });
      } else if (msg.type === 'addNote') {
        addNote(msg.k, msg.note).then((where) => send(port, { type: 'noteAdded', reqId: msg.reqId, where }));
      } else if (msg.type === 'qaForLine') {
        questionsFor(msg.sentence).then((list) => send(port, { type: 'qaList', reqId: msg.reqId, list }));
      } else if (msg.type === 'watched') {
        updateDay((d) => {
          d.minutes = d.minutes || {};
          d.minutes[msg.lang || 'und'] = (d.minutes[msg.lang || 'und'] || 0) + (Number(msg.minutes) || 0);
        });
      } else if (msg.type === 'seasonStart') {
        startSeason(msg).then(
          (job) => send(port, { type: 'seasonStarted', reqId: msg.reqId, job: { id: job.id, status: job.status } }),
          (err) => send(port, { type: 'seasonStarted', reqId: msg.reqId, error: err.message }),
        );
      } else if (msg.type === 'seasonJobs') {
        getJobs().then((jobs) => send(port, { type: 'seasonJobs', reqId: msg.reqId, jobs: jobs.map(publicJob) }));
      } else if (msg.type === 'stroke') {
        strokeData(msg.ch, msg.lang).then((data) => send(port, { type: 'stroke', reqId: msg.reqId, data }));
      } else if (msg.type === 'episodeWords') {
        wordList(msg.lines, msg.sig, tabId).then(
          (words) => send(port, { type: 'episodeWords', reqId: msg.reqId, words }),
          (err) => send(port, { type: 'episodeWords', reqId: msg.reqId, error: err.message }),
        );
      } else if (msg.type === 'seekDone') {
        pendingSeeks.delete(tabId);
      } else if (msg.type === 'openBank') {
        browser.tabs.create({ url: browser.runtime.getURL('bank/bank.html'), index: port.sender.tab.index + 1 });
      } else if (msg.type === 'tabInfo') {
        tabInfo(tabId).then((info) => send(port, { type: 'tabInfo', reqId: msg.reqId, info }));
      } else if (msg.type === 'findSubs') {
        ready
          .then(() => SG.providers.search(settings, msg.episode, msg.langs))
          .then(
            (found) => send(port, { type: 'subsFound', reqId: msg.reqId, found }),
            (err) => send(port, { type: 'subsFound', reqId: msg.reqId, error: err.message }),
          );
      } else if (msg.type === 'findShows') {
        ready
          .then(() => SG.providers.findShows(settings, msg.title))
          .then(
            (found) => send(port, { type: 'showsFound', reqId: msg.reqId, found }),
            (err) => send(port, { type: 'showsFound', reqId: msg.reqId, error: err.message }),
          );
      } else if (msg.type === 'loadSub') {
        ready
          .then(() => loadSubtitle(msg.result, msg.episode))
          .then(
            (loaded) => send(port, { type: 'subLoaded', reqId: msg.reqId, loaded }),
            (err) => send(port, { type: 'subLoaded', reqId: msg.reqId, error: err.message }),
          );
      } else if (msg.type === 'autoSubs') {
        ready
          .then(() => (msg.savedOnly ? savedSubtitle(msg.episode, msg.langs) : autoSubtitle(msg.episode, msg.langs)))
          .then(
            (loaded) => send(port, { type: 'subLoaded', reqId: msg.reqId, loaded, auto: true }),
            (err) => send(port, { type: 'subLoaded', reqId: msg.reqId, error: err.message, auto: true }),
          );
      } else if (msg.type === 'saveSubOffset' && msg.episode && msg.lang) {
        const k = SG.episode.key(msg.episode, msg.lang);
        cache.getMany('picks', [k]).then((m) => {
          const pick = m.get(k);
          if (pick) {
            cache.putMany('picks', [[k, Object.assign({}, pick, { offset: msg.offset, scale: msg.scale })]]);
            // The same group's releases usually share timing, so the next episode starts from this shift.
            rememberShowChoice(msg.episode, pick.result, msg.offset).catch(() => {});
          }
        });
      } else if (msg.type === 'showChoice' && msg.episode) {
        Promise.all((msg.langs || []).map((l) => showChoice(msg.episode, l))).then((list) => {
          const c = list.find(Boolean);
          send(port, { type: 'showChoice', reqId: msg.reqId, choice: c ? Object.assign({ label: choiceLabel(c) }, c) : null });
        });
      } else if (msg.type === 'forgetShowChoice' && msg.episode) {
        Promise.all((msg.langs || []).map((l) => cache.remove('picks', SG.episode.showKey(msg.episode, l)))).catch(() => {});
      }
    });

    port.onDisconnect.addListener(() => {
      const set = ports.get(tabId);
      if (set) {
        set.delete(port);
        if (!set.size) ports.delete(tabId);
      }
    });
  });

  // Each request's cost goes to the tab it was for, where the side panel adds it to the episode's total.
  claude.onCost((tabId, cost) => {
    if (tabId == null || tabId < 0) return;
    for (const port of ports.get(tabId) || []) send(port, { type: 'cost', cost });
  });

  sniffer.onTrack((tabId, track) => {
    for (const port of ports.get(tabId) || []) send(port, { type: 'track', track });
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    tabStatus.delete(tabId);
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = Object.assign({}, SG.DEFAULTS, changes.settings.newValue || {});
    const pub = SG.publicSettings(settings);
    for (const set of ports.values()) for (const port of set) send(port, { type: 'settings', settings: pub });
  });

  // ---- popup and options page --------------------------------------------

  browser.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || typeof msg !== 'object') return undefined;
    if (msg.type === 'status') {
      return ready.then(async () => ({
        hasKey: Boolean(settings.apiKey),
        tracks: sniffer.tracksFor(msg.tabId).map((t) => ({ label: t.label, lang: t.lang, lines: t.cues.length, url: t.url })),
        state: tabStatus.get(msg.tabId) || null,
        lastError,
        usage: (await browser.storage.local.get('usage')).usage || {},
      }));
    }
    if (msg.type === 'rewriteGuide') return ready.then(() => rewriteGuide(msg.key, msg.model));
    if (msg.type === 'tidyGuides') return ready.then(tidyGuides).catch((err) => ({ error: err.message }));
    if (msg.type === 'episodesAll') return SG.episodes.all();
    if (msg.type === 'removeShowEpisodes') {
      return ready.then(async () => {
        const eps = (await cache.getAll('episodes')).filter((e) => e.showKey === msg.showKey || e.key === 'show:' + msg.showKey);
        for (const e of eps) await cache.remove('episodes', e.key);
        return { removed: eps.length };
      });
    }
    if (msg.type === 'phraseCandidates') return ready.then(phraseCandidates).catch((err) => ({ error: err.message }));
    if (msg.type === 'convertPhrase') return ready.then(() => convertToPhrase(msg.key, msg.phrase, msg.meaning, msg.reading)).catch((err) => ({ error: err.message }));
    if (msg.type === 'framesGet') return SG.episodes.getFrames(msg.ids || []);
    if (msg.type === 'artistGuide') return ready.then(() => artistGuide(msg.artist, msg.again)).catch((err) => ({ error: err.message }));
    if (msg.type === 'pageGuide') return ready.then(() => pageGuide(msg)).catch((err) => ({ error: err.message }));
    if (msg.type === 'lessonWrite') return ready.then(() => SG.episodes.writeWalk(msg.key, settings, msg.again, null, msg.model)).catch((err) => ({ error: err.message }));
    if (msg.type === 'lessonEstimate') return ready.then(() => SG.episodes.lessonEstimate(msg.key, settings));
    if (msg.type === 'lessonBatch') return ready.then(() => SG.episodes.walkBatch(msg.key, settings, msg.model)).catch((err) => ({ error: err.message }));
    if (msg.type === 'songGuideRedo') return ready.then(() => songGuideRedo(msg.key, msg.model)).catch((err) => ({ error: err.message }));
    if (msg.type === 'showMeta') return SG.episodes.showMeta(msg.showKey);
    if (msg.type === 'finishShow') return ready.then(() => SG.episodes.finishShow(msg.showKey, msg.plan, settings, msg.langs && msg.langs.length ? msg.langs : (settings.learning || ['ja']), msg.scope || null)).catch((err) => ({ error: err.message }));
    if (msg.type === 'finishEstimate') return ready.then(() => SG.episodes.estimate(msg.showKey, settings));
    if (msg.type === 'companionEstimate') return ready.then(async () => { const p = await SG.episodes.companionPlan(msg.showKey, settings); return p.error ? p : p.estimate; });
    if (msg.type === 'companionStart') return ready.then(() => SG.episodes.startCompanion(msg.showKey, settings)).catch((err) => ({ error: err.message }));
    if (msg.type === 'finishStart') return ready.then(() => SG.episodes.startFinishBatch(msg.showKey, settings)).catch((err) => ({ error: err.message }));
    if (msg.type === 'episodeWrite') return ready.then(() => SG.episodes.write(msg.key, msg.kind, settings, msg.again)).catch((err) => ({ error: err.message }));
    if (msg.type === 'showVocab') return ready.then(() => SG.episodes.showVocab(msg.showKey, settings, msg.again)).catch((err) => ({ error: err.message }));
    if (msg.type === 'spendLog') return browser.storage.local.get('spendLog').then((r) => r.spendLog || { days: {}, shows: {}, top: [] });
    if (msg.type === 'backupNow') return SG.autobackup.check(true);
    if (msg.type === 'backupStatus') return SG.autobackup.status();
    // Chrome: subtitle files the page's player fetched, passed on by chrome/netcapture.js.
    if (msg.type === 'netSub' && sender && sender.tab) {
      sniffer.ingest(sender.tab.id, String(msg.url || ''), String(msg.contentType || ''), msg.text);
      return Promise.resolve(true);
    }
    if (msg.type === 'ltPing') return Promise.resolve(true);
    if (msg.type === 'syncNow') return SG.cloudsync.check();
    if (msg.type === 'syncStatus') return SG.cloudsync.status();
    if (msg.type === 'driveStatus') return SG.drive.status();
    if (msg.type === 'driveConnect') return SG.drive.connect().catch((err) => ({ error: err.message }));
    if (msg.type === 'driveDisconnect') return SG.drive.disconnect();
    if (msg.type === 'driveRestoreFiles') return SG.drive.latestSet().then((files) => ({ files })).catch((err) => ({ error: err.message }));
    if (msg.type === 'restored') {
      // A backup was restored in the options page: reload settings and tell open tabs.
      return SG.loadSettings().then((s) => {
        settings = s;
        return true;
      });
    }
    if (msg.type === 'testKey') {
      return ready.then(() => claude.testKey(Object.assign({}, settings, msg.settings || {})));
    }
    if (msg.type === 'clearCache') return cache.clear().then(() => ({ ok: true }));
    // The word bank page changes saved items through here, so this page's copy stays current.
    if (msg.type === 'bankRemove' && msg.key) return cache.remove('bank', msg.key).then(() => ({ ok: true }));
    if (msg.type === 'bankPut' && Array.isArray(msg.items)) {
      return cache.putMany('bank', msg.items.filter((x) => x && x.key).map((x) => [x.key, Object.assign({}, x, { updatedAt: Date.now() })])).then(() => ({ ok: true, count: msg.items.length }));
    }
    if (msg.type === 'pitch') return pitchFor(msg.items || []).then((results) => ({ results }));
    if (msg.type === 'reviewed') {
      return updateDay((d) => {
        d.reviews = (d.reviews || 0) + 1;
      }).then(() => ({ ok: true }));
    }
    if (msg.type === 'seasonJobs') return getJobs().then((jobs) => ({ jobs: jobs.map(publicJob) }));
    if (msg.type === 'spend') return claude.spentThisMonth().then((spent) => ({ spent }));
    if (msg.type === 'grammarCloze' && msg.k) {
      return ready.then(async () => {
        const g = (await cache.getMany('guides', [guideKey(msg.k)])).get(guideKey(msg.k));
        try {
          const q = await claude.grammarCloze(settings, Object.assign({}, msg, { guide: g ? g.text : '' }));
          return { q };
        } catch (err) {
          return { error: err.message };
        }
      });
    }
    if (msg.type === 'stroke' && msg.ch) return strokeData(msg.ch, msg.lang).then((data) => ({ data }));
    if (msg.type === 'charInfo' && msg.ch) return charInfo(msg).then((entry) => ({ entry }), (err) => ({ error: err.message }));
    if (msg.type === 'openAt' && msg.url) {
      // Open a saved line's page; the player there jumps to the line once it loads.
      return browser.tabs.create({ url: msg.url }).then((tab) => {
        pendingSeeks.set(tab.id, { time: Math.max(0, Number(msg.time) || 0), until: Date.now() + 120000 });
        return { ok: true };
      });
    }
    if (msg.type === 'resetUsage') return browser.storage.local.remove('usage').then(() => ({ ok: true }));
    return undefined;
  });

  // ---- turning Langtitles off: shortcut, right-click menu, badge -----------------

  async function setEnabled(on) {
    await SG.saveSettings({ enabled: on });
  }

  async function toggleSite(tab) {
    let host = '';
    try {
      host = new URL(tab.url).hostname;
    } catch (e) {
      return;
    }
    const s = await SG.loadSettings();
    const list = (s.disabledHosts || []).filter((x) => x !== host);
    if (!(s.disabledHosts || []).includes(host)) list.push(host);
    await SG.saveSettings({ disabledHosts: list });
  }

  function paintBadge() {
    try {
      browser.browserAction.setBadgeText({ text: settings.enabled ? '' : 'off' });
      browser.browserAction.setBadgeBackgroundColor({ color: '#6b7080' });
      browser.browserAction.setTitle({ title: settings.enabled ? 'Langtitles (Alt+Shift+L turns it off)' : 'Langtitles is off (Alt+Shift+L turns it on)' });
    } catch (e) {
      /* no toolbar button (Android) */
    }
  }

  function buildMenus() {
    if (!browser.menus) return;
    browser.menus.removeAll().then(() => {
      const contexts = ['page', 'video', 'frame', SG.isChrome ? 'action' : 'browser_action'];
      browser.menus.create({ id: 'lt-toggle', title: settings.enabled ? 'Turn Langtitles off' : 'Turn Langtitles on', contexts });
      browser.menus.create({ id: 'lt-site', title: 'Langtitles on this site: switch on or off', contexts });
    });
  }

  if (browser.commands) {
    browser.commands.onCommand.addListener((name) => {
      if (name === 'toggle-langtitles') setEnabled(!settings.enabled);
    });
  }
  if (browser.menus) {
    browser.menus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === 'lt-toggle') setEnabled(!settings.enabled);
      else if (info.menuItemId === 'lt-site' && tab) toggleSite(tab);
    });
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      paintBadge();
      buildMenus();
    }
  });
  ready.then(() => {
    paintBadge();
    buildMenus();
  });

  sniffer.start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
