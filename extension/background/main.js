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

  async function analyzeBatch(texts, context, langHint, s) {
    try {
      return await withSlot(() => claude.analyzeLines(s || settings, texts, context, langHint));
    } catch (err) {
      if (err.code === 'truncated' && texts.length > 1) {
        const mid = Math.ceil(texts.length / 2);
        const first = await analyzeBatch(texts.slice(0, mid), context, langHint, s);
        const second = await analyzeBatch(texts.slice(mid), context.concat(texts.slice(0, mid)).slice(-3), langHint, s);
        return first.concat(second);
      }
      throw err;
    }
  }

  // lines: [{ key, text }]. Resolves to { results: { key: analysis }, error? }.
  async function analyze(req, tabId) {
    await ready;
    const fp = fingerprint();
    const results = {};
    const fullKey = (l) => fp + '|' + l.key;
    const cached = await cache.getMany('lines', req.lines.map(fullKey));
    const pending = [];
    const fresh = [];
    for (const line of req.lines) {
      const k = fullKey(line);
      if (cached.has(k)) results[line.key] = cached.get(k);
      else if (inflight.has(k)) pending.push(inflight.get(k).then((a) => a && (results[line.key] = a)));
      else fresh.push(line);
    }
    let error = null;
    if (fresh.length) {
      const batch = analyzeBatch(fresh.map((l) => l.text), req.context || [], req.lang, forTab(tabId));
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
          store.push([fullKey(line), out[i]]);
        });
        cache.putMany('lines', store).catch(() => {});
        lastError = null;
      } catch (err) {
        error = { code: err.code || 'unknown', message: err.message };
        lastError = Object.assign({ at: Date.now() }, error);
      }
    }
    await Promise.all(pending);
    return { results, error };
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
    const key = guideKey(req.form.k);
    const hit = (await cache.getMany('guides', [key])).get(key);
    if (hit) {
      port.postMessage({ type: 'deepDone', reqId: req.reqId, text: hit.text, model: hit.model || '' });
      return;
    }
    // The same form can be hovered in several places at once; write its guide only once.
    if (guidesInflight.has(key)) {
      guidesInflight.get(key).push({ port, reqId: req.reqId });
      return;
    }
    const built = req.kind === 'wordguide' ? null : await builtinGuide(req.form.k);
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
      const text = await writer(forTab(port.sender && port.sender.tab ? port.sender.tab.id : -1), req, (delta) => each((w) => w.port.postMessage({ type: 'deepDelta', reqId: w.reqId, delta })));
      const entry = {
        key, k: req.form.k, name: req.form.name || req.form.k, kind: req.kind === 'wordguide' ? 'word' : 'grammar', lang: req.lang || '', nativeLang: settings.nativeLang,
        text, sentence: req.sentence || '', word: req.word || '', model: settings.model, savedAt: Date.now(),
      };
      cache.putMany('guides', [[key, entry]]).catch(() => {});
      if (req.kind !== 'wordguide' && settings.addGrammarToReview) {
        bankSave({ kind: 'grammar', lang: req.lang || '', text: req.form.k, name: req.form.name || req.form.k, context: req.sentence ? { sentence: req.sentence, savedAt: Date.now() } : null }).catch(() => {});
      }
      each((w) => w.port.postMessage({ type: 'deepDone', reqId: w.reqId, text, model: entry.model }));
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
              store.push([job.fingerprint + '|' + keys[i], a]);
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
    delete entry.context;
    await cache.putMany('bank', [[key, entry]]);
    return entry;
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

  // ---- questions asked about lines: kept for good, shown again under the same line
  function questionKey(sentence) {
    return String(sentence || '').replace(/\s+/g, '');
  }
  async function saveQuestion(msg, answer) {
    const id = ['q', Date.now(), Math.random().toString(36).slice(2, 7)].join('|');
    const item = {
      id, line: questionKey(msg.sentence), sentence: msg.sentence || '', translation: msg.translation || '',
      q: msg.question, a: answer, show: msg.show || '', episode: msg.episode || null, lang: msg.lang || '',
      url: msg.url || '', time: msg.time == null ? null : msg.time, model: settings.model, savedAt: Date.now(),
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

  // Automatic loading: a file chosen before for this episode, otherwise the best search result.
  async function autoSubtitle(ep, langs) {
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
        analyze(msg, tabId).then((res) => send(port, { type: 'analyzed', reqId: msg.reqId, results: res.results, error: res.error }));
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
            },
            (err) => send(port, { type: 'askError', reqId: msg.reqId, message: err.message }),
          );
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
          .then(() => autoSubtitle(msg.episode, msg.langs))
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

  browser.runtime.onMessage.addListener((msg) => {
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
    if (msg.type === 'spendLog') return browser.storage.local.get('spendLog').then((r) => r.spendLog || { days: {}, shows: {}, top: [] });
    if (msg.type === 'backupNow') return SG.autobackup.check(true);
    if (msg.type === 'backupStatus') return SG.autobackup.status();
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
      return cache.putMany('bank', msg.items.filter((x) => x && x.key).map((x) => [x.key, x])).then(() => ({ ok: true, count: msg.items.length }));
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
      const contexts = ['page', 'video', 'frame', 'browser_action'];
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
