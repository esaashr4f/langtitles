// Scene frames and the shows you've watched: a small picture kept with a saved line, word or question,
// and per episode the lines you watched (for a spoiler-free recap and a language lesson) plus a frame.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});
  const cache = () => SG.cache;

  // ---- frames
  async function saveFrame(id, data) {
    if (!id || !/^data:image\//.test(data || '') || data.length > 400000) return false;
    await cache().putMany('frames', [[id, { id, data, at: Date.now() }]]);
    return true;
  }
  async function getFrames(ids) {
    const got = await cache().getMany('frames', ids.filter(Boolean));
    const out = {};
    for (const [k, v] of got) out[k] = v.data;
    return out;
  }

  // A screenshot of the tab cropped to the video, for players whose video can't be read directly.
  async function captureTab(tab, rect, dpr) {
    const shot = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    if (!rect) return shrink(shot);
    const img = await createImageBitmap(await (await fetch(shot)).blob());
    const s = dpr || 1;
    const sx = Math.max(0, rect.left * s);
    const sy = Math.max(0, rect.top * s);
    const sw = Math.min(img.width - sx, rect.width * s);
    const sh = Math.min(img.height - sy, rect.height * s);
    if (sw < 20 || sh < 20) return shrink(shot);
    const w = 360;
    const c = new OffscreenCanvas(w, Math.round((w * sh) / sw));
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return blobToData(await c.convertToBlob({ type: 'image/jpeg', quality: 0.65 }));
  }
  async function shrink(dataUrl) {
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const w = 360;
    const c = new OffscreenCanvas(w, Math.round((w * img.height) / img.width));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return blobToData(await c.convertToBlob({ type: 'image/jpeg', quality: 0.65 }));
  }
  function blobToData(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  }

  // ---- episodes
  function showKeyOf(ep) {
    return SG.episode.showKey ? SG.episode.showKey(ep) : 't:' + String(ep.title || '').toLowerCase();
  }
  function epKey(ep) {
    return `${showKeyOf(ep)}#${ep.season || 1}#${ep.episode || 0}`;
  }

  // Called every minute or so while an episode plays with a learning-language track.
  async function seen(msg) {
    const ep = msg.episode;
    if (!ep || !ep.title) return null;
    const key = epKey(ep);
    const prev = (await cache().getMany('episodes', [key])).get(key) || { key, first: Date.now(), watched: 0 };
    const entry = Object.assign(prev, {
      show: ep.title,
      showKey: showKeyOf(ep),
      season: ep.season || 1,
      episode: ep.episode || 0,
      type: ep.type || (ep.episode ? 'tv' : 'movie'),
      lang: msg.lang || prev.lang || '',
      url: msg.url || prev.url || '',
      last: Date.now(),
      watched: Math.max(prev.watched || 0, msg.watched || 0),
      ep: Object.assign({}, ep, { episode: null }),
    });
    // Keep the lines seen so far (the recap and lesson use only these, so nothing past where you are).
    if (Array.isArray(msg.lines) && msg.lines.length) {
      const reached = msg.reachedIndex == null ? msg.lines.length : msg.reachedIndex + 1;
      if (!prev.lines || reached >= (prev.reached || 0)) {
        entry.lines = msg.lines.slice(0, 2000);
        entry.reached = Math.max(prev.reached || 0, reached);
      }
    }
    if (msg.frame && !prev.frame) {
      const id = 'ep:' + key;
      if (await saveFrame(id, msg.frame)) entry.frame = id;
    }
    if (!entry.poster && SG.shows && SG.shows.posterFor) {
      entry.poster = await SG.shows.posterFor({ title: ep.title, type: entry.type, lang: entry.lang }).catch(() => '') || '';
    }
    await cache().putMany('episodes', [[key, entry]]);
    return entry;
  }

  // A frame taken while watching (about once a minute), with the moment and the line on screen, for lessons.
  async function addFrame(msg) {
    const ep = msg.episode;
    if (!ep || !ep.title || !msg.data) return null;
    const key = epKey(ep);
    const e = (await cache().getMany('episodes', [key])).get(key);
    if (!e) return null;
    const frames = Array.isArray(e.frames) ? e.frames : [];
    const t = Math.round(msg.time || 0);
    if (frames.some((f) => Math.abs(f.time - t) < 40)) return e;
    const id = `ep:${key}:${t}`;
    if (!(await saveFrame(id, msg.data))) return e;
    e.frames = frames.concat({ id, time: t, idx: msg.idx == null ? -1 : msg.idx, line: msg.line || '' }).sort((a, b) => a.time - b.time).slice(0, 90);
    await cache().putMany('episodes', [[key, e]]);
    return e;
  }

  // Frames spread across what the lesson covers (at most twelve), with their pictures.
  async function framesFor(e, upto) {
    const list = (e.frames || []).filter((f) => f.idx < upto);
    const pick = [];
    const n = Math.min(12, list.length);
    for (let i = 0; i < n; i++) pick.push(list[Math.floor((i * list.length) / n)]);
    const data = await getFrames(pick.map((f) => f.id));
    return pick.filter((f) => data[f.id]).map((f) => Object.assign({ data: data[f.id] }, f));
  }

  async function showMeta(showKey) {
    const metaKey = 'show:' + showKey;
    return (await cache().getMany('episodes', [metaKey])).get(metaKey) || { key: metaKey, meta: true, showKey, last: 0 };
  }

  // The episode lesson: a walk through the episode, teaching the language as it goes. Spoiler-free unless
  // the show is marked finished.
  const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-fable-5-2': [8, 40] };
  // What one lesson costs: typical and at most (the length is capped at 16,000 tokens of text).
  async function lessonEstimate(key, settings) {
    const e = (await cache().getMany('episodes', [key])).get(key);
    if (!e) return { error: 'That episode is no longer saved.' };
    const meta = await showMeta(e.showKey);
    const spoilers = Boolean(meta.finished || (meta.finishedSeasons || []).includes(e.season));
    const lines = spoilers ? e.lines || [] : watchedLines(e);
    const input = lines.join('\n').length / 1.6 + 2500 + Math.min(12, (e.frames || []).length) * 120;
    const out = {};
    for (const m of ['claude-sonnet-5-5', 'claude-opus-5-5']) {
      const [pi, po] = PRICES[m];
      out[m] = { typical: Math.round(((input * pi + 9000 * po) / 1e6) * 100) / 100, most: Math.round(((input * pi + 16000 * po) / 1e6) * 100) / 100 };
    }
    return { lines: lines.length, prices: out };
  }

  // One lesson through the Batch API (half price, usually ready within the hour); collected by pollFinish.
  async function walkBatch(key, settings, model) {
    const e = (await cache().getMany('episodes', [key])).get(key);
    if (!e) return { error: 'That episode is no longer saved.' };
    const meta = await showMeta(e.showKey);
    const spoilers = Boolean(meta.finished || (meta.finishedSeasons || []).includes(e.season));
    const lines = spoilers ? e.lines || [] : watchedLines(e);
    if (lines.length < 5) return { error: 'Not enough of this episode has been watched with subtitles yet.' };
    const frames = await framesFor(e, lines.length);
    const s = Object.assign({}, settings, { model });
    const lang = String(e.lang || 'ja').slice(0, 2);
    const params = SG.claude.plainParams(SG.claude.lessonParams(s, SG.prompt.walkSystemPrompt(settings.nativeLang, lang, { spoilers, frames: frames.length > 0 }), SG.prompt.walkUserMessage(e, lines, frames), frames.map((f) => f.data)));
    const batch = await SG.claude.batchCreate(s, [{ custom_id: 'one', params }]);
    e.walkBatch = { batchId: batch.id, model, spoilers, frames: frames.map((f) => f.id), sent: Date.now() };
    await cache().putMany('episodes', [[key, e]]);
    return { ok: true };
  }

  async function writeWalk(key, settings, again, onText, model) {
    const e = (await cache().getMany('episodes', [key])).get(key);
    if (!e) return { error: 'That episode is no longer saved.' };
    if (!again && e.walk) return { text: e.walk.text, model: e.walk.model, frames: e.walk.frames || [], cached: true };
    const meta = await showMeta(e.showKey);
    const spoilers = Boolean(meta.finished || (meta.finishedSeasons || []).includes(e.season));
    const lines = spoilers ? e.lines || [] : watchedLines(e);
    if (lines.length < 5) return { error: 'Not enough of this episode has been watched with subtitles yet.' };
    const frames = await framesFor(e, lines.length);
    model = model || SG.modelFor(settings, 'lessons');
    const s = Object.assign({}, settings, { model, costFeature: 'lessons', costShow: e.show });
    const lang = String(e.lang || 'ja').slice(0, 2);
    const P = SG.prompt;
    const text = await SG.claude.writeLesson(s, P.walkSystemPrompt(settings.nativeLang, lang, { spoilers, frames: frames.length > 0 }), P.walkUserMessage(e, lines, frames), frames.map((f) => f.data), onText);
    e.walk = { text: SG.guideText ? SG.guideText.stripRomaji(text) : text, model, at: Date.now(), spoilers, frames: frames.map((f) => f.id) };
    await cache().putMany('episodes', [[key, e]]);
    return { text: e.walk.text, model, frames: e.walk.frames, cached: false };
  }

  async function all() {
    return (await cache().getAll('episodes')).filter((e) => !e.meta).sort((a, b) => b.last - a.last);
  }

  // Lines up to where you've watched, numbered, for the prompts.
  function watchedLines(e) {
    const n = Math.min((e.lines || []).length, e.reached || (e.lines || []).length);
    return (e.lines || []).slice(0, n);
  }

  // Recap or lesson for one episode, written once and kept with the episode.
  async function write(key, kind, settings, again) {
    const e = (await cache().getMany('episodes', [key])).get(key);
    if (!e) return { error: 'That episode is no longer saved.' };
    if (!again && e[kind]) return { text: e[kind].text, model: e[kind].model, cached: true };
    const lines = watchedLines(e);
    if (lines.length < 5) return { error: 'Not enough of this episode has been watched with subtitles yet.' };
    const model = SG.modelFor(settings, 'wordGuides');
    const s = Object.assign({}, settings, { model, costFeature: 'shows', costShow: e.show });
    const P = SG.prompt;
    const text = await SG.claude.streamPlain(s, P.episodeSystemPrompt(settings.nativeLang, kind), P.episodeUserMessage(e, lines, kind), kind === 'lesson' ? 10000 : 3000);
    e[kind] = { text: SG.guideText ? SG.guideText.stripRomaji(text) : text, model, at: Date.now() };
    await cache().putMany('episodes', [[key, e]]);
    return { text: e[kind].text, model, cached: false };
  }

  // Vocabulary for a whole show, from the episodes you've watched only.
  async function showVocab(showKey, settings, again) {
    const eps = (await all()).filter((e) => e.showKey === showKey).sort((a, b) => a.season - b.season || a.episode - b.episode);
    if (!eps.length) return { error: 'No episodes of this show saved yet.' };
    const metaKey = 'show:' + showKey;
    const meta = (await cache().getMany('episodes', [metaKey])).get(metaKey);
    const watchedSig = eps.map((e) => `${e.season}x${e.episode}:${e.reached || 0}`).join(',');
    if (!again && meta && meta.vocab && meta.sig === watchedSig) return { text: meta.vocab.text, model: meta.vocab.model, cached: true };
    const lines = [];
    for (const e of eps) lines.push(`--- Season ${e.season}, episode ${e.episode} ---`, ...watchedLines(e));
    const model = SG.modelFor(settings, 'wordGuides');
    const s = Object.assign({}, settings, { model, costFeature: 'shows', costShow: eps[0].show });
    const text = await SG.claude.streamPlain(s, SG.prompt.showVocabSystemPrompt(settings.nativeLang), `Show: ${eps[0].show}\nLanguage: ${eps[0].lang || 'unknown'}\n\n${lines.slice(0, 6000).join('\n')}`, 12000);
    const vocab = { text: SG.guideText ? SG.guideText.stripRomaji(text) : text, model, at: Date.now() };
    await cache().putMany('episodes', [[metaKey, { key: metaKey, meta: true, showKey, sig: watchedSig, vocab, last: 0 }]]);
    return { text: vocab.text, model, cached: false };
  }

  // ---- "I've finished this show": subtitles for every episode, then a lesson per episode (spoilers allowed)
  // written through the Batch API at half price. The plan is per season: { season, from, to }.
  async function finishShow(showKey, plan, settings, langs, scope) {
    const eps = (await all()).filter((e) => e.showKey === showKey);
    const sample = eps.find((e) => e.ep) || eps[0];
    if (!sample) return { error: 'Watch at least one episode with Langtitles first, so it knows the show.' };
    const meta = await showMeta(showKey);
    // Finishing the show allows spoilers everywhere; finishing a season, up to the end of that season.
    if (scope && scope.season) meta.finishedSeasons = [...new Set((meta.finishedSeasons || []).concat(scope.season))];
    else meta.finished = true;
    meta.finish = { status: 'downloading', plan, scope: scope || null, started: Date.now(), episodes: [], batchId: null };
    let lastDownload = 0;
    await cache().putMany('episodes', [[meta.key, meta]]);
    const base = Object.assign({}, sample.ep || {}, { title: sample.show, type: sample.type || 'tv' });
    for (const p of plan) {
      for (let n = p.from; n <= p.to; n++) {
        const ep = Object.assign({}, base, { season: p.season, episode: n });
        const key = epKey(ep);
        const have = (await cache().getMany('episodes', [key])).get(key);
        const row = { season: p.season, episode: n, key, status: '' };
        meta.finish.episodes.push(row);
        if (have && have.lines && have.lines.length > 20) {
          row.status = 'have';
          continue;
        }
        try {
          // At most 20 downloads a minute (Jimaku allows 25).
          const wait = lastDownload + 3000 - Date.now();
          if (wait > 0) await new Promise((res) => setTimeout(res, wait));
          lastDownload = Date.now();
          const got = await SG.findEpisodeSubs(ep, langs);
          if (!got || !got.track) {
            row.status = got && got.errors && got.errors[0] === "not on the show's usual subtitle source" ? 'not on the usual source' : 'not found';
            continue;
          }
          const lines = got.track.cues.map((c) => c.text);
          await cache().putMany('episodes', [[key, Object.assign(have || { key, first: Date.now(), watched: 0, frames: [] }, {
            show: sample.show, showKey, season: p.season, episode: n, type: sample.type || 'tv', lang: got.track.lang || sample.lang,
            url: (have && have.url) || '', last: (have && have.last) || 0, lines, reached: lines.length, fromFinish: true, poster: sample.poster || '',
          })]]);
          row.status = 'found';
        } catch (err) {
          row.status = err.message || 'failed';
        }
        await cache().putMany('episodes', [[meta.key, meta]]);
      }
    }
    meta.finish.status = 'ready';
    await cache().putMany('episodes', [[meta.key, meta]]);
    return { meta, estimate: await estimate(showKey, settings) };
  }

  // A cost estimate for writing every lesson at half price (Batch API), before anything is paid.
  // The episodes a finish covers: the whole show, or one season.
  async function finishEpisodes(showKey) {
    const meta = await showMeta(showKey);
    const season = meta.finish && meta.finish.scope && meta.finish.scope.season;
    return (await all()).filter((e) => e.showKey === showKey && e.lines && e.lines.length && !(e.walk && e.walk.spoilers) && (!season || e.season === season));
  }

  async function estimate(showKey, settings) {
    const eps = await finishEpisodes(showKey);
    const model = SG.modelFor(settings, 'lessons');
    const price = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-fable-5-2': [8, 40] }[model] || [4, 20];
    let input = 0;
    for (const e of eps) input += (e.lines.join('\n').length / 1.6) + 2500 + (e.frames || []).slice(0, 12).length * 120;
    const output = eps.length * 7000;
    const dollars = ((input * price[0] + output * price[1]) / 1e6) / 2;
    return { episodes: eps.length, dollars: Math.round(dollars * 100) / 100, model };
  }

  // Send every lesson in one batch; results are collected by pollFinish.
  async function startFinishBatch(showKey, settings) {
    const meta = await showMeta(showKey);
    const eps = (await finishEpisodes(showKey)).sort((a, b) => a.season - b.season || a.episode - b.episode);
    if (!eps.length) return { error: 'No episodes with subtitles to write lessons for.' };
    const model = SG.modelFor(settings, 'lessons');
    const s = Object.assign({}, settings, { model });
    const requests = [];
    const ids = {};
    for (const e of eps) {
      const frames = await framesFor(e, e.lines.length);
      const lang = String(e.lang || 'ja').slice(0, 2);
      const id = `w${requests.length}`;
      ids[id] = { key: e.key, frames: frames.map((f) => f.id) };
      requests.push({ custom_id: id, params: SG.claude.plainParams(SG.claude.lessonParams(s, SG.prompt.walkSystemPrompt(settings.nativeLang, lang, { spoilers: true, frames: frames.length > 0 }), SG.prompt.walkUserMessage(e, e.lines, frames), frames.map((f) => f.data))) });
    }
    const batch = await SG.claude.batchCreate(s, requests);
    meta.finish = Object.assign(meta.finish || {}, { status: 'writing', batchId: batch.id, ids, model, sent: Date.now(), total: requests.length });
    await cache().putMany('episodes', [[meta.key, meta]]);
    return { ok: true, total: requests.length };
  }

  // ---- the show companion, written in parts of about eight episodes through the Batch API ----------
  function oneLine(e) {
    const best = SG.guideText ? SG.guideText.section(e.walk ? e.walk.text : '', 'The best lessons in this episode') : '';
    const first = (e.walk ? e.walk.text : '').replace(/^##.*$/gm, '').replace(/\s+/g, ' ').trim();
    return `S${e.season}E${e.episode}: ` + (best || first).replace(/\s+/g, ' ').slice(0, 300);
  }

  async function companionPlan(showKey, settings) {
    const eps = (await all()).filter((e) => e.showKey === showKey && e.walk).sort((a, b) => a.season - b.season || a.episode - b.episode);
    if (!eps.length) return { error: 'Write the episode lessons first: the companion is built on them.' };
    const size = 8;
    const parts = [];
    for (let i = 0; i < eps.length; i += size) parts.push(eps.slice(i, i + size));
    const model = SG.modelFor(settings, 'lessons');
    const price = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-fable-5-2': [8, 40] }[model] || [4, 20];
    let input = 0;
    for (const p of parts) input += eps.length * 120 + p.reduce((n, e) => n + e.walk.text.length / 2.5, 0) + 1500;
    const output = parts.length * 16000;
    const dollars = ((input * price[0] + output * price[1]) / 1e6) / 2;
    return { eps, parts, model, estimate: { parts: parts.length, episodes: eps.length, dollars: Math.round(dollars * 100) / 100, model } };
  }

  async function startCompanion(showKey, settings) {
    const plan = await companionPlan(showKey, settings);
    if (plan.error) return plan;
    const meta = await showMeta(showKey);
    const s = Object.assign({}, settings, { model: plan.model });
    const lang = String(plan.eps[0].lang || 'ja').slice(0, 2);
    const summaries = plan.eps.map(oneLine);
    const requests = plan.parts.map((p, i) => ({
      custom_id: 'c' + i,
      params: SG.claude.plainParams(SG.claude.lessonParams(s, SG.prompt.companionSystemPrompt(settings.nativeLang, lang), SG.prompt.companionUserMessage(plan.eps[0].show, i + 1, plan.parts.length, summaries, p.map((e) => `S${e.season}E${e.episode}\n${e.walk.text}`)), [])),
    }));
    const batch = await SG.claude.batchCreate(s, requests);
    meta.companion = { status: 'writing', batchId: batch.id, model: plan.model, total: requests.length, parts: plan.parts.map((p) => ({ from: `S${p[0].season}E${p[0].episode}`, to: `S${p[p.length - 1].season}E${p[p.length - 1].episode}` })), texts: [], sent: Date.now() };
    await cache().putMany('episodes', [[meta.key, meta]]);
    return { ok: true, total: requests.length };
  }

  // Check running whole-show batches and save the lessons that are done.
  async function pollFinish(settings) {
    for (const e of (await cache().getAll('episodes')).filter((x) => !x.meta && x.walkBatch)) {
      const b = await SG.claude.batchRetrieve(settings, e.walkBatch.batchId).catch(() => null);
      if (!b || b.processing_status !== 'ended') continue;
      const texts = await SG.claude.batchTexts(settings, e.walkBatch.batchId).catch(() => ({}));
      if (texts.one) e.walk = { text: SG.guideText ? SG.guideText.stripRomaji(texts.one) : texts.one, model: e.walkBatch.model, at: Date.now(), spoilers: e.walkBatch.spoilers, frames: e.walkBatch.frames, batch: true };
      delete e.walkBatch;
      await cache().putMany('episodes', [[e.key, e]]);
    }
    const companions = (await cache().getAll('episodes')).filter((m) => m.meta && m.companion && m.companion.status === 'writing' && m.companion.batchId);
    for (const meta of companions) {
      const b = await SG.claude.batchRetrieve(settings, meta.companion.batchId).catch(() => null);
      if (!b) continue;
      meta.companion.progress = b.request_counts;
      if (b.processing_status === 'ended') {
        const texts = await SG.claude.batchTexts(settings, meta.companion.batchId);
        meta.companion.texts = meta.companion.parts.map((_, i) => (texts['c' + i] ? (SG.guideText ? SG.guideText.stripRomaji(texts['c' + i]) : texts['c' + i]) : ''));
        meta.companion.status = 'done';
        meta.companion.at = Date.now();
      }
      await cache().putMany('episodes', [[meta.key, meta]]);
    }
    const metas = (await cache().getAll('episodes')).filter((m) => m.meta && m.finish && m.finish.status === 'writing' && m.finish.batchId);
    for (const meta of metas) {
      const b = await SG.claude.batchRetrieve(settings, meta.finish.batchId).catch(() => null);
      if (!b) continue;
      meta.finish.progress = b.request_counts;
      if (b.processing_status === 'ended') {
        const texts = await SG.claude.batchTexts(settings, meta.finish.batchId);
        let saved = 0;
        for (const [id, text] of Object.entries(texts)) {
          const info = meta.finish.ids[id];
          if (!info || !text) continue;
          const e = (await cache().getMany('episodes', [info.key])).get(info.key);
          if (!e) continue;
          e.walk = { text: SG.guideText ? SG.guideText.stripRomaji(text) : text, model: meta.finish.model, at: Date.now(), spoilers: true, frames: info.frames, batch: true };
          await cache().putMany('episodes', [[info.key, e]]);
          saved++;
        }
        meta.finish.status = 'done';
        meta.finish.saved = saved;
      }
      await cache().putMany('episodes', [[meta.key, meta]]);
    }
  }

  SG.episodes = { lessonEstimate, walkBatch, companionPlan, startCompanion, saveFrame, getFrames, captureTab, epKey, seen, addFrame, all, write, writeWalk, showVocab, showMeta, finishShow, estimate, startFinishBatch, pollFinish };
})(typeof globalThis !== 'undefined' ? globalThis : this);
