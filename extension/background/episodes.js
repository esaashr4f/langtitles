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

  SG.episodes = { saveFrame, getFrames, captureTab, epKey, seen, all, write, showVocab };
})(typeof globalThis !== 'undefined' ? globalThis : this);
