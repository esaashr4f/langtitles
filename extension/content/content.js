// Content script: finds the video, collects subtitle lines from every available source,
// asks the background page to analyze them ahead of the playhead, and draws the overlay.
(function () {
  'use strict';
  if (window.__langtitlesLoaded || !document.documentElement || !(document instanceof HTMLDocument)) return;
  window.__langtitlesLoaded = true;

  const SG = globalThis.SG;
  const { parseSubtitles, lineKey, findCue } = SG.subtitles;
  const { detectLang, langName, langCode } = SG.lang;

  // Caption containers of common web players, used when no subtitle file could be captured.
  const CAPTION_SELECTORS = [
    '.jw-captions', '.jw-text-track-display', '.vjs-text-track-display', '.plyr__captions',
    '.shaka-text-container', '.player-timedtext', '.ytp-caption-window-container',
    '.atvwebplayersdk-captions-text', '.vds-captions', 'media-captions', '.art-subtitle',
    '.bmpui-ui-subtitle-overlay', '.dplayer-subtitle', '.mejs__captions-text', '.fp-captions',
    '.theoplayer-texttracks', '.dss-subtitle-renderer-wrapper', '[class*="subtitle-text"]',
    '[class*="SubtitleText"]', '[class*="caption-text"]', '[class*="captionText"]',
  ];

  const ROLE_LABELS = {
    subject: 'subject', topic: 'topic', object: 'object', indirect_object: 'to/for', predicate: 'predicate',
    complement: 'complement', modifier: 'modifier', adverbial: 'adverbial', time: 'time', place: 'place',
    connector: 'connector', address: 'address', interjection: 'interjection', quote: 'quote', other: '',
  };

  let settings = Object.assign({}, SG.DEFAULTS, { hasKey: false });
  let tabHost = location.hostname;
  let port = null;
  let video = null;
  let ui = null;

  const tracks = new Map(); // id -> { id, label, lang, source, cues, keys, offset, updatedAt }
  let activeId = null;
  let manualPick = null;
  let analyzeNative = false; // user explicitly picked a track in their own language

  const analyses = new Map(); // line key -> analysis
  const requested = new Set(); // keys currently being analyzed
  const failures = new Map(); // key -> { count, at }
  let inflight = 0;
  let pauseUntil = 0;
  let lastError = null;
  let reqSeq = 0;
  const pendingReqs = new Map(); // reqId -> keys

  let shownKey = null; // what the subtitle box currently shows
  let shownAnalyzed = false;
  let shownIndex = -1;
  let overlayHidden = false;

  let autoPaused = false;
  let hoverTimer = null;
  let leaveTimer = null;
  let deepTimer = null;
  let deepReq = 0;
  const deepModels = new Map(); // cache key -> the model that wrote it
  const deepPayloads = new Map(); // cache key -> the request that writes it (for Improve with Opus)
  const deepSentences = new Map(); // cache key -> the line the saved guide was written for
  const deepNotesList = new Map(); // cache key -> notes from your questions
  const deepNotes = new Map(); // cache key|line -> { why, added } when this line uses it differently
  const deepNoteFor = new Map(); // reqId -> target, for notes that arrive after the guide
  const sameLineKey = (t) => String(t || '').replace(/\s+/g, '');
  const deepTexts = new Map(); // cache key -> finished text (word explanations and grammar guides)
  const deepByReq = new Map(); // reqId -> { el, cacheKey, text, guide }
  const deepByKey = new Map(); // cache key -> the same object, while its text is still streaming
  let popFor = null;

  let domEl = null; // caption element being read from the page
  let domText = '';
  let picking = false;
  let lastSrc = '';
  const topLayer = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
  let lastRaiseCheck = 0;

  // Subtitle sites
  let tabUrl = '';
  let tabTitle = '';
  let playedFor = 0; // seconds of playback seen on this video, so ads and previews do not trigger a search
  let lastTickTime = null;
  const autoTried = new Set(); // episode keys already searched automatically on this page
  let autoBusy = false;
  let lastEpisode = null; // what was detected, for the toolbar popup
  let episodeCost = 0; // estimated dollars spent on this video so far
  let autoNote = ''; // what the automatic search last did
  const subReqs = new Map(); // reqId -> callback
  let offsetSaveTimer = null;

  // Known characters (furigana / pinyin hidden over them) and a pending jump to a saved line
  const known = { ja: new Set(), zh: new Set() };
  let jlptData = null;
  fetch(browser.runtime.getURL('data/jlpt.json')).then((r) => r.json()).then((d) => {
    jlptData = d;
    shownKey = null;
  }, () => {});
  let pendingSeek = null;

  // Known words (dictionary forms, per language), and the line-study helpers
  let knownWords = {}; // lang -> Set
  let lineNew = null; // { key, idx, words } for the line on screen
  let onePlusDone = null; // key of the last line paused for
  let replay = null; // { idx, end, rate, loop }

  // Listen mode (songs): what's playing, its lyrics and the song guide
  let listenNp = null; // { track, artist, album, duration, art, isSong, url }
  let listenKey = null;
  let listenBusy = false;
  let listenWaitSince = 0;
  let listenNote = '';
  let listenAsked = false; // the one-time "this looks like a song" offer on YouTube
  const askImages = new Map(); // line key -> the scene's picture, for Use the scene
  const songGuideTargets = new Map(); // reqId -> element the song guide streams into

  // ---------------------------------------------------------------- helpers

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    // Presses, clicks and typing on Langtitles' own elements are delivered by early.js, ahead of the
    // page (players that grab every click can't block them); other events go the normal way.
    const ue = SG.uiEvents;
    if (ue) {
      const add = el.addEventListener;
      const remove = el.removeEventListener;
      el.addEventListener = function (type, fn, opts) {
        if (ue.TYPES.includes(type)) ue.on(el, type, fn, opts);
        else add.call(el, type, fn, opts);
      };
      el.removeEventListener = function (type, fn, opts) {
        if (ue.TYPES.includes(type)) ue.off(el, type, fn);
        else remove.call(el, type, fn, opts);
      };
    }
    return el;
  }

  // A button or span with an icon (and optional text after it).
  function ih(tag, cls, icon, text, size) {
    const el = h(tag, cls);
    el.append(SG.icon(icon, { size: size || 16 }));
    if (text) el.append(h('span', 'lt-icon-t', text));
    return el;
  }

  function enabled() {
    return Boolean(settings.enabled) && !(settings.disabledHosts || []).includes(tabHost);
  }

  function active() {
    return activeId ? tracks.get(activeId) || null : null;
  }

  function fmtTime(t) {
    const s = Math.max(0, Math.floor(t));
    const m = Math.floor(s / 60);
    const hh = Math.floor(m / 60);
    const pad = (n) => String(n).padStart(2, '0');
    return hh ? `${hh}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  // Whether an element is part of Langtitles' overlay (the host or anything in its shadow root).
  function isOurs(el) {
    return Boolean(ui && el && (el === ui.host || ui.host.contains(el) || ui.root.contains(el)));
  }

  function isEditable(el) {
    if (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  // ------------------------------------------------------------- listen mode

  // Watch mode annotates subtitles on video; Listen mode annotates song lyrics. Music sites start in
  // Listen mode, everything else in Watch mode; the switch in the panel overrides it per site.
  function listenMode() {
    if (!SG.listen) return false;
    const pick = (settings.siteMode || {})[location.hostname];
    if (pick) return pick === 'listen';
    return SG.listen.musicSite();
  }

  function setMode(mode) {
    const siteMode = Object.assign({}, settings.siteMode, { [location.hostname]: mode });
    settings.siteMode = siteMode;
    savePatch({ siteMode });
    if (mode !== 'listen') {
      for (const [id, t] of tracks) if (t.source === 'lyrics') tracks.delete(id);
      listenKey = null;
      listenNp = null;
    }
    lastSrc = '';
    video = null;
    scan();
    if (ui) {
      applySettings();
      renderSong();
      renderTrackList();
    }
    chooseActive();
    place();
  }

  // Where the lyrics sheet goes on a music site (no video to draw on): Strip, Sheet or Focus.
  function sheetRect() {
    const W = document.documentElement.clientWidth || innerWidth;
    const H = innerHeight;
    const k = SG.listen.kind();
    const bar = k === 'ytmusic' ? 72 : k === 'spotify' ? 88 : 0;
    const top = k === 'ytmusic' ? 64 : 12;
    const size = settings.lyricsSize || 'sheet';
    if (size === 'strip') return { left: 12, top: H - bar - 132, width: W - 24, height: 120 };
    if (size === 'focus') return { left: 0, top, width: W, height: H - bar - top };
    const w = Math.round(Math.min(620, Math.max(380, W * 0.4)));
    return { left: W - w - 16, top: top + 8, width: w, height: H - bar - top - 24 };
  }

  // Lyrics for the song playing, fetched when the song changes.
  async function maybeListen() {
    if (listenBusy || !video || !SG.listen) return;
    const np = SG.listen.nowPlaying(video);
    if (!np) return;
    if (SG.listen.kind() === 'youtube' && !listenMode()) {
      // On YouTube, offer Listen mode once for a video that's clearly a song.
      if (np.isSong && !listenAsked && !(settings.siteMode || {})[location.hostname] && !hasLearningTrack()) {
        listenAsked = true;
        showToast('This looks like a song. Open the panel (G) to show its lyrics instead.');
        renderTrackList();
      }
      return;
    }
    if (!listenMode()) return;
    const key = SG.lyrics.songKey(np);
    if (key === listenKey) {
      if (listenNp && !listenNp.duration && np.duration) listenNp.duration = np.duration;
      return;
    }
    // Wait a moment for the song's length: LRCLIB matches on it, which avoids the wrong version.
    if (!np.duration) {
      if (!listenWaitSince) listenWaitSince = Date.now();
      if (Date.now() - listenWaitSince < 3000) return;
    }
    listenWaitSince = 0;
    listenKey = key;
    listenNp = np;
    listenBusy = true;
    listenNote = 'Looking for lyrics…';
    for (const [id, t] of tracks) if (t.source === 'lyrics') tracks.delete(id);
    manualPick = null;
    activeId = null;
    chooseActive();
    renderSong();
    try {
      const res = await request({ type: 'lyricsFind', np });
      if (listenKey !== key) return;
      if (res.track) useLyrics(res, 'auto');
      else {
        // The site's own lyrics (YouTube Music's tab; Spotify's or Apple's lyrics view when open), usually
        // licensed and often covering songs LRCLIB lacks (much K-pop); usually not timed.
        const own = await SG.listen.pageLyrics().catch(() => null);
        if (own && listenKey === key) {
          const got = await request({ type: 'lyricsOwn', text: own, np, from: 'page' });
          if (got.track) useLyrics(got, 'auto');
        }
        if (!active() || active().source !== 'lyrics') {
          listenNote = res.error || 'No lyrics found.';
          showToast(`${listenNote} Press G → Song to search for them or paste them.`);
        }
      }
      request({ type: 'songPlayed', np: Object.assign({}, np, { lang: res.track ? detectLang(res.track.cues.slice(0, 30).map((c) => c.text).join('\n')) : '' }) });
    } finally {
      listenBusy = false;
      renderSong();
    }
  }

  function useLyrics(res, how) {
    const tr = Object.assign({}, res.track, { offset: res.offset || 0, userOffset: Boolean(res.offset) });
    for (const [id, t] of tracks) if (t.source === 'lyrics' && id !== tr.id) tracks.delete(id);
    tracks.delete(tr.id);
    addTrack(tr);
    const t = tracks.get(tr.id);
    if (!t) return;
    if (how === 'manual') {
      manualPick = t.id;
      activeId = null;
      chooseActive();
    }
    const from = res.track.provider === 'ytmusic' ? "YouTube Music's lyrics" : res.track.provider === 'own' ? 'your lyrics' : 'LRCLIB';
    listenNote = `Lyrics from ${from}${res.track.synced ? '' : ', not timed yet'}${t.offset ? `, timing ${t.offset > 0 ? '+' : ''}${t.offset.toFixed(2)} s` : ''}`;
    showToast(`${listenNp ? listenNp.track : 'Song'}: ${listenNote}.`);
    renderSong();
  }

  // Karaoke: with word timings (enhanced LRC), the words sung so far light up.
  function paintSung(cue, now) {
    let sung = 0;
    for (const w of cue.words) if (w.start != null && w.start <= now) sung += w.text.length;
    else if (w.start == null) sung += w.text.length;
    let pos = 0;
    const lineText = cue.text;
    for (const tok of ui.line.querySelectorAll('.sg-tok, .sg-gap')) {
      const surf = tok.querySelector('.sg-surf');
      const s = surf ? surf.textContent.replace(/\s+/g, '') : '';
      const at = lineText.indexOf(s, pos);
      if (at >= 0) pos = at + s.length;
      tok.classList.toggle('sg-sung', s.length > 0 && at >= 0 && at + s.length <= sung + 1);
    }
  }

  // Shadowing: hear the line, say or sing it back (recorded on this computer only), then hear both.
  let shadowing = false;
  async function shadowLine() {
    const t = active();
    const cue = t && shownIndex >= 0 ? t.cues[shownIndex] : null;
    if (!cue || !video || shadowing) return;
    shadowing = true;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const len = Math.max(1.5, cue.end - cue.start) * 1000;
    const playLine = async () => {
      video.currentTime = cue.start + t.offset;
      await video.play().catch(() => {});
      await wait(len);
      video.pause();
    };
    let stream = null;
    try {
      showToast('Listen…');
      await playLine();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((res) => (rec.onstop = res));
      showToast('Your turn: say or sing the line now.');
      rec.start();
      await wait(len + 800);
      rec.stop();
      await stopped;
      showToast('The original, then you.');
      await playLine();
      const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      const audio = new Audio(url);
      await audio.play().catch(() => {});
      await new Promise((res) => (audio.onended = res));
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast("Couldn't use the microphone: " + (e.message || e.name) + '. Allow it for this site to shadow lines.');
    } finally {
      if (stream) stream.getTracks().forEach((x) => x.stop());
      shadowing = false;
    }
  }

  // The lines around the current one, for the lyrics sheet (one above, two below).
  function paintLyricsAround(t, idx, now) {
    if (!ui || !ui.lyrPrev) return;
    if (!t || t.source !== 'lyrics' || !ui.root.classList.contains('lt-sheet')) {
      ui.lyrPrev.textContent = '';
      ui.lyrNext.textContent = '';
      return;
    }
    let at = idx;
    if (at < 0) {
      at = t.cues.findIndex((c) => c.start > now) - 1;
      if (at < -1) at = t.cues.length - 1;
    }
    const prev = t.cues[at - (idx < 0 ? 0 : 1)];
    ui.lyrPrev.textContent = prev && idx >= 0 ? prev.text : idx < 0 && t.cues[at] ? t.cues[at].text : '';
    ui.lyrNext.textContent = '';
    for (const c of t.cues.slice(at + 1, at + 3)) ui.lyrNext.append(h('div', 'lt-lyr-line', c.text));
  }

  // ------------------------------------------------------------------ video

  function allVideos(rootNode, out, depth) {
    for (const v of rootNode.querySelectorAll('video')) out.push(v);
    if (depth > 3) return out;
    for (const el of rootNode.querySelectorAll('*')) {
      if (el.shadowRoot) allVideos(el.shadowRoot, out, depth + 1);
    }
    return out;
  }

  function bestVideo() {
    let best = null;
    let bestArea = 0;
    const list = document.querySelector('video') ? Array.from(document.querySelectorAll('video')) : allVideos(document, [], 0);
    for (const v of list) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (r.width < 200 || r.height < 110) continue;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  function scan() {
    const media = SG.listen ? SG.listen.mediaElement() : null;
    // A page with only audio (or a hidden video) may be in Listen mode; settings arrive once connected.
    if (media && !port) connect();
    const v = bestVideo() || (listenMode() ? media : null);
    if (v !== video) {
      video = v;
      if (video) {
        connect();
        buildUI();
        video.addEventListener('play', () => {
          if (!popFor) autoPaused = false;
        });
        video.addEventListener('seeking', () => pump());
        video.addEventListener('seeked', () => pump());
        video.addEventListener('playing', () => pump());
      }
    }
    if (!video) return;
    const src = video.currentSrc || video.src || '';
    if (src !== lastSrc) {
      hardsubSeen = [];
      hardsubLift = null;
      hardsubBroken = false;
      // A new video in the same page: subtitles captured well before it belong to the old one.
      if (lastSrc) {
        const cutoff = Date.now() - 15000;
        for (const [id, t] of tracks) if (t.source !== 'file' && t.updatedAt < cutoff) tracks.delete(id);
        manualPick = null;
        chooseActive();
      }
      // Only a switch to another video starts a new episode total, not the first address appearing.
      if (lastSrc) episodeCost = 0;
      lastSrc = src;
      playedFor = 0;
    }
    readTextTracks();
    findCaptionElement();
    if (SG.listen && (SG.listen.kind() || listenMode())) maybeListen();
  }

  // ------------------------------------------------------------- background

  function connect() {
    if (port) return;
    port = browser.runtime.connect({ name: 'langtitles' });
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null;
    });
  }

  function post(msg) {
    if (!port) connect();
    try {
      port.postMessage(msg);
      return true;
    } catch (e) {
      port = null;
      return false;
    }
  }

  // Settings as this site uses them: the site's own layout, if it has one, over the general settings.
  let rawSettings = Object.assign({}, SG.DEFAULTS);
  function adoptSettings(raw) {
    rawSettings = Object.assign({}, SG.DEFAULTS, raw);
    const s = Object.assign({}, rawSettings);
    const site = (s.siteLooks || {})[tabHost];
    return site ? Object.assign(s, site, { siteLook: true }) : Object.assign(s, { siteLook: false });
  }
  function siteLook() {
    return (settings.siteLooks || {})[tabHost] || null;
  }
  // Saves a change; layout changes go to this site's own layout when it has one.
  function savePatch(patch) {
    Object.assign(settings, patch);
    const site = siteLook();
    if (site && tabHost) {
      const general = {};
      const own = Object.assign({}, site);
      for (const [k, v] of Object.entries(patch)) {
        if (SG.LOOK_KEYS.includes(k)) own[k] = v;
        else general[k] = v;
      }
      general.siteLooks = Object.assign({}, rawSettings.siteLooks, { [tabHost]: own });
      settings.siteLooks = general.siteLooks;
      Object.assign(rawSettings, general);
      post({ type: 'saveSettings', patch: general });
    } else {
      Object.assign(rawSettings, patch);
      post({ type: 'saveSettings', patch });
    }
  }
  function setSiteLook(look) {
    const siteLooks = Object.assign({}, rawSettings.siteLooks);
    if (look) siteLooks[tabHost] = look;
    else delete siteLooks[tabHost];
    post({ type: 'saveSettings', patch: { siteLooks } });
    // Everything as it is now, except the layout settings, which go back to their general values.
    const base = Object.assign({}, settings, { siteLooks });
    for (const k of SG.LOOK_KEYS) base[k] = rawSettings[k];
    settings = adoptSettings(base);
    applySettings();
  }

  function onMessage(msg) {
    if (msg.type === 'init') {
      if (msg.tabHost) tabHost = msg.tabHost;
      settings = adoptSettings(msg.settings);
      tabUrl = msg.tabUrl || tabUrl;
      tabTitle = msg.tabTitle || tabTitle;
      if (msg.seekTo != null) pendingSeek = msg.seekTo;
      for (const t of msg.tracks || []) addTrack(t);
      applySettings();
    } else if (msg.type === 'settings') {
      const was = enabled();
      settings = adoptSettings(msg.settings);
      applySettings();
      if (ui && was !== enabled()) {
        // The overlay itself is hidden when off, so say it in a page-level note.
        flashNote(enabled() ? 'Langtitles on' : 'Langtitles off (Alt+Shift+L turns it back on)');
      }
    } else if (msg.type === 'track') {
      addTrack(msg.track);
    } else if (msg.type === 'analyzed') {
      onAnalyzed(msg);
    } else if (msg.type === 'deepDelta' || msg.type === 'deepDone' || msg.type === 'deepError' || msg.type === 'deepNote') {
      onDeep(msg);
    } else if (msg.type === 'cost') {
      episodeCost += Number(msg.cost) || 0;
      renderStatus();
    } else if (msg.type === 'askDelta' || msg.type === 'askDone' || msg.type === 'askError' || msg.type === 'askLesson') {
      onAsk(msg);
    } else if (msg.type === 'songGuideText' || msg.type === 'songGuideDone') {
      const el = songGuideTargets.get(msg.reqId);
      if (!el || !el.isConnected) return;
      if (msg.type === 'songGuideDone') songGuideTargets.delete(msg.reqId);
      if (msg.error) el.textContent = msg.error;
      else if (msg.text) {
        el.textContent = '';
        const songLang = langCode((active() || {}).lang || 'ja');
        SG.renderGuide(el, msg.text, {
          known: known.ja,
          plain: !settings.furigana,
          // Links in a song guide open that word's or form's guide in the panel.
          onLink: (kind, k, label) => {
            const w = { s: label, d: kind === 'g' ? label : k, m: '' };
            if (kind === 'g') openPanelGuide({ k: SG.canonicalForm(k.includes('.') ? k : `${songLang}.${k}`), name: label }, { sentence: '', lang: songLang }, w, false);
            else openPanelGuide(wordGuideForm(w, songLang), { sentence: '', lang: songLang }, w, true);
          },
        });
        if (msg.type === 'songGuideDone' && msg.model) {
          el.append(h('div', 'sg-note', `${SG.modelLabel(msg.model)}${msg.cached ? ' (saved earlier)' : ''}.`));
          if (msg.cached && listenNp && active()) {
            const t = active();
            const again = h('button', 'sg-link', 'Rewrite this guide (Sonnet, about $0.10)');
            again.addEventListener('click', () => {
              el.textContent = 'Rewriting…';
              const reqId = 'sg' + ++reqSeq;
              songGuideTargets.set(reqId, el);
              post({ type: 'songGuide', reqId, again: true, model: 'claude-sonnet-5-5', track: listenNp.track, artist: listenNp.artist, album: listenNp.album, art: listenNp.art, url: listenNp.url, lang: t.lang, lyrics: t.cues.map((c) => c.text) });
            });
            el.append(again);
          }
        }
      }
    } else if (['showsFound', 'tabInfo', 'subsFound', 'subLoaded', 'charInfo', 'bankSaved', 'bankStatus', 'stroke', 'episodeWords', 'pitch', 'seasonStarted', 'seasonJobs', 'showChoice', 'qaList', 'noteAdded', 'showSaved', 'dictCard', 'lyrics'].includes(msg.type)) {
      const cb = subReqs.get(msg.reqId);
      subReqs.delete(msg.reqId);
      if (cb) cb(msg);
    }
  }

  // ----------------------------------------------------------------- tracks

  function signature(cues) {
    return cues.length ? cues.length + '|' + cues[0].text + '|' + cues[cues.length - 1].text : '';
  }

  function addTrack(t) {
    if (!t || !t.cues || !t.cues.length) return;
    const prev = tracks.get(t.id);
    // The same subtitles can arrive twice (network capture and the <track> element); keep one.
    if (!prev) {
      const sig = signature(t.cues);
      for (const other of tracks.values()) {
        if (other.id !== t.id && other.source !== 'dom' && signature(other.cues) === sig) return;
      }
    }
    const keys = t.cues.map((c, i) => lineKey(c.text, i ? t.cues[i - 1].text : ''));
    tracks.set(t.id, {
      id: t.id,
      label: t.label || t.id,
      lang: t.lang || detectLang(t.cues.slice(0, 60).map((c) => c.text).join('\n')),
      source: t.source || 'net',
      cues: t.cues,
      keys,
      offset: prev ? prev.offset : t.offset || 0,
      updatedAt: Date.now(),
      provider: t.provider || null,
      episode: t.episode || null,
      synced: prev ? prev.synced : false,
      userOffset: prev ? prev.userOffset : Boolean(t.userOffset),
    });
    // A subtitle file from a subtitle site can be lined up as soon as the site's own subtitles arrive.
    if (t.source !== 'remote') for (const r of tracks.values()) if (r.source === 'remote' && !r.synced && !r.userOffset) syncRemote(r, false);
    chooseActive();
    if (ui) renderTrackList();
    if (t.id === activeId) {
      renderTranscript();
      pump();
    }
  }

  function trackScore(t) {
    if (t.source === 'file') return 10000;
    if (t.source === 'lyrics') return listenMode() ? 5000 : 0;
    const native = langCode(settings.nativeLang);
    if (t.lang === native) return -1;
    // The site's own subtitles are timed to its video, so they beat a downloaded file in the same language.
    let score = t.source === 'dom' ? 1 : t.source === 'remote' ? 80 : 100;
    if (settings.hostLang && settings.hostLang[tabHost] === t.lang) score += 500;
    const idx = (settings.learning || []).indexOf(t.lang);
    if (idx >= 0) score += 300 - idx * 10;
    if (t.source === 'texttrack' && t.showing) score += 40;
    return score + t.updatedAt / 1e13;
  }

  // Ask for every saved breakdown of a track at once (nothing is bought), so a reload shows them all.
  function preloadSaved(t) {
    if (!t || preloaded.has(t.id)) return;
    preloaded.add(t.id);
    const song = t.source === 'lyrics' && listenNp ? { track: listenNp.track, artist: listenNp.artist } : undefined;
    for (let i = 0; i < t.cues.length; i += 400) {
      const lines = [];
      for (let j = i; j < Math.min(t.cues.length, i + 400); j++) if (!analyses.has(t.keys[j])) lines.push({ key: t.keys[j], text: t.cues[j].text });
      if (!lines.length) continue;
      const reqId = ++reqSeq;
      savedReqs.add(reqId);
      post({ type: 'analyze', reqId, lang: t.lang, context: [], lines, song, savedOnly: true });
      // Never hold the breakdowns up for long if the answer is lost.
      setTimeout(() => {
        if (savedReqs.delete(reqId)) pump();
      }, 8000);
    }
  }

  function chooseActive() {
    let next = null;
    if (manualPick && tracks.has(manualPick)) next = manualPick;
    else {
      let best = 0;
      for (const t of tracks.values()) {
        const s = trackScore(t);
        if (s > best) {
          best = s;
          next = t.id;
        }
      }
    }
    if (next !== activeId) {
      activeId = next;
      analyzeNative = Boolean(manualPick);
      shownKey = null;
      shownIndex = -1;
      if (ui) {
        renderTrackList();
        renderTranscript();
        applyHideNative();
        applySettings();
      }
      pump();
    }
    if (activeId) preloadSaved(tracks.get(activeId));
  }

  function readTextTracks() {
    if (!video || !video.textTracks) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      const tt = video.textTracks[i];
      if (tt.kind !== 'subtitles' && tt.kind !== 'captions') continue;
      const list = tt.cues;
      if (!list || !list.length) continue;
      const id = 'tt:' + i + ':' + (tt.language || '') + ':' + (tt.label || '');
      const existing = tracks.get(id);
      if (existing && existing.cues.length === list.length) {
        existing.showing = tt.mode === 'showing';
        continue;
      }
      const cues = [];
      for (let j = 0; j < list.length; j++) {
        const c = list[j];
        const text = SG.subtitles.cleanText(c.text || '');
        if (text) cues.push({ start: c.startTime, end: c.endTime, text });
      }
      const norm = SG.subtitles.normalizeCues(cues);
      if (!norm.length) continue;
      addTrack({
        id,
        label: tt.label || langName(tt.language) || 'Text track ' + (i + 1),
        lang: tt.language ? langCode(tt.language) : undefined,
        source: 'texttrack',
        cues: norm,
      });
      const added = tracks.get(id);
      if (added) added.showing = tt.mode === 'showing';
    }
  }

  // Reading captions straight off the page: the fallback when no file was captured.
  function findCaptionElement() {
    if (domEl && domEl.isConnected) return;
    domEl = null;
    const saved = settings.hostSelectors && settings.hostSelectors[location.hostname];
    for (const sel of (saved ? [saved] : []).concat(CAPTION_SELECTORS)) {
      let el = null;
      try {
        el = document.querySelector(sel);
      } catch (e) {
        continue;
      }
      if (el && !isOurs(el)) {
        domEl = el;
        return;
      }
    }
  }

  function readDomCaption() {
    if (!domEl || !video) return;
    const text = SG.subtitles.cleanText(domEl.innerText || domEl.textContent || '');
    if (text === domText) return;
    domText = text;
    let t = tracks.get('dom');
    const now = video.currentTime;
    if (t && t.cues.length) {
      const last = t.cues[t.cues.length - 1];
      if (last.end > now) last.end = Math.max(last.start + 0.05, now);
    }
    if (!text) return;
    if (!t) {
      t = { id: 'dom', label: 'On-screen captions', lang: detectLang(text), source: 'dom', cues: [], keys: [], offset: 0, updatedAt: Date.now() };
      tracks.set('dom', t);
    }
    // Rewinding replays lines we already have; only record new ones.
    const at = findCue(t.cues, now);
    if (at !== -1 && t.cues[at].text === text) return;
    const prev = t.cues.length ? t.cues[t.cues.length - 1].text : '';
    const cue = { start: now, end: now + 8, text };
    let i = t.cues.length;
    while (i > 0 && t.cues[i - 1].start > now) i--;
    t.cues.splice(i, 0, cue);
    t.keys.splice(i, 0, lineKey(text, prev));
    t.updatedAt = Date.now();
    if (t.cues.length === 3) t.lang = detectLang(t.cues.map((c) => c.text).join('\n'));
    chooseActive();
    if (activeId === 'dom') {
      renderTranscript();
      pump();
    }
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const { cues } = parseSubtitles(String(reader.result));
      if (!cues.length) {
        showToast('That file has no subtitles Langtitles can read (.srt, .vtt, .ass, .ttml).');
        return;
      }
      const id = 'file:' + file.name;
      addTrack({ id, label: file.name, source: 'file', cues });
      manualPick = id;
      chooseActive();
    };
    reader.readAsText(file);
  }

  // --------------------------------------------------------------- analysis

  function shouldAnalyze(t) {
    if (!t || !enabled() || !settings.hasKey) return false;
    if (t.lang === langCode(settings.nativeLang) && !analyzeNative && t.source !== 'file') return false;
    return true;
  }

  function pump() {
    const t = active();
    if (!video || !shouldAnalyze(t) || Date.now() < pauseUntil) return;
    // Wait for the saved breakdowns to come back first, so nothing saved is bought again.
    if (t && !preloaded.has(t.id)) preloadSaved(t);
    if (savedReqs.size) return;
    // Sites that resume an episode at 8:00 often report 0:00 for a moment first. Wait until the
    // video is really at its position, so lines before it are not prepared.
    if (video.seeking || video.readyState < 2 || (video.currentTime < 0.5 && (video.paused || !video.played.length))) return;
    const now = video.currentTime - t.offset;
    const horizon = settings.lookaheadMin > 0 ? now + settings.lookaheadMin * 60 : Infinity;
    // First line that has not finished yet.
    let from = 0;
    let lo = 0;
    let hi = t.cues.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t.cues[mid].end < now) {
        from = mid + 1;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const limit = Math.max(1, settings.concurrency || 1);
    while (inflight < limit) {
      const lines = [];
      const seen = new Set();
      let first = -1;
      // Keep the first batch small so the line on screen is ready as fast as possible.
      const urgent = from < t.cues.length && !analyses.has(t.keys[from]) && !requested.has(t.keys[from]);
      const size = urgent ? Math.min(3, settings.chunkSize) : settings.chunkSize;
      for (let i = from; i < t.cues.length && t.cues[i].start <= horizon && lines.length < size; i++) {
        const key = t.keys[i];
        if (analyses.has(key) || requested.has(key) || seen.has(key)) continue;
        const f = failures.get(key);
        if (f && (f.count >= 2 || Date.now() - f.at < 30000)) continue;
        if (first === -1) first = i;
        seen.add(key);
        lines.push({ key, text: t.cues[i].text });
      }
      if (!lines.length) break;
      const context = t.cues.slice(Math.max(0, first - 3), first).map((c) => c.text);
      const reqId = ++reqSeq;
      const song = t.source === 'lyrics' && listenNp ? { track: listenNp.track, artist: listenNp.artist, lyrics: Array.from(new Set(t.cues.map((c) => c.text))) } : undefined;
      const force = lines.some((l) => redoKeys.has(l.key));
      if (!post({ type: 'analyze', reqId, lang: t.lang, context, lines, song, force })) break;
      for (const l of lines) redoKeys.delete(l.key);
      for (const l of lines) requested.add(l.key);
      pendingReqs.set(reqId, lines.map((l) => l.key));
      inflight++;
    }
    renderStatus();
  }

  function onAnalyzed(msg) {
    if (msg.savedOnly) {
      // Saved breakdowns for the whole episode, loaded at once (free); lines not saved are left for pump().
      if (!savedReqs.delete(msg.reqId)) return;
      for (const [key, a] of Object.entries(msg.results || {})) {
        analyses.set(key, a);
        savedKeys.add(key);
        updateTranscriptRow(key);
      }
      renderStatus();
      if (listenMode()) paintSongCoverage();
      tick();
      pump();
      return;
    }
    const keys = pendingReqs.get(msg.reqId);
    if (!keys) return;
    pendingReqs.delete(msg.reqId);
    inflight = Math.max(0, inflight - 1);
    for (const key of keys) {
      requested.delete(key);
      const a = msg.results && msg.results[key];
      if (a) {
        analyses.set(key, a);
        failures.delete(key);
        updateTranscriptRow(key);
      } else {
        const f = failures.get(key) || { count: 0, at: 0 };
        failures.set(key, { count: f.count + 1, at: Date.now() });
      }
    }
    if (msg.error) {
      lastError = msg.error;
      const slow = ['auth', 'no_key', 'model', 'bad_request'].includes(msg.error.code);
      pauseUntil = Date.now() + (slow ? 60000 : 15000);
      showToast(msg.error.message);
    } else {
      lastError = null;
    }
    // A language guess from a few DOM lines can be wrong; trust the model once it has seen them.
    const t = active();
    if (t && t.lang === 'und') {
      const first = keys.map((k) => analyses.get(k)).find((a) => a && a.lang);
      if (first) {
        t.lang = langCode(first.lang);
        renderTrackList();
      }
    }
    tick();
    pump();
    if (listenMode()) paintSongCoverage();
  }

  // How much of the song you already know, and the words that would help most.
  function paintSongCoverage() {
    const el = ui && ui.panel.songCov;
    const t = active();
    if (!el || !el.isConnected || !t || t.source !== 'lyrics') return;
    const lang = langCode(t.lang);
    const counts = new Map();
    let ready = 0;
    const seenLine = new Set();
    t.cues.forEach((c, i) => {
      const a = analyses.get(t.keys[i]);
      if (!a || seenLine.has(c.text)) return;
      seenLine.add(c.text);
      ready++;
      for (const w of a.w || []) {
        if (isTrivial(w)) continue;
        const d = w.d || w.s;
        const x = counts.get(d) || { d, m: w.m, r: w.r, count: 0 };
        x.count++;
        counts.set(d, x);
      }
    });
    const lines = seenLine.size + new Set(t.cues.map((c) => c.text).filter((x) => !seenLine.has(x))).size;
    el.textContent = '';
    if (!ready) {
      el.append(h('div', 'sg-note', 'Coverage appears once the lyrics are prepared.'));
      return;
    }
    const list = [...counts.values()];
    const cov = computeCoverage(list, lang);
    const head = h('div', 'sg-scov-head');
    head.append(h('span', 'sg-scov-pct', cov.pct + '%'), h('span', 'sg-scov-of', `of the words in this song are ones you know${ready < lines ? ` (${ready} of ${lines} lines prepared)` : ''}`));
    el.append(head);
    const learn = list.filter((x) => !(knownWords[lang] && knownWords[lang].has(x.d))).sort((a, b) => b.count - a.count).slice(0, 5);
    if (learn.length) {
      el.append(h('div', 'sg-scov-sub', 'Learn these first:'));
      for (const x of learn) {
        const row = h('div', 'sg-scov-w');
        const w = h('span', 'sg-scov-d', x.d);
        w.lang = lang;
        row.append(w, h('span', 'sg-scov-m', x.m || ''), h('span', 'sg-scov-n', x.count > 1 ? '×' + x.count : ''));
        el.append(row);
      }
    }
  }

  // --------------------------------------------------------------------- UI

  function buildUI() {
    if (ui) return;
    // The overlay lives in its own shadow root, so the page's styles can't reach it.
    const host = document.createElement('langtitles-root');
    if (topLayer) host.setAttribute('popover', 'manual');
    host.setAttribute('translate', 'no');
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = browser.runtime.getURL('content/content.css');
    // If the page's security policy blocks the stylesheet, fall back to the same rules inline.
    sheet.addEventListener('error', () => {
      fetch(sheet.href).then((r) => r.text()).then((css) => {
        const st = document.createElement('style');
        st.textContent = css;
        shadow.prepend(st);
      }).catch(() => {});
    });
    const root = h('div', 'lt-root');
    shadow.append(sheet, root);
    if (typeof matchMedia === 'function' && matchMedia('(hover: none)').matches) root.classList.add('sg-touch');
    if (SG.uiEvents) SG.uiEvents.setRoot(root);
    const cover = h('div', 'sg-cover');
    const sub = h('div', 'sg-sub');
    const grip = ih('div', 'sg-grip', 'grip-horizontal', '', 16);
    grip.title = 'Drag to move the subtitles up or down';
    const line = h('div', 'sg-line');
    const tr = h('div', 'sg-tr');
    sub.append(grip, line, tr);
    // Drag the subtitles up or down; the height is saved as a share of the video's height.
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const start = settings.subBottom == null ? SG.DEFAULTS.subBottom : settings.subBottom;
      const vh = video ? video.getBoundingClientRect().height : 600;
      const move = (ev) => {
        settings.subBottom = Math.max(0, Math.min(80, Math.round(start + ((startY - ev.clientY) / vh) * 100)));
        applyLook();
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        savePatch({ subBottom: settings.subBottom });
        applySettings();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    const pop = h('div', 'sg-pop');
    const toggle = h('button', 'sg-toggle');
    const fox = h('img', 'sg-fox');
    fox.src = browser.runtime.getURL('icons/icon.svg');
    fox.alt = '';
    toggle.append(fox);
    toggle.title = 'Langtitles panel (G)';
    const toast = h('div', 'sg-toast');
    const panel = buildPanel();
    const lyrArt = h('div', 'lt-lyr-art');
    const lyrPrev = h('div', 'lt-lyr-prev');
    const lyrNext = h('div', 'lt-lyr-next');
    root.append(lyrArt, cover, lyrPrev, sub, lyrNext, pop, toggle, toast, panel.el);
    ui = { host, root, cover, sub, line, tr, pop, toggle, toast, panel, lyrArt, lyrPrev, lyrNext };

    const stop = (e) => e.stopPropagation();
    for (const el of [sub, pop, toggle, panel.el]) {
      for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu']) {
        el.addEventListener(type, stop);
      }
    }
    // Some players swallow clicks in full screen, so act on the press itself.
    let toggleAt = 0;
    const flipPanel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() - toggleAt < 400) return;
      toggleAt = Date.now();
      setPanel(!settings.panelOpen);
    };
    toggle.addEventListener('pointerdown', flipPanel, true);
    toggle.addEventListener('click', flipPanel, true);
    sub.addEventListener('mouseenter', cancelLeave);
    sub.addEventListener('mouseleave', scheduleLeave);
    pop.addEventListener('mouseenter', cancelLeave);
    pop.addEventListener('mouseleave', scheduleLeave);

    const raise = () => {
      // Re-enter the top layer after the full-screen element, so the overlay stays above it.
      if (topLayer && ui.host.matches(':popover-open')) ui.host.hidePopover();
      place();
    };
    document.addEventListener('fullscreenchange', () => {
      raise();
      // Some players switch to full screen in steps; make sure the overlay ends up on top.
      setTimeout(raise, 150);
      setTimeout(raise, 600);
      ui.root.classList.toggle('sg-fs', Boolean(document.fullscreenElement));
    });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onPickClick, true);

    place();
    applySettings();
  }

  function buildPanel() {
    const el = h('div', 'sg-panel');

    // ---- header: fox, name, status, quick actions
    const head = h('div', 'sg-panel-head');
    const logo = h('img', 'sg-panel-logo');
    logo.src = browser.runtime.getURL('icons/icon.svg');
    logo.alt = '';
    const titles = h('div', 'sg-panel-titles');
    const title = h('span', 'sg-panel-title', 'Langtitles');
    const status = h('span', 'sg-panel-status');
    titles.append(title, status);
    const readBtn = h('button', 'sg-icon-btn', 'あ');
    readBtn.title = 'Furigana / pinyin / hanja on or off (R)';
    readBtn.addEventListener('click', () => toggleReadings());
    const hideBtn = h('button', 'sg-switch');
    hideBtn.title = 'Turn Langtitles subtitles on or off (H)';
    hideBtn.append(h('span', 'sg-switch-label', 'Subtitles'), h('span', 'sg-switch-track'));
    hideBtn.addEventListener('click', () => toggleSubtitles());
    const bankBtn = ih('button', 'sg-icon-btn', 'bookmark');
    bankBtn.title = 'Word bank';
    bankBtn.addEventListener('click', () => post({ type: 'openBank' }));
    const close = ih('button', 'sg-icon-btn sg-close', 'x');
    close.title = 'Close panel (G)';
    close.addEventListener('click', () => setPanel(false));
    const modeSeg = h('div', 'sg-mode');
    const modeBtns = {};
    for (const [m, label, icon] of [['watch', 'Watch', 'eye'], ['listen', 'Listen', 'music']]) {
      const b = ih('button', 'sg-mode-b', icon, label, 14);
      b.title = m === 'watch' ? 'Watch mode: subtitles on video' : 'Listen mode: song lyrics';
      b.addEventListener('click', () => setMode(m));
      modeBtns[m] = b;
      modeSeg.append(b);
    }
    head.append(logo, titles, hideBtn, readBtn, bankBtn, close);

    // ---- tabs
    const TABS = [['line', 'Line'], ['transcript', 'Transcript'], ['words', 'Study'], ['subs', 'Subtitles'], ['display', 'Display']];
    const tabBar = h('div', 'sg-tabs');
    const tabButtons = new Map();
    const tabBodies = new Map();
    const setTab = (id) => {
      for (const [k, b] of tabButtons) b.classList.toggle('sg-on', k === id);
      for (const [k, body] of tabBodies) body.classList.toggle('sg-on', k === id);
      el.dataset.tab = id;
      if (id === 'transcript') highlightRow(shownIndex);
    };
    const SHORT = { transcript: 'Script', subs: 'Subs', display: 'Look' };
    for (const [id, label] of TABS) {
      const b = h('button', 'sg-tab');
      b.title = label;
      b.append(h('span', 'sg-tab-long', label), h('span', 'sg-tab-short', SHORT[id] || label));
      b.addEventListener('click', () => {
        setTab(id);
        if (id === 'words') openStudy(studyMode);
        if (id === 'subs' && !findBody.childElementCount) openFind();
      });
      tabButtons.set(id, b);
      tabBar.append(b);
      tabBodies.set(id, h('div', 'sg-tabbody sg-tab-' + id));
    }

    // ---- Line: what is on screen now, and guides opened from it
    const hint = h('div', 'sg-hint');
    const guide = h('div', 'sg-pguide');
    const guideHead = h('div', 'sg-pguide-head');
    const guideBack = ih('button', 'sg-icon-btn', 'chevron-left');
    guideBack.title = 'Back to the line';
    guideBack.addEventListener('click', () => guide.classList.remove('sg-show'));
    const guideTitle = h('span', 'sg-pguide-title');
    const guideLib = h('button', 'sg-btn sg-ghost', 'Library');
    guideLib.title = 'All the guides you have collected';
    guideLib.addEventListener('click', () => post({ type: 'openLibrary', k: guide.dataset.k || '' }));
    const guideFull = ih('button', 'sg-icon-btn', 'maximize-2');
    guideFull.title = 'Read this guide full screen';
    guideFull.addEventListener('click', () => {
      const g = panelGuide;
      if (g) openReader(g.form, g.ctx, g.w, g.isWord, () => openPanelGuide(g.form, g.ctx, g.w, g.isWord));
    });
    guideHead.append(guideBack, guideTitle, guideLib, guideFull);
    const guideBody = h('div', 'sg-pguide-body');
    guide.append(guideHead, guideBody);
    const detail = h('div', 'sg-detail');
    // Line controls: everything the keyboard shortcuts do, as buttons.
    const controls = h('div', 'sg-controls');
    const ctl = (icon, label, key, fn) => {
      const b = h('button', 'sg-ctl');
      b.title = `${label} (${key})`;
      b.setAttribute('aria-label', label);
      b.append(ih('span', 'sg-ctl-i', icon, '', 16), h('span', 'sg-ctl-l', label));
      b.addEventListener('click', fn);
      controls.append(b);
      return b;
    };
    ctl('skip-back', 'Previous', 'A', () => seekToCue(-1));
    ctl('rotate-ccw', 'Replay slow', 'S', () => replayLine(false));
    const loopBtn = ctl('repeat', 'Loop', 'L', () => replayLine(true));
    ctl('skip-forward', 'Next', 'D', () => seekToCue(1));
    const shadowBtn = ctl('mic', 'Shadow', 'M', () => shadowLine());
    shadowBtn.classList.add('sg-ctl-listen');
    tabBodies.get('line').append(hint, guide, detail, controls);

    // ---- Transcript
    const list = h('div', 'sg-list');
    tabBodies.get('transcript').append(list);

    // ---- Words: the episode's vocabulary
    // Study: the episode's words, grammar and phrases, side by side.
    const studySeg = h('div', 'sg-studyseg');
    const studyBtns = new Map();
    for (const [id, label] of [['words', 'Words'], ['grammar', 'Grammar'], ['phrases', 'Phrases']]) {
      const b = h('button', 'sg-seg-b', label);
      b.addEventListener('click', () => openStudy(id));
      studyBtns.set(id, b);
      studySeg.append(b);
    }
    const words = h('div', 'sg-pane');
    const wordsBody = h('div', 'sg-pane-body');
    const studyBody = h('div', 'sg-pane-body');
    words.append(wordsBody, studyBody);
    tabBodies.get('words').append(studySeg, words);

    // ---- Subtitles: track, timing, finding and loading subtitles
    const subsTab = tabBodies.get('subs');
    const select = h('select', 'sg-select');
    select.title = 'Subtitle track';
    select.addEventListener('change', () => {
      manualPick = select.value || null;
      const t = tracks.get(manualPick);
      if (t && t.lang && t.lang !== 'und') {
        const hostLang = Object.assign({}, settings.hostLang, { [tabHost]: t.lang });
        post({ type: 'saveSettings', patch: { hostLang } });
      }
      activeId = null;
      chooseActive();
    });
    const file = h('input');
    file.type = 'file';
    file.accept = '.srt,.vtt,.ass,.ssa,.ttml,.dfxp,.xml,.txt';
    file.style.display = 'none';
    file.addEventListener('change', () => file.files[0] && loadFile(file.files[0]));
    const fileBtn = h('button', 'sg-btn sg-ghost', 'Load a file');
    fileBtn.title = 'Use a subtitle file from your computer';
    fileBtn.addEventListener('click', () => file.click());
    const pickBtn = h('button', 'sg-btn sg-ghost', 'Read from page');
    pickBtn.title = 'Click the subtitles on the video to read them from the page';
    pickBtn.addEventListener('click', () => {
      picking = true;
      showToast('Click the subtitle text on the video. Press Escape to cancel.');
    });
    const timing = h('div', 'sg-timing');
    const early = ih('button', 'sg-btn sg-ghost', 'chevron-left', 'Earlier');
    early.title = 'Show subtitles 0.25 s earlier (key [ · Shift for 1 s)';
    const late = h('button', 'sg-btn sg-ghost', 'Later');
    late.append(SG.icon('chevron-right', { size: 16 }));
    late.title = 'Show subtitles 0.25 s later (key ] · Shift for 1 s)';
    const offset = h('button', 'sg-offset', '+0.00s');
    offset.title = 'Subtitle timing shift; click to reset (key \\)';
    offset.addEventListener('click', () => nudgeOffset(null));
    early.addEventListener('click', (e) => nudgeOffset(e.shiftKey ? -1 : -0.25));
    late.addEventListener('click', (e) => nudgeOffset(e.shiftKey ? 1 : 0.25));
    timing.append(early, offset, late);
    const sources = h('div', 'sg-row-btns');
    sources.append(fileBtn, pickBtn, file);
    const find = h('div', 'sg-pane');
    const findBody = h('div', 'sg-pane-body');
    find.append(findBody);
    const redo = h('button', 'sg-link sg-redo');
    redo.hidden = true;
    redo.title = 'These lines were broken down by an earlier version of Langtitles or another line model. They work as they are; redo them only if you want the newer breakdowns (they are bought again).';
    redo.addEventListener('click', () => {
      const t = active();
      if (!t) return;
      for (const k of t.keys) {
        const a = analyses.get(k);
        if (a && a.older) {
          analyses.delete(k);
          savedKeys.delete(k);
          redoKeys.add(k);
        }
      }
      shownKey = null;
      renderStatus();
      pump();
    });
    const songBox = h('div', 'sg-song');
    const watchOnly = h('div', 'sg-watch-only');
    const showSongsBox = h('div', 'sg-showsongs');
    const showSongsBtn = ih('button', 'sg-btn sg-ghost', 'music', ' Find this show\'s opening and ending songs', 15);
    showSongsBtn.addEventListener('click', () => openShowSongs(showSongsBox, showSongsBtn));
    showSongsBox.append(showSongsBtn);
    watchOnly.append(h('div', 'sg-section', 'Other sources'), sources, h('div', 'sg-section', 'Find subtitles for this episode'), find, h('div', 'sg-section', 'Songs in this show'), showSongsBox);
    subsTab.append(
      modeSeg, songBox,
      h('div', 'sg-section', 'Track'), select,
      h('div', 'sg-section', 'Timing'), timing,
      redo,
      watchOnly,
    );

    // ---- Display: what is shown, and how the subtitles look
    const disp = tabBodies.get('display');
    const siteBox = h('div', 'sg-site');
    disp.append(siteBox);
    const chipRow = (label) => {
      const row = h('div', 'sg-show-row');
      row.append(h('div', 'sg-section', label));
      const chips = h('div', 'sg-chiprow');
      row.append(chips);
      disp.append(row);
      return chips;
    };
    const saveNow = (patch) => {
      savePatch(patch);
      applySettings();
    };
    const showRow = chipRow('Show');
    const showChips = new Map();
    for (const a of SG.ANNOTATIONS) {
      const chip = h('button', 'sg-show-chip', a.label);
      chip.title = a.title;
      chip.addEventListener('click', () => saveNow({ [a.key]: !settings[a.key] }));
      showChips.set(a.key, chip);
      showRow.append(chip);
    }
    const forRow = chipRow('Notes above words, for');
    const classChips = new Map();
    for (const k of SG.WORD_CLASSES) {
      const chip = h('button', 'sg-show-chip', k.label);
      chip.title = k.title + ': click to give them notes above or not';
      chip.addEventListener('click', () => {
        const on = new Set(settings.glossClasses || []);
        if (on.has(k.key)) on.delete(k.key);
        else on.add(k.key);
        saveNow({ glossClasses: SG.WORD_CLASSES.map((x) => x.key).filter((x) => on.has(x)) });
      });
      classChips.set(k.key, chip);
      forRow.append(chip);
    }
    const jlptRow = chipRow('Japanese: notes from JLPT level');
    const jlptChips = new Map();
    for (const c of SG.JLPT_CHOICES) {
      const chip = h('button', 'sg-show-chip sg-radio', c.label);
      chip.title = c.title;
      chip.addEventListener('click', () => saveNow({ jlptFrom: c.value }));
      jlptChips.set(c.value, chip);
      jlptRow.append(chip);
    }

    // Look: font, size, colour, background, position, covering burned-in subtitles
    const look = {};
    const segmented = (label, key, options) => {
      const row = chipRow(label);
      const btns = new Map();
      for (const [value, text, tip] of options) {
        const b = h('button', 'sg-show-chip sg-radio', text);
        if (tip) b.title = tip;
        b.addEventListener('click', () => saveNow({ [key]: value }));
        btns.set(value, b);
        row.append(b);
      }
      look[key] = btns;
    };
    segmented('Font', 'subFont', [
      ['sans', 'Sleek', 'A clean sans-serif, like streaming services use'],
      ['rounded', 'Rounded', 'Soft rounded letters (M PLUS Rounded 1c, built in)'],
      ['serif', 'Mincho', 'Classic serif / mincho, like printed books'],
    ]);
    const colours = chipRow('Colour');
    look.subColor = new Map();
    for (const [value, name] of SG.SUB_COLOURS) {
      const sw = h('button', 'sg-swatch');
      sw.style.setProperty('--sw', value);
      sw.title = name;
      sw.addEventListener('click', () => saveNow({ subColor: value }));
      look.subColor.set(value, sw);
      colours.append(sw);
    }
    segmented('Background', 'subBg', [
      ['none', 'None', 'Outlined text only, as if part of the video'],
      ['shadow', 'Shadow', 'A soft dark glow behind the text'],
      ['box', 'Box', 'A dark rounded box behind the text'],
    ]);
    const slider = (label, key, min, max, step, fmt) => {
      const row = h('label', 'sg-slider');
      const top = h('div', 'sg-slider-top');
      const value = h('span', 'sg-slider-v');
      top.append(h('span', 'sg-section', label), value);
      const input = h('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.addEventListener('input', () => {
        settings[key] = Number(input.value);
        value.textContent = fmt(settings[key]);
        applyLook();
      });
      input.addEventListener('change', () => saveNow({ [key]: Number(input.value) }));
      for (const ev of ['keydown', 'keyup', 'keypress']) input.addEventListener(ev, (e) => e.stopPropagation());
      row.append(top, input);
      disp.append(row);
      look[key] = { input, value, fmt };
    };
    slider('Size', 'fontScale', 0.6, 1.8, 0.05, (v) => Math.round(v * 100) + '%');
    slider('Height above the bottom', 'subBottom', 0, 70, 1, (v) => v + '%');
    const coverRow = chipRow('Burned-in subtitles in the video');
    const coverBtn = h('button', 'sg-show-chip', 'Cover them');
    coverBtn.title = 'Blur and darken a band over subtitles that are part of the video picture, such as English, and show yours on top';
    coverBtn.addEventListener('click', () => saveNow({ coverHardsubs: !settings.coverHardsubs, subBottom: !settings.coverHardsubs ? Math.max(0, (settings.coverBottom == null ? SG.DEFAULTS.coverBottom : settings.coverBottom) + 1) : settings.subBottom }));
    coverRow.append(coverBtn);
    look.coverBtn = coverBtn;
    slider('Cover: height', 'coverHeight', 4, 40, 1, (v) => v + '%');
    slider('Cover: height above the bottom', 'coverBottom', 0, 60, 1, (v) => v + '%');
    disp.append(h('div', 'sg-note', 'Tip: drag the subtitles up or down by the ⋮⋮ grip that appears when you point at them.'));
    // Every keyboard shortcut, for reference.
    disp.append(h('div', 'sg-section', 'Keyboard shortcuts'));
    const keys = h('div', 'sg-keys');
    for (const [k, what] of [
      ['G', 'Open or close this panel'], ['H', 'Subtitles on or off'], ['R', 'Furigana / pinyin on or off'],
      ['A / D', 'Previous / next line'], ['S', 'Replay the line slowed down'], ['L', 'Loop the line (again to stop)'],
      ['[ / ]', 'Subtitles 0.25 s earlier / later (Shift: 1 s)'], ['\\', 'Reset the timing'], ['Esc', 'Close a full-screen guide'],
      ['Alt+Shift+L', 'Turn Langtitles off everywhere, or on again'],
    ]) {
      keys.append(h('kbd', 'sg-key', k), h('span', 'sg-key-what', what));
    }
    disp.append(keys);

    el.append(head, tabBar, ...tabBodies.values());
    setTab('line');
    return {
      modeSeg, modeBtns, songBox, redo, el, status, select, offset, hint, showChips, hideBtn, loopBtn, siteBox, classChips, jlptChips, look, setTab,
      find, findBody, words, wordsBody, studyBody, studyBtns, guide, guideTitle, guideBody, detail, list, rows: new Map(),
    };
  }

  // The part of the video you can actually see: some players (YouTube) make the video element larger than
  // the player box and clip it, so the overlay follows the clipped box. Clipping ancestors are found every
  // couple of seconds, not on every frame.
  let clipFor = null;
  let clipList = [];
  let clipAt = 0;
  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    if (clipFor !== el || Date.now() - clipAt > 2000) {
      clipFor = el;
      clipAt = Date.now();
      clipList = [];
      let p = el.parentElement;
      for (let i = 0; p && i < 10; i++, p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clipList.push(p);
      }
    }
    let left = r.left;
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    for (const c of clipList) {
      const b = c.getBoundingClientRect();
      if (b.width < 200 || b.height < 110) continue;
      left = Math.max(left, b.left);
      top = Math.max(top, b.top);
      right = Math.min(right, b.right);
      bottom = Math.min(bottom, b.bottom);
    }
    if (!document.fullscreenElement) {
      top = Math.max(top, 0);
      bottom = Math.min(bottom, innerHeight);
    }
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  // Keep the overlay glued to the video, including in fullscreen.
  function place() {
    if (!ui || !video) return;
    const fs = document.fullscreenElement;
    if (topLayer) {
      // In the browser's top layer the page cannot cover the overlay, whatever it stacks on top.
      if (ui.host.parentNode !== document.documentElement) document.documentElement.appendChild(ui.host);
      if (!ui.host.matches(':popover-open')) {
        try {
          ui.host.showPopover();
        } catch (e) {
          /* not connected yet */
        }
      }
    } else {
      const parent = fs && fs !== video && fs.contains(video) ? fs : document.documentElement;
      if (ui.host.parentNode !== parent) parent.appendChild(ui.host);
    }
    if (topLayer && fs && Date.now() - lastRaiseCheck > 1000) {
      lastRaiseCheck = Date.now();
      const tb = ui.toggle.getBoundingClientRect();
      const hit = tb.width ? document.elementFromPoint(tb.left + tb.width / 2, tb.top + tb.height / 2) : null;
      if (hit && hit !== ui.host && !ui.host.contains(hit) && ui.host.matches(':popover-open')) {
        ui.host.hidePopover();
        try {
          ui.host.showPopover();
        } catch (e) {
          /* shown again on the next tick */
        }
      }
    }
    let r = visibleRect(video);
    let visible = r.width >= 200 && r.height >= 110 && video.isConnected;
    // On a music site (or when the song has no picture to draw on) the lyrics get their own sheet.
    const listen = listenMode();
    const sheet = listen && Boolean(SG.listen) && (SG.listen.musicSite() || !visible) && !fs;
    ui.root.classList.toggle('lt-listen', listen);
    ui.root.classList.toggle('lt-sheet', sheet);
    for (const size of ['strip', 'sheet', 'focus']) ui.root.classList.toggle('lt-size-' + size, sheet && (settings.lyricsSize || 'sheet') === size);
    if (sheet) {
      r = sheetRect();
      visible = Boolean(active() || listenNp);
    }
    const s = ui.host.style;
    s.display = visible && enabled() ? 'block' : 'none';
    if (!visible) return;
    s.left = r.left + 'px';
    s.top = r.top + 'px';
    s.width = r.width + 'px';
    s.height = r.height + 'px';
    const base = sheet ? ({ strip: 24, focus: 38 }[settings.lyricsSize] || 28) : Math.max(14, Math.min(38, r.height / 24));
    const size = base * (settings.fontScale || 1);
    s.fontSize = size.toFixed(1) + 'px';
  }

  function applySettings() {
    if (!ui) return;
    const c = ui.root.classList;
    c.toggle('sg-panel-open', Boolean(settings.panelOpen));
    c.toggle('sg-no-parts', !settings.showParts);
    c.toggle('sg-no-mean', !settings.showMeaning);
    c.toggle('sg-no-roles', !settings.showRoles);
    c.toggle('sg-no-phrases', !settings.phraseBrackets);
    c.toggle('sg-no-tr', !settings.showTranslation);
    c.toggle('sg-hidden', overlayHidden);
    ui.panel.hideBtn.classList.toggle('sg-on', !overlayHidden);
    ui.panel.hideBtn.setAttribute('aria-pressed', String(!overlayHidden));
    applyLook();
    const listening = listenMode();
    for (const [m, b] of Object.entries(ui.panel.modeBtns)) b.classList.toggle('sg-on', (m === 'listen') === listening);
    // Only where Listen mode makes sense (music sites, YouTube, or once it's been switched on here).
    ui.panel.modeSeg.hidden = !(SG.listen && (SG.listen.kind() || listening));
    const subsTabBtn = ui.panel.el.querySelector('.sg-tab[title="Subtitles"], .sg-tab[title="Song"]');
    if (subsTabBtn) {
      subsTabBtn.title = listening ? 'Song' : 'Subtitles';
      subsTabBtn.querySelector('.sg-tab-long').textContent = listening ? 'Song' : 'Subtitles';
      subsTabBtn.querySelector('.sg-tab-short').textContent = listening ? 'Song' : 'Subs';
    }
    ui.root.classList.toggle('lt-singalong', listening && Boolean(settings.singAlong));
    ui.root.classList.toggle('lt-gaps', listening && Boolean(settings.lyricGaps));
    const nowLang = active() ? langCode(active().lang) : null;
    for (const [key, chip] of ui.panel.showChips) {
      chip.classList.toggle('sg-on', Boolean(settings[key]));
      const only = (SG.ANNOTATIONS.find((x) => x.key === key) || {}).lang;
      // Furigana, pinyin and hanja only matter for their own language.
      chip.hidden = Boolean(only && nowLang && only !== nowLang);
    }
    for (const [key, chip] of ui.panel.classChips) chip.classList.toggle('sg-on', (settings.glossClasses || []).includes(key));
    for (const [value, chip] of ui.panel.jlptChips) chip.classList.toggle('sg-on', (settings.jlptFrom || 5) === value);
    place();
    applyHideNative();
    renderTrackList();
    shownKey = null;
    tick();
    pump();
  }

  // Font, colour, background, position and the burned-in subtitle cover, from settings.
  function applyLook() {
    if (!ui) return;
    const r = ui.root;
    for (const f of ['sans', 'rounded', 'serif']) r.classList.toggle('lt-font-' + f, (settings.subFont || 'sans') === f);
    for (const b of ['none', 'shadow', 'box']) r.classList.toggle('lt-bg-' + b, (settings.subBg || 'none') === b);
    r.style.setProperty('--lt-sub-color', settings.subColor || '#ffffff');
    const following = settings.followHardsubs && hardsubLift != null;
    r.style.setProperty('--lt-sub-bottom', (following ? hardsubLift : settings.subBottom == null ? 8 : settings.subBottom) + '%');
    r.classList.toggle('lt-following', Boolean(settings.followHardsubs));
    r.style.setProperty('--lt-cover-bottom', (settings.coverBottom == null ? SG.DEFAULTS.coverBottom : settings.coverBottom) + '%');
    r.style.setProperty('--lt-cover-height', (settings.coverHeight == null ? SG.DEFAULTS.coverHeight : settings.coverHeight) + '%');
    const peek = Boolean(settings.followHardsubs && settings.peekHardsubs && hardsubBand);
    if (peek) {
      r.style.setProperty('--lt-cover-bottom', hardsubBand[0] + '%');
      r.style.setProperty('--lt-cover-height', hardsubBand[1] + '%');
    }
    r.classList.toggle('lt-cover', Boolean(settings.coverHardsubs) || peek);
    r.classList.toggle('lt-peek', peek);
    const L = ui.panel.look;
    for (const key of ['subFont', 'subBg', 'subColor']) {
      for (const [value, b] of L[key]) b.classList.toggle('sg-on', (settings[key] || SG.DEFAULTS[key]) === value);
    }
    for (const key of ['fontScale', 'subBottom', 'coverHeight', 'coverBottom']) {
      const c = L[key];
      const v = settings[key] == null ? SG.DEFAULTS[key] : settings[key];
      if (document.activeElement !== c.input) c.input.value = String(v);
      c.value.textContent = c.fmt(Number(v));
    }
    renderSiteBox();
    L.coverBtn.classList.toggle('sg-on', Boolean(settings.coverHardsubs));
    L.coverBtn.textContent = settings.coverHardsubs ? 'Covered' : 'Cover them';
    place();
  }

  // The Display tab's card for sites whose videos have subtitles burned into the picture.
  let siteBoxState = '';
  function renderSiteBox() {
    const box = ui.panel.siteBox;
    const site = siteLook();
    const state = [tabHost, Boolean(site), settings.followHardsubs, settings.peekHardsubs, hardsubBroken, hardsubLift != null].join('|');
    if (state === siteBoxState) return;
    siteBoxState = state;
    box.textContent = '';
    const host = tabHost || 'this site';
    if (!site) {
      box.classList.remove('sg-on');
      box.append(h('div', 'sg-site-t', 'Video has English subtitles burned in?'));
      box.append(h('div', 'sg-site-d', `Show the Japanese right above them, as one pair of subtitles. Langtitles finds the burned-in lines and moves with them, and ${host} gets its own layout (your other sites stay as they are).`));
      const go = h('button', 'sg-btn sg-go', 'Show above burned-in subtitles');
      go.addEventListener('click', () => {
        setSiteLook({ followHardsubs: true, showTranslation: false, subColor: '#ffe14d', subBg: 'none', coverHardsubs: false, subBottom: 23 });
        showToast(`Langtitles will sit above the burned-in subtitles on ${host}.`);
      });
      box.append(go);
      return;
    }
    box.classList.add('sg-on');
    box.append(h('div', 'sg-site-t', `Own layout for ${host}`));
    let how;
    if (!settings.followHardsubs) how = 'Changes on the Display tab apply to this site only.';
    else if (hardsubBroken) how = "This site's video picture can't be read, so the position is fixed: drag the ⋮⋮ grip to just above the burned-in subtitles.";
    else if (hardsubLift != null) how = 'Following the burned-in subtitles: yours sit just above them.';
    else how = 'Looking for burned-in subtitles… (while none are found, yours sit at the height set below)';
    box.append(h('div', 'sg-site-d', how));
    const row = h('div', 'sg-row-btns');
    const follow = h('button', 'sg-show-chip' + (settings.followHardsubs ? ' sg-on' : ''), 'Follow burned-in subtitles');
    follow.title = 'Find the subtitles in the picture and keep yours just above them';
    follow.addEventListener('click', () => {
      savePatch({ followHardsubs: !settings.followHardsubs });
      hardsubSeen = [];
      hardsubLift = null;
      applySettings();
    });
    const reset = h('button', 'sg-btn sg-ghost', 'Back to my normal layout');
    reset.addEventListener('click', () => {
      hardsubSeen = [];
      hardsubLift = null;
      setSiteLook(null);
    });
    const peek = h('button', 'sg-show-chip' + (settings.peekHardsubs ? ' sg-on' : ''), 'Blur English until I point at it');
    peek.title = 'Read the Japanese first; point at the blurred band to see the English';
    peek.addEventListener('click', () => {
      savePatch({ peekHardsubs: !settings.peekHardsubs, followHardsubs: true });
      applySettings();
    });
    if (settings.followHardsubs && !hardsubBroken) row.append(peek);
    row.append(follow, reset);
    box.append(row);
  }

  // ---- following subtitles burned into the picture
  let hardsubLift = null; // where Langtitles' subtitles sit, in % of the video box from the bottom
  let hardsubSeen = []; // recent detections: { at, top } (top in % of the box)
  let hardsubAt = 0;
  let hardsubBroken = false;
  let hardsubCanvas = null;
  let hardsubBand = null;
  let hardsubBandKey = '';
  function followHardsubs() {
    if (!settings.followHardsubs || !video || hardsubBroken || !enabled()) return;
    const now = Date.now();
    if (now - hardsubAt < 400 || (video.paused && hardsubLift != null)) return;
    hardsubAt = now;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return;
    const w = 384;
    const hgt = Math.max(1, Math.round((w * vh) / vw));
    if (!hardsubCanvas) hardsubCanvas = document.createElement('canvas');
    if (hardsubCanvas.width !== w || hardsubCanvas.height !== hgt) {
      hardsubCanvas.width = w;
      hardsubCanvas.height = hgt;
    }
    let data;
    try {
      const ctx = hardsubCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, hgt);
      data = ctx.getImageData(0, 0, w, hgt).data;
    } catch (e) {
      // The video comes from another site without permission to read it, or is copy-protected.
      hardsubBroken = true;
      applySettings();
      return;
    }
    const hit = SG.hardsubs.find(data, w, hgt);
    const box = video.getBoundingClientRect();
    if (hit && box.height) {
      const pic = SG.hardsubs.pictureBox(box.width, box.height, vw, vh);
      hardsubSeen.push({ at: now, top: ((pic.top + hit.top * pic.height) / box.height) * 100, bottom: ((pic.top + hit.bottom * pic.height) / box.height) * 100 });
    }
    hardsubSeen = hardsubSeen.filter((x) => now - x.at < 30000);
    // The highest position seen recently that was seen at least twice: two-line subtitles set the
    // height, so yours don't jump up and down with every line, and one stray detection is ignored.
    const tops = hardsubSeen.map((x) => x.top).sort((a, b) => b - a);
    let lift = null;
    for (const t of tops) {
      if (tops.filter((u) => Math.abs(u - t) < 2).length >= 2) {
        lift = Math.min(60, Math.round((t + 1.5) * 2) / 2);
        break;
      }
    }
    if (lift == null && hardsubLift != null && hardsubSeen.length) lift = hardsubLift;
    // The band that hides the English until you point at it covers everything seen recently.
    const low = hardsubSeen.length ? Math.max(0, Math.min(...hardsubSeen.map((x) => x.bottom)) - 1) : null;
    const band = lift != null && low != null ? [low, lift - 0.5 - low] : null;
    const bandKey = band ? band.map((n) => n.toFixed(1)).join() : '';
    if (lift !== hardsubLift || bandKey !== hardsubBandKey) {
      hardsubLift = lift;
      hardsubBand = band;
      hardsubBandKey = bandKey;
      applyLook();
    }
  }

  function applyHideNative() {
    const hide = Boolean(active()) && enabled() && settings.hideNative && !overlayHidden;
    document.documentElement.classList.toggle('langtitles-hide-native', hide);
    if (domEl) domEl.classList.toggle('langtitles-native-caption', hide);
  }

  function setPanel(open) {
    settings.panelOpen = open;
    post({ type: 'saveSettings', patch: { panelOpen: open } });
    ui.root.classList.toggle('sg-panel-open', open);
    if (open) {
      renderTranscript();
      shownKey = null;
      tick();
    }
  }

  // A short note that shows even while the overlay is hidden.
  function flashNote(text) {
    const note = document.createElement('div');
    note.textContent = text;
    note.setAttribute('style', 'all:initial;position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:rgba(16,17,22,.94);color:#f4f4f6;font:14px system-ui,sans-serif;pointer-events:none;');
    if (typeof note.showPopover === 'function') note.setAttribute('popover', 'manual');
    document.documentElement.append(note);
    try {
      if (note.showPopover) note.showPopover();
    } catch (e) {
      /* shown as a plain fixed element */
    }
    setTimeout(() => note.remove(), 2200);
  }

  let toastTimer = null;
  function showToast(text) {
    if (!ui) return;
    ui.toast.textContent = text;
    ui.toast.classList.add('sg-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('sg-show'), 6000);
  }

  let toggleTimer = null;
  function onMouseMove(e) {
    if (!ui || !video) return;
    const r = video.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    ui.toggle.classList.add('sg-show');
    clearTimeout(toggleTimer);
    toggleTimer = setTimeout(() => ui.toggle.classList.remove('sg-show'), 2500);
  }

  function renderTrackList() {
    if (!ui) return;
    const { select, hint } = ui.panel;
    select.textContent = '';
    if (!tracks.size) select.append(new Option('No subtitles found yet', ''));
    for (const t of tracks.values()) {
      const kind = { net: '', texttrack: '', dom: ' (read from page)', file: ' (file)', remote: ' (downloaded)' }[t.source] || '';
      const opt = new Option(`${langName(t.lang)} · ${t.label}${kind} · ${t.cues.length} lines`, t.id);
      opt.selected = t.id === activeId;
      select.append(opt);
    }
    const native = langCode(settings.nativeLang);
    let text = '';
    if (!settings.hasKey) text = 'Add your Anthropic API key in the Langtitles options to get breakdowns.';
    else if (!tracks.size && SG.listen && SG.listen.kind() === 'youtube' && !listenMode() && video && (SG.listen.nowPlaying(video) || {}).isSong) text = 'listen-offer';
    else if (!tracks.size) text = 'Turn on subtitles in the player. Langtitles picks them up as the site loads them. If nothing appears, use “Pick on page” or “Load file”.';
    else if (!activeId) text = `The subtitles found are in ${langName(native)}. Choose a subtitle track in the language you are learning in the site’s player, or pick one above to analyze it anyway.`;
    if (text === 'listen-offer') {
      // A song on YouTube with no subtitles: offer its lyrics instead.
      hint.textContent = '';
      const go = h('button', 'sg-btn sg-go', 'Show the lyrics (Listen mode)');
      go.addEventListener('click', () => setMode('listen'));
      hint.append(h('div', '', 'This looks like a song. Langtitles can show its lyrics, broken down like subtitles.'), go);
    } else hint.textContent = text;
    hint.style.display = text ? 'block' : 'none';
    const t = active();
    if (t) ui.panel.offset.textContent = (t.offset >= 0 ? '+' : '') + t.offset.toFixed(2) + 's';
  }

  function renderStatus() {
    if (!ui) return;
    const t = active();
    if (!t) {
      ui.panel.status.textContent = '';
      return;
    }
    let ready = 0;
    let fromSaved = 0;
    let older = 0;
    for (const k of t.keys) {
      const a = analyses.get(k);
      if (!a) continue;
      ready++;
      if (savedKeys.has(k)) fromSaved++;
      if (a.older) older++;
    }
    const cov = coverage.get(t.id);
    if (ui.panel.redo) {
      ui.panel.redo.hidden = !older || !settings.hasKey;
      ui.panel.redo.textContent = `Redo ${older} line${older === 1 ? '' : 's'} made with an older version`;
    }
    ui.panel.status.textContent = `${ready}/${t.cues.length} lines ready${fromSaved ? ` (${fromSaved} saved)` : ''}${inflight ? ' · working' : ''}${cov ? ` · ${cov.pct}% known` : ''} · this episode ${episodeCost > 0 && episodeCost < 0.005 ? 'under $0.01' : '$' + episodeCost.toFixed(2)}`;
    ui.panel.status.title = 'Estimated cost of Claude requests for this video so far, from list prices';
  }

  // ------------------------------------------------------------ subtitle box

  // Lay the model's words back onto the original line so punctuation and spacing survive.
  function alignWords(text, words) {
    const out = [];
    let pos = 0;
    const lower = text.toLowerCase();
    for (const w of words) {
      if (!w || !w.s) continue;
      let at = text.indexOf(w.s, pos);
      if (at === -1) at = lower.indexOf(w.s.toLowerCase(), pos);
      if (at === -1) {
        out.push({ word: w });
        continue;
      }
      if (at > pos) out.push({ gap: text.slice(pos, at) });
      out.push({ word: w });
      pos = at + w.s.length;
    }
    if (pos < text.length) out.push({ gap: text.slice(pos) });
    return out;
  }

  function sameText(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function buildToken(w, index, firstOfPhrase, ctx) {
    const level = ctx.lang === 'ja' ? SG.jlptLevel(jlptData, w) : null;
    const plain = (settings.hideKnownGlosses && wordKnown(w, ctx.lang))
      || !(settings.glossClasses || []).includes(SG.wordClass(w.pos))
      || (level != null && level > (settings.jlptFrom || 5));
    const tok = h('span', 'sg-tok sg-role-' + (w.role || 'other') + (isNewWord(w, ctx.lang) ? ' sg-new' : '') + (plain ? ' sg-kw-known' : ''));
    const parts = Array.isArray(w.p) && w.p.length ? w.p : [{ t: w.s, g: w.m }];
    const multi = parts.length > 1;

    tok.append(h('span', 'sg-mean', w.m || ''));

    const partsEl = h('span', 'sg-parts');
    if (multi || !sameText(parts[0].g, w.m)) {
      parts.forEach((p, i) => {
        if (i) partsEl.append(h('span', 'sg-plus', '+'));
        partsEl.append(h('span', multi ? 'sg-part sg-c' + (i % 5) : 'sg-part', p.g || ''));
      });
    }
    tok.append(partsEl);

    tok.append(buildSurface(w, ctx.lang, multi && parts.map((p) => p.t).join('') === w.s ? parts : null), h('span', 'sg-bar'));
    tok.append(h('span', 'sg-role', firstOfPhrase ? ROLE_LABELS[w.role] || '' : ''));

    tok.addEventListener('mouseenter', () => onTokenEnter(tok, w, index, ctx));
    tok.addEventListener('click', () => onTokenEnter(tok, w, index, ctx));
    return tok;
  }

  function readingsOn(lang) {
    if (lang === 'ja') return Boolean(settings.furigana);
    if (lang === 'zh') return Boolean(settings.pinyin);
    if (lang === 'ko') return Boolean(settings.hanja);
    return false;
  }

  function knownFor(lang) {
    if (lang === 'ja') return known.ja;
    if (lang === 'zh') return settings.hideKnownPinyin ? known.zh : null;
    return null;
  }

  // The word itself, with each piece coloured to match its gloss and furigana or pinyin
  // as ruby text over the characters that need it.
  function buildSurface(w, lang, parts) {
    const surf = h('span', 'sg-surf');
    const pieceAt = [];
    if (parts) parts.forEach((p, i) => { for (let k = 0; k < p.t.length; k++) pieceAt.push(i); });
    const text = (str, from) => {
      if (!parts) return document.createTextNode(str);
      const frag = document.createDocumentFragment();
      let pos = from;
      let cur = null;
      for (const ch of Array.from(str)) {
        const piece = pieceAt[pos] == null ? 0 : pieceAt[pos];
        if (!cur || cur.dataset.piece !== String(piece)) {
          cur = h('span', 'sg-seg sg-c' + (piece % 5));
          cur.dataset.piece = String(piece);
          frag.append(cur);
        }
        cur.textContent += ch;
        pos += ch.length;
      }
      return frag;
    };
    const segs = readingsOn(lang) ? SG.ruby.segmentsFor(w, lang) : null;
    if (!segs) {
      surf.append(text(w.s, 0));
      return surf;
    }
    const knownSet = knownFor(lang);
    let pos = 0;
    for (const seg of segs) {
      if (SG.ruby.showReading(seg, knownSet)) {
        const ruby = h('ruby', 'sg-ruby');
        const rt = h('rt', lang === 'zh' && settings.toneColors ? 'sg-tone' + SG.ruby.toneOf(seg.r) : lang === 'ko' ? 'sg-hanja' : '', seg.r);
        ruby.append(text(seg.t, pos), rt);
        surf.append(ruby);
      } else {
        surf.append(text(seg.t, pos));
      }
      pos += seg.t.length;
    }
    return surf;
  }

  function buildGap(text) {
    const trimmed = text.trim();
    const gap = h('span', trimmed ? 'sg-gap' : 'sg-gap sg-space');
    gap.append(h('span', 'sg-surf', trimmed || ' '), h('span', 'sg-bar'), h('span', 'sg-role', ''));
    return gap;
  }

  function renderLine(cue, key) {
    const a = analyses.get(key);
    const { line, tr, sub } = ui;
    hidePop();
    line.textContent = '';
    line.classList.toggle('sg-plain', !a || !a.w || !a.w.length);
    if (a && a.w && a.w.length) {
      line.lang = a.lang || '';
      let lastPhrase = null;
      const t = active();
      const ctx = { key, sentence: cue.text, translation: a.tr, lang: langCode(a.lang), time: cue.start + (t ? t.offset : 0) };
      let index = 0;
      // Phrases whose words sit next to each other are wrapped, with one meaning over the whole span.
      const spans = phraseSpans(a);
      let group = null;
      let groupEnd = -1;
      for (const item of alignWords(cue.text, a.w)) {
        if (item.gap != null) {
          (group && index <= groupEnd ? group.row : line).append(buildGap(item.gap));
          continue;
        }
        const w = item.word;
        const i = index++;
        const sp = spans.byStart.get(i);
        if (sp) {
          group = buildPhraseBox(sp, ctx);
          groupEnd = sp.to;
          line.append(group.el);
        }
        const tok = buildToken(w, i, w.c !== lastPhrase, ctx);
        const linked = spans.patternOf.get(i);
        if (linked) {
          tok.dataset.pat = linked.id;
          tok.addEventListener('mouseenter', () => highlightPattern(linked.id, true));
          tok.addEventListener('mouseleave', () => highlightPattern(linked.id, false));
        }
        (group && i <= groupEnd ? group.row : line).append(tok);
        if (group && i >= groupEnd) group = null;
        lastPhrase = w.c;
      }
      tr.textContent = a.tr || '';
    } else {
      line.removeAttribute('lang');
      line.append(h('span', 'sg-raw', cue.text));
      if (requested.has(key)) line.append(h('span', 'sg-dots', '···'));
      tr.textContent = '';
    }
    tr.style.display = tr.textContent ? '' : 'none';
    sub.classList.add('sg-show');
    renderDetail(cue, a);
  }

  // Contiguous phrases (by first word index) and the words of split patterns.
  function phraseSpans(a) {
    const byStart = new Map();
    const patternOf = new Map();
    const taken = new Set();
    const list = (Array.isArray(a.phrases) ? a.phrases : []).filter((p) => p && Array.isArray(p.w) && p.w.length >= 2);
    list.forEach((p, n) => {
      const idx = p.w.slice().sort((x, y) => x - y);
      const contiguous = idx.every((v, j) => j === 0 || v === idx[j - 1] + 1);
      if (contiguous && !idx.some((v) => taken.has(v))) {
        idx.forEach((v) => taken.add(v));
        byStart.set(idx[0], Object.assign({ from: idx[0], to: idx[idx.length - 1], n }, p));
      } else if (!contiguous) {
        for (const v of idx) patternOf.set(v, { id: 'p' + n, phrase: p });
      }
    });
    return { byStart, patternOf };
  }

  function buildPhraseBox(sp, ctx) {
    const el = h('span', 'sg-phr sg-phr-' + String(sp.kind || '').replace(/\s+/g, '-'));
    const m = h('span', 'sg-phr-m', sp.m || '');
    m.title = (sp.d || '') + (sp.m ? ' — ' + sp.m : '');
    const row = h('span', 'sg-phr-row');
    el.append(m, row);
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      openPhraseCard(sp, ctx, el);
    });
    return { el, row };
  }

  function highlightPattern(id, on) {
    if (!ui) return;
    for (const t of ui.line.querySelectorAll(`[data-pat="${id}"]`)) t.classList.toggle('sg-pat-on', on);
  }

  function clearLine() {
    if (!ui) return;
    ui.sub.classList.remove('sg-show');
    hidePop();
  }

  // The main loop: decide which line is on screen and draw it when that changes.
  let lyrIdx = -2;
  const savedReqs = new Set();
  const savedKeys = new Set(); // lines whose breakdown came from what's saved
  const preloaded = new Set(); // track ids already asked for their saved breakdowns
  const redoKeys = new Set(); // lines being redone with the current version
  function tick() {
    if (!ui || !video) return;
    readDomCaption();
    followHardsubs();
    const t = active();
    if (!t || !enabled() || overlayHidden) {
      if (shownKey !== null) clearLine();
      shownKey = null;
      shownIndex = -1;
      return;
    }
    const now = video.currentTime - t.offset;
    studyChecks(t, now);
    let idx = findCue(t.cues, now);
    // Captions read from the page disappear when the page clears them, not at a guessed end time.
    if (t.source === 'dom' && !domText && !video.paused) idx = -1;
    if (t.source === 'lyrics' && idx !== lyrIdx) {
      lyrIdx = idx;
      paintLyricsAround(t, idx, now);
    }
    if (t.source === 'lyrics' && idx >= 0 && t.cues[idx].words) paintSung(t.cues[idx], now);
    if (idx === -1) {
      // Stay on the line while the viewer is studying it.
      if (popFor || (autoPaused && video.paused)) return;
      if (shownKey !== null) clearLine();
      shownKey = null;
      shownIndex = -1;
      highlightRow(-1);
      return;
    }
    const key = t.keys[idx];
    const analyzed = analyses.has(key);
    if (key !== shownKey || analyzed !== shownAnalyzed || idx !== shownIndex) {
      // Do not rebuild the line under the pointer just because the analysis state did not change.
      shownKey = key;
      shownAnalyzed = analyzed;
      shownIndex = idx;
      renderLine(t.cues[idx], key);
      highlightRow(idx);
      const a = analyses.get(key);
      lineNew = a ? { key, idx, words: newWordsIn(a) } : null;
    }
  }

  // ------------------------------------------------------------------ hover

  function cancelLeave() {
    clearTimeout(leaveTimer);
  }

  function scheduleLeave() {
    clearTimeout(leaveTimer);
    if (touchMode) return;
    leaveTimer = setTimeout(() => {
      hidePop();
      if (autoPaused && settings.resumeOnLeave && video && video.paused) {
        const p = video.play();
        if (p && p.catch) p.catch(() => {});
      }
      autoPaused = false;
    }, 280);
  }

  function hidePop() {
    if (!ui) return;
    clearTimeout(deepTimer);
    clearTimeout(hoverTimer);
    popFor = null;
    ui.pop.classList.remove('sg-show');
    const cur = ui.line.querySelector('.sg-on');
    if (cur) cur.classList.remove('sg-on');
  }

  function onTokenEnter(tok, w, index, ctx) {
    cancelLeave();
    if (popFor === tok) return;
    if (settings.hoverPause && video && !video.paused) {
      video.pause();
      autoPaused = true;
    }
    hidePop();
    popFor = tok;
    tok.classList.add('sg-on');
    const pop = ui.pop;
    pop.textContent = '';
    pop.classList.remove('sg-wide');
    if (touchMode) {
      const close = ih('button', 'sg-pop-close', 'x', '', 18);
      close.title = 'Close and keep watching';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        hidePop();
        if (autoPaused && video && video.paused) {
          const pr = video.play();
          if (pr && pr.catch) pr.catch(() => {});
        }
        autoPaused = false;
      });
      pop.append(close);
    }

    const head = h('div', 'sg-pop-head');
    head.append(h('span', 'sg-pop-word', w.s));
    if (w.r && !sameText(w.r, w.s)) head.append(h('span', 'sg-pop-read', w.r));
    const lvl = ctx.lang === 'ja' ? SG.jlptLevel(jlptData, w) : null;
    if (lvl != null) {
      const badge = h('span', 'sg-jlpt', 'N' + lvl);
      badge.title = `JLPT N${lvl} (Waller's lists)`;
      head.append(badge);
    }
    head.append(speakButton(w.s, ctx.lang), knownWordButton(w, ctx.lang), starButton('word', ctx.lang, w.d || w.s, () => wordItem(w, ctx)));
    pop.append(head);
    const meta = [w.pos, w.d && !sameText(w.d, w.s) ? 'dictionary form: ' + w.d : ''].filter(Boolean).join(' · ');
    if (meta) pop.append(h('div', 'sg-pop-meta', meta));
    if (ctx.lang === 'ja' && settings.pitchAccent) pop.append(pitchBlock(w));
    pop.append(h('div', 'sg-pop-mean', w.m || ''));
    // The built-in dictionary's entry, instantly (JMdict, Wiktionary for Korean, CC-CEDICT for Chinese).
    if ((ctx.lang === 'ja' || ctx.lang === 'ko' || ctx.lang === 'zh') && SG.wordClass(w.pos) !== 'name') {
      const dictBox = h('div', 'sg-pop-dict');
      pop.append(dictBox);
      request({ type: 'dictCard', lang: ctx.lang, s: w.s, d: w.d }).then((res) => {
        const card = res && res.card;
        if (!card || !dictBox.isConnected) return;
        for (const e of card.entries.slice(0, 1)) {
          const top = h('div', 'sg-dict-head');
          const head = h('span', 'sg-dict-w', e.head);
          head.lang = ctx.lang;
          top.append(head);
          if (e.read) top.append(h('span', 'sg-dict-r', e.read));
          if (e.common) top.append(h('span', 'sg-jlpt', 'common'));
          top.append(h('span', 'sg-dict-src', card.source));
          dictBox.append(top);
          dictBox.title = 'Dictionary entry: click for more senses';
          dictBox.addEventListener('click', () => {
            dictBox.classList.toggle('sg-open');
            placePop(tok);
          });
          e.senses.slice(0, 3).forEach((x, i) => {
            const li = h('div', 'sg-dict-s');
            li.append(h('span', 'sg-dict-n', String(i + 1)), document.createTextNode(x[1]));
            if (x[0]) li.append(h('span', 'sg-dict-pos', x[0]));
            dictBox.append(li);
          });
        }
        placePop(tok);
      });
    }

    const parts = Array.isArray(w.p) ? w.p : [];
    if (parts.length > 1 || (parts.length === 1 && !sameText(parts[0].g, w.m))) {
      const table = h('div', 'sg-pop-parts');
      parts.forEach((p, i) => {
        const row = h('div', 'sg-pop-row');
        row.append(h('span', 'sg-pop-t sg-c' + (i % 5), p.t), h('span', 'sg-pop-g', p.g));
        table.append(row);
      });
      pop.append(table);
    }
    if (Array.isArray(w.b) && w.b.length > 1) {
      const chain = h('div', 'sg-build');
      w.b.forEach((step, i) => {
        if (i) chain.append(h('span', 'sg-build-arrow', '→'));
        const one = h('span', 'sg-build-step');
        const form = h('span', 'sg-build-t', step.t);
        form.lang = ctx.lang;
        one.append(form, h('span', 'sg-build-m', step.m));
        chain.append(one);
      });
      pop.append(chain);
    }
    if (w.n) pop.append(h('div', 'sg-pop-note', w.n));

    const forms = formsOf(w);
    const deep = h('div', 'sg-pop-deep');
    // Guides: one for the word itself (what it means, how it's built, where it fits and
    // where it doesn't), and one for each grammar form it carries.
    const fn = isFunctionWord(w);
    const wordForm = fn ? functionWordForm(w, ctx.lang) : wordGuideForm(w, ctx.lang);
    // Names and places get their short meaning, not a whole guide.
    const isName = SG.wordClass(w.pos) === 'name';
    const own = (isTrivial(w) && forms.length) || isName || (fn && forms.length) ? [] : [{ f: wordForm, word: !fn }];
    // Phrases this word is part of come first: their meaning belongs to the whole.
    const inPhrases = phrasesWith(ctx, index);
    for (const p of inPhrases) {
      const box = h('div', 'sg-pop-phrase');
      box.append(h('span', 'sg-pop-forms-label', 'Part of'));
      const name = h('button', 'sg-form sg-form-word', p.d);
      name.title = 'Open the card for the whole phrase';
      name.addEventListener('click', () => openPhraseCard(p, ctx, tok));
      box.append(name, h('span', 'sg-pop-phrase-m', p.m || ''));
      pop.append(box);
    }
    const phraseGuides = inPhrases.map((p) => {
      const f = phraseGuideForm(p, ctx.lang);
      return { f, word: !f.grammar, phrase: p };
    });
    const guides = phraseGuides.concat(own, forms.map((f) => ({ f, word: false })));
    const firstGuide = phraseGuides[0] || (forms.length ? guides.find((g) => !g.word) : guides[0]);
    let currentGuide = firstGuide;
    const openG = (g) => {
      if (g.phrase && g.word) showPhraseGuide(deep, g.phrase, ctx);
      else if (g.phrase) showGuide(deep, g.f, ctx, phraseAsWord(g.phrase));
      else if (g.word) showWordGuide(deep, w, ctx);
      else showGuide(deep, g.f, ctx, w);
    };
    if (guides.length) {
      const row = h('div', 'sg-pop-forms');
      row.append(h('span', 'sg-pop-forms-label', 'Guides'));
      for (const g of guides) {
        const label = g.phrase ? g.phrase.d : g.word ? w.d || w.s : g.f.name || g.f.k;
        const chip = g.word ? ih('button', 'sg-form sg-form-word' + (g === firstGuide ? ' sg-on' : ''), 'book-open', label, 13) : h('button', 'sg-form' + (g === firstGuide ? ' sg-on' : ''), label);
        chip.title = g.phrase ? 'Guide to the whole phrase' : g.word ? 'Everything about this word: meanings, how it is built, where it fits and where it does not' : 'Full guide to this grammar form';
        chip.dataset.k = g.f.k;
        chip.addEventListener('click', () => {
          clearTimeout(deepTimer);
          for (const c of pop.querySelectorAll('.sg-form, .sg-char')) c.classList.toggle('sg-on', c === chip);
          pop.classList.add('sg-wide');
          currentGuide = g;
          openG(g);
          placePop(tok);
        });
        row.append(chip);
      }
      const lib = ih('button', 'sg-icon-btn sg-lib', 'library', '', 16);
      lib.title = 'Open the Library: all the guides you have collected';
      lib.setAttribute('aria-label', 'Library');
      lib.addEventListener('click', () => {
        const on = row.querySelector('.sg-form.sg-on');
        post({ type: 'openLibrary', k: on ? on.dataset.k : '' });
      });
      const full = ih('button', 'sg-icon-btn sg-expand', 'maximize-2', '', 15);
      full.title = 'Read this guide full screen';
      full.addEventListener('click', () => {
        const g = currentGuide || firstGuide;
        openReader(g.f, ctx, g.phrase ? phraseAsWord(g.phrase) : w, g.word, () => {
          if (deep.isConnected && deep.classList.contains('sg-show') && currentGuide === g) openG(g);
        });
      });
      row.append(lib, full);
      pop.append(row);
    }
    if (Array.isArray(w.x) && w.x.length) {
      const row = h('div', 'sg-pop-x');
      row.append(h('span', 'sg-pop-forms-label', 'Also in'));
      for (const x of w.x) {
        const item = h('span', 'sg-x');
        const word = h('span', 'sg-x-w', x.w);
        word.lang = x.lang;
        item.append(h('span', 'sg-x-lang', { ja: 'Japanese', zh: 'Chinese', ko: 'Korean' }[x.lang] || x.lang), word);
        if (x.r) item.append(h('span', 'sg-x-r', x.r));
        if (x.note) item.append(h('span', 'sg-x-note', x.note));
        row.append(item);
      }
      pop.append(row);
    }
    const chars = ctx.lang === 'ja' || ctx.lang === 'zh' ? SG.ruby.hanChars(w.s) : [];
    // When the word's pieces are exactly its characters (昨 + 日), the pieces themselves open each
    // character's entry, so the same characters aren't listed twice.
    const pieceEls = Array.from(pop.querySelectorAll('.sg-pop-parts .sg-pop-t'));
    const piecesAreChars = chars.length > 0 && pieceEls.length === chars.length && pieceEls.every((el, i) => el.textContent === chars[i]);
    if (piecesAreChars) {
      pieceEls.forEach((el, i) => {
        const ch = chars[i];
        el.classList.add('sg-pop-t-char');
        if (known[ctx.lang].has(ch)) el.classList.add('sg-known');
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.title = 'Open this character\'s entry';
        el.addEventListener('click', () => {
          clearTimeout(deepTimer);
          for (const c of pop.querySelectorAll('.sg-form, .sg-char, .sg-pop-t-char')) c.classList.toggle('sg-on', c === el);
          pop.classList.add('sg-wide');
          showCharEntry(deep, ch, ctx, w);
          placePop(tok);
        });
      });
    }
    if (chars.length && !piecesAreChars) {
      const row = h('div', 'sg-pop-forms sg-pop-chars');
      row.append(h('span', 'sg-pop-forms-label', ctx.lang === 'ja' ? 'Kanji' : 'Characters'));
      for (const ch of chars) {
        const chip = h('button', 'sg-char' + (known[ctx.lang].has(ch) ? ' sg-known' : ''), ch);
        chip.title = known[ctx.lang].has(ch) ? 'Known · open its entry' : 'Open its entry';
        chip.addEventListener('click', () => {
          clearTimeout(deepTimer);
          for (const c of pop.querySelectorAll('.sg-form, .sg-char')) c.classList.toggle('sg-on', c === chip);
          pop.classList.add('sg-wide');
          showCharEntry(deep, ch, ctx, w);
          placePop(tok);
        });
        row.append(chip);
      }
      pop.append(row);
    }
    pop.append(deep);

    const ask = () => {
      if (!firstGuide) return;
      pop.classList.add('sg-wide');
      openG(firstGuide);
      placePop(tok);
    };
    const ready = firstGuide && deepTexts.has(guideCacheKey(firstGuide.word && !firstGuide.phrase ? wordForm : firstGuide.f));
    if (ready) {
      ask();
    } else if (settings.hasKey && settings.autoDeep && firstGuide) {
      deepTimer = setTimeout(ask, 650);
    } else if (settings.hasKey && firstGuide) {
      const more = h('button', 'sg-btn', firstGuide.phrase ? 'Guide to ' + firstGuide.phrase.d : firstGuide.word ? 'Word guide' : 'Full guide to ' + (firstGuide.f.name || firstGuide.f.k));
      more.addEventListener('click', () => {
        more.remove();
        ask();
      });
      pop.append(more);
    }

    pop.classList.add('sg-show');
    placePop(tok);
  }

  // Centre the popup above the word, kept inside the video.
  function placePop(tok) {
    const pop = ui.pop;
    if (!tok.isConnected) return;
    const rr = ui.root.getBoundingClientRect();
    const tr = tok.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const reserved = settings.panelOpen ? ui.panel.el.offsetWidth : 0;
    let left = tr.left - rr.left + tr.width / 2 - pw / 2;
    left = Math.max(6, Math.min(left, rr.width - reserved - pw - 6));
    pop.style.left = left + 'px';
    pop.style.bottom = rr.bottom - tr.top + 6 + 'px';
    pop.style.maxHeight = Math.max(120, tr.top - rr.top - 14) + 'px';
  }

  function formsOf(w) {
    const seen = new Set();
    return (Array.isArray(w.g) ? w.g : [])
      .filter((f) => f && f.k)
      .map((f) => Object.assign({}, f, { k: SG.canonicalForm(f.k), name: generalFormName(f.name, w.s, isFunctionWord(w)) }))
      .filter((f) => !seen.has(f.k) && seen.add(f.k));
  }
  // "object marker 을 웃음을" -> "object marker 을": a form's label never carries the word it was met on.
  function generalFormName(name, word, wordIsForm) {
    let n = String(name || '').trim();
    // The word is trimmed off the label, unless the word is itself the particle or ending (を, 을).
    if (!wordIsForm && word && n.length > word.length && n.endsWith(word)) n = n.slice(0, -word.length).trim() || n;
    return n;
  }

  function guideCacheKey(form) {
    return 'guide|' + form.k;
  }

  function paintDeep(target) {
    if (target.guide) SG.renderGuide(target.el, target.text, { known: known.ja, plain: !settings.furigana });
    else target.el.textContent = target.text;
    const pl = target.guide && target.cacheKey ? deepPayloads.get(target.cacheKey) : null;
    if (pl && pl.sentence) {
      const box = inThisLine(target, pl, Boolean(ui && ui.pop.contains(target.el)));
      if (box) target.el.prepend(box);
    }
    const checkBox = pl && pl.sentence ? h('div', 'sg-linecheck') : null;
    if (checkBox) lineCheck(target, pl, checkBox);
    const notes = target.guide && target.cacheKey ? deepNotesList.get(target.cacheKey) || [] : [];
    if (notes.length) {
      const nb = h('div', 'sg-notes');
      nb.append(h('div', 'sg-g-h', 'From your questions'));
      for (const n of notes) {
        const one = h('div', 'sg-g-li', n.text);
        if (n.sentence) {
          const src = h('div', 'sg-g-ext', n.sentence);
          src.lang = (deepPayloads.get(target.cacheKey) || {}).lang || '';
          one.append(src);
        }
        nb.append(one);
      }
      target.el.append(nb);
    }
    if (checkBox && checkBox.childElementCount) target.el.append(checkBox);
    const model = target.cacheKey ? deepModels.get(target.cacheKey) : target.model;
    if (target.guide && model) {
      const by = h('div', 'sg-guide-by', SG.modelLabel(model));
      // Not happy with it? Have the strongest model rewrite it (the old one is kept in history).
      const payload = deepPayloads.get(target.cacheKey);
      if (payload && model !== 'claude-opus-5-5' && model !== 'claude-fable-5-2' && settings.hasKey) {
        const better = h('button', 'sg-btn sg-ghost sg-improve', 'Improve with Opus');
        better.title = 'Rewrite this guide with Claude Opus 5.5 (about 5–10¢); your notes are kept and the old version can be restored';
        better.addEventListener('click', (e) => {
          e.stopPropagation();
          deepTexts.delete(target.cacheKey);
          deepModels.delete(target.cacheKey);
          startDeep(target.el, target.cacheKey, true, Object.assign({}, payload, { improve: true, model: 'claude-opus-5-5' }));
        });
        by.append(better);
      }
      target.el.append(by);
    }
  }

  // "In this line": what the word or form is doing in the line on screen, built from the line breakdown that
  // was already paid for (free). The guide below it is general. A paid check is there only on request.
  // In the hover card the word's meaning, pieces and note are already shown above, so only what's new is
  // added there (which piece of the word the form is); the panel and reader get the full box.
  function inThisLine(target, pl, inCard) {
    const box = h('div', 'sg-inline' + (inCard ? ' sg-inline-slim' : ''));
    const info = pl.line || {};
    const pieces = info.pieces || [];
    if (inCard) {
      if (pl.kind === 'guide') {
        const name = String((pl.form && pl.form.name) || '');
        const piece = pieces.find((p) => p.t && p.t !== pl.word && name.includes(p.t));
        if (piece) {
          const p1 = h('div', 'sg-g-p');
          p1.append(document.createTextNode('In this line: '), h('b', '', piece.t), document.createTextNode(` on ${pl.word}, ${piece.g}`));
          box.append(p1);
        }
      }
      return box.childElementCount ? box : null;
    }
    box.append(h('div', 'sg-g-h', 'In this line'));
    if (pl.kind === 'guide') {
      // The piece of the word that is this form (을 in 웃음을), and what the word means here.
      const name = String((pl.form && pl.form.name) || '');
      const piece = pieces.find((p) => p.t && p.t !== pl.word && name.includes(p.t)) || pieces.find((p) => p.t && p.t !== pl.word && /marker|particle|ending|past|polite|casual|negative|passive|causative|tense|form/i.test(p.g || '') && name.toLowerCase().split(/\s+/).some((x) => x.length > 3 && (p.g || '').toLowerCase().includes(x)));
      const p1 = h('div', 'sg-g-p');
      if (piece) p1.append(h('b', '', piece.t), document.createTextNode(` on ${pl.word}: ${piece.g}`));
      else p1.append(h('b', '', pl.word || ''), document.createTextNode(pl.meaning ? `: ${pl.meaning}` : ''));
      box.append(p1);
      if (piece && pl.meaning) box.append(h('div', 'sg-g-p sg-g-ext', `${pl.word} here: ${pl.meaning}`));
    } else {
      const p1 = h('div', 'sg-g-p');
      p1.append(h('b', '', pl.word || pl.dict || ''), document.createTextNode(pl.meaning ? `: ${pl.meaning}` : ''));
      box.append(p1);
      if (pieces.length > 1) box.append(h('div', 'sg-g-p sg-g-ext', pieces.map((p) => `${p.t} ${p.g}`).join('  +  ')));
    }
    if (info.note) box.append(h('div', 'sg-g-p', info.note));
    return box;
  }

  // The result of a check against this line, or the link to ask for one (a small cost).
  function lineCheck(target, pl, box) {
    const note = deepNotes.get(target.cacheKey + '|' + sameLineKey(pl.sentence));
    if (note && note.done && note.covered) {
      box.append(h('div', 'sg-g-p sg-g-ext', 'Checked: the guide covers this use.'));
    } else if (note && note.why) {
      box.append(h('div', 'sg-g-h', 'Why it means something different here'), h('div', 'sg-g-p', note.why));
      if (note.other) box.append(h('div', 'sg-g-p sg-g-ext', 'This line uses: ' + note.other));
    } else if (settings.hasKey) {
      const odd = h('button', 'sg-link sg-check-line', "Doesn't fit this line? Check it");
      odd.title = 'Have Claude check the guide against this line (a small cost; nothing is changed in the guide)';
      odd.addEventListener('click', (e) => {
        e.stopPropagation();
        odd.textContent = 'Checking…';
        const reqId = ++deepReq;
        deepByReq.set(reqId, Object.assign({}, target, { quiet: true }));
        deepNoteFor.set(reqId, target);
        post(Object.assign({ type: 'deep', reqId }, pl, { force: true }));
      });
      box.append(odd);
    }
  }

  // Shows cached text at once, attaches to a request already streaming, or starts a new one.
  function startDeep(el, cacheKey, guide, payload) {
    if (payload && !payload.improve) deepPayloads.set(cacheKey, payload);
    el.classList.add('sg-show');
    el.classList.toggle('sg-guide', guide);
    if (deepTexts.has(cacheKey)) {
      el.classList.remove('sg-loading');
      paintDeep({ el, text: deepTexts.get(cacheKey), guide, cacheKey });
      // Opened on another line: the background remembers the line (free) and returns any note it has for it.
      if (guide && payload && payload.sentence && sameLineKey(payload.sentence) !== sameLineKey(deepSentences.get(cacheKey))) {
        const reqId = ++deepReq;
        deepByReq.set(reqId, { el, cacheKey, text: deepTexts.get(cacheKey), guide, quiet: true });
        post(Object.assign({ type: 'deep', reqId }, payload));
      }
      return;
    }
    const running = deepByKey.get(cacheKey);
    if (running) {
      running.el = el;
      if (running.text) paintDeep(running);
      else {
        el.textContent = guide ? 'Writing a guide to this form…' : 'Explaining…';
        el.classList.add('sg-loading');
      }
      return;
    }
    const reqId = ++deepReq;
    const target = { el, cacheKey, text: '', guide };
    deepByReq.set(reqId, target);
    deepByKey.set(cacheKey, target);
    el.textContent = guide ? `Writing a guide to ${payload.kind === 'wordguide' ? 'this word' : 'this form'}… (saved once written, so it opens instantly next time)` : 'Explaining…';
    el.classList.add('sg-loading');
    post(Object.assign({ type: 'deep', reqId }, payload));
  }

  function wordGuideForm(w, lang) {
    const d = w.d || w.s;
    return { k: `word.${lang || 'und'}.${d}`, name: d + (w.r && w.d === w.s ? ` (${w.r})` : '') };
  }

  // Function words (particles, suffixes, auxiliaries, the copula) get a grammar guide, not a word guide.
  function isFunctionWord(w) {
    return /particle|suffix|auxiliary|copula|助詞|助動詞|接尾/i.test(w.pos || '') && !/proper noun/i.test(w.pos || '');
  }
  function functionWordForm(w, lang) {
    const d = w.d || w.s;
    return { k: SG.canonicalForm(`${lang || 'und'}.fn_${d}`), name: d };
  }

  // A phrase as a learnable item: its own guide (phrase.<lang>.<d>) or, for a grammar pattern, the
  // grammar guide named by its identifier.
  function phraseGuideForm(p, lang) {
    if (p.kind === 'pattern' && p.k && !p.k.startsWith('phrase.')) return { k: SG.canonicalForm(p.k), name: p.d, grammar: true };
    const k = p.k && p.k.startsWith('phrase.') ? p.k : `phrase.${lang || 'und'}.${p.d}`;
    return { k, name: p.d + (p.r ? ` (${p.r})` : ''), phrase: true };
  }
  function phraseAsWord(p) {
    return { s: p.d, d: p.d, r: p.r || '', dr: p.r || '', m: p.m || '', pos: p.kind || 'phrase', k: p.k || '', phrase: true, b: p.b || [] };
  }
  async function phraseItem(p, ctx) {
    return { kind: 'word', lang: ctx.lang, text: p.d, word: Object.assign(phraseAsWord(p), { f: [] }), context: await lineContext(ctx) };
  }
  function phrasesWith(ctx, index) {
    const a = analyses.get(ctx.key);
    return (a && Array.isArray(a.phrases) ? a.phrases : []).filter((p) => p && Array.isArray(p.w) && p.w.length >= 2 && p.w.includes(index) && p.d);
  }

  // The card for a whole phrase (clicked on its meaning above the line, or from a word's card).
  function openPhraseCard(p, ctx, anchor) {
    hidePop();
    const pop = ui.pop;
    pop.textContent = '';
    pop.classList.add('sg-wide');
    popFor = anchor;
    const head = h('div', 'sg-pop-head');
    const word = h('span', 'sg-pop-word', p.d);
    word.lang = ctx.lang;
    head.append(word);
    if (p.r && !sameText(p.r, p.d)) head.append(h('span', 'sg-pop-read', p.r));
    head.append(h('span', 'sg-jlpt', p.kind || 'phrase'));
    head.append(speakButton(p.d, ctx.lang), knownWordButton(phraseAsWord(p), ctx.lang), starButton('word', ctx.lang, p.d, () => phraseItem(p, ctx)));
    pop.append(head, h('div', 'sg-pop-mean', p.m || ''));
    if (Array.isArray(p.b) && p.b.length > 1) {
      const chain = h('div', 'sg-build');
      p.b.forEach((step, i) => {
        if (i) chain.append(h('span', 'sg-build-arrow', '→'));
        const one = h('span', 'sg-build-step');
        const t = h('span', 'sg-build-t', step.t);
        t.lang = ctx.lang;
        one.append(t, h('span', 'sg-build-m', step.m));
        chain.append(one);
      });
      pop.append(chain);
    }
    const deep = h('div', 'sg-pop-deep');
    const form = phraseGuideForm(p, ctx.lang);
    const row = h('div', 'sg-pop-forms');
    row.append(h('span', 'sg-pop-forms-label', 'Guide'));
    const chip = form.grammar ? h('button', 'sg-form sg-on', p.d) : ih('button', 'sg-form sg-form-word sg-on', 'book-open', p.d, 13);
    const open = () => {
      if (form.grammar) showGuide(deep, form, ctx, phraseAsWord(p));
      else showPhraseGuide(deep, p, ctx);
      placePop(anchor);
    };
    chip.addEventListener('click', open);
    const full = ih('button', 'sg-icon-btn sg-expand', 'maximize-2', '', 15);
    full.title = 'Read this guide full screen';
    full.addEventListener('click', () => openReader(form, ctx, phraseAsWord(p), !form.grammar));
    row.append(chip, full);
    pop.append(row, deep);
    pop.classList.add('sg-show');
    placePop(anchor);
    if (deepTexts.has(guideCacheKey(form)) || settings.autoDeep) open();
  }

  function showPhraseGuide(el, p, ctx) {
    const form = phraseGuideForm(p, ctx.lang);
    startDeep(el, guideCacheKey(form), true, {
      kind: 'wordguide', form, lang: ctx.lang, sentence: ctx.sentence, word: p.d, dict: p.d, reading: p.r, pos: p.kind, meaning: p.m, phrase: true,
      line: { pieces: [], note: '', role: '', translation: ctx.translation || '' },
    });
  }

  function showWordGuide(el, w, ctx) {
    if (w.phrase) return showPhraseGuide(el, { d: w.d, r: w.r, kind: w.pos, m: w.m, k: w.k }, ctx);
    const form = wordGuideForm(w, ctx.lang);
    startDeep(el, guideCacheKey(form), true, {
      kind: 'wordguide', form, lang: ctx.lang, sentence: ctx.sentence, word: w.s, dict: w.d, reading: w.r, pos: w.pos, meaning: w.m,
      line: { pieces: Array.isArray(w.p) ? w.p : [], note: w.n || '', role: w.role || '', translation: ctx.translation || '' },
    });
  }

  function showGuide(el, form, ctx, w) {
    startDeep(el, guideCacheKey(form), true, {
      kind: 'guide', form: { k: form.k, name: form.name }, lang: ctx.lang, sentence: ctx.sentence, word: w.s, meaning: w.m || '',
      line: { pieces: Array.isArray(w.p) ? w.p : [], note: w.n || '', role: w.role || '', translation: ctx.translation || '' },
    });
  }

  function onDeep(msg) {
    if (msg.type === 'deepNote') {
      const t = deepNoteFor.get(msg.reqId);
      if (!t) return;
      const payload = deepPayloads.get(t.cacheKey);
      if (payload) deepNotes.set(t.cacheKey + '|' + sameLineKey(payload.sentence), { why: msg.why, other: msg.other || '', covered: Boolean(msg.covered), done: msg.covered != null });
      if (t.el.isConnected) paintDeep(t);
      return;
    }
    const target = deepByReq.get(msg.reqId);
    if (!target) return;
    target.el.classList.remove('sg-loading');
    if (msg.type === 'deepDelta') {
      target.text += msg.delta;
      paintDeep(target);
      return;
    }
    deepByReq.delete(msg.reqId);
    deepByKey.delete(target.cacheKey);
    if (msg.type === 'deepDone') {
      deepTexts.set(target.cacheKey, msg.text);
      if (msg.model) deepModels.set(target.cacheKey, msg.model);
      if (msg.sentence != null) deepSentences.set(target.cacheKey, msg.sentence);
      if (msg.notes) deepNotesList.set(target.cacheKey, msg.notes);
      target.text = msg.text;
      // A note about this line may follow (see deepNote).
      deepNoteFor.set(msg.reqId, target);
      paintDeep(target);
    } else {
      target.el.textContent = msg.message;
    }
  }

  // ------------------------------------------------------------------ panel

  function renderDetail(cue, a) {
    if (!ui || !settings.panelOpen) return;
    const box = ui.panel.detail;
    box.textContent = '';
    const head = h('div', 'sg-d-head');
    const orig = h('div', 'sg-d-orig', cue.text);
    if (a && a.lang) orig.lang = a.lang;
    head.append(orig);
    box.append(head);
    if (!a) {
      box.append(h('div', 'sg-d-wait', settings.hasKey ? 'Analyzing this line…' : 'No API key set.'));
      return;
    }
    if (a.tr) box.append(h('div', 'sg-d-tr', a.tr));
    const lineTools = h('div', 'sg-d-tools');
    const lang = langCode(a.lang);
    const say = ih('button', 'sg-icon-btn sg-d-say', 'volume-2', '', 18);
    say.title = 'Hear the line';
    say.setAttribute('aria-label', 'Hear the line');
    say.addEventListener('click', () => speakText(cue.text, lang));
    head.append(say);
    const allKnown = h('button', 'sg-link', 'Mark all known');
    allKnown.title = 'Marks each word in this line as known (particles and names are never highlighted anyway)';
    allKnown.addEventListener('click', async () => {
      const words = (a.w || []).filter((w) => !isTrivial(w)).map((w) => w.d || w.s);
      await setWordsKnown(lang, words, true);
      showToast(`Marked ${words.length} word${words.length === 1 ? '' : 's'} known.`);
    });
    const lineStar = starButton('line', lang, cue.text, async () => ({
      kind: 'line', lang, text: cue.text,
      line: { tr: a.tr, lit: a.lit, notes: a.notes || [], w: (a.w || []).map((w) => ({ s: w.s, r: w.r, f: SG.ruby.segmentsFor(w, lang), d: w.d, m: w.m, pos: w.pos })) },
      context: await lineContext({ sentence: cue.text, translation: a.tr, lang, time: cue.start + (active() ? active().offset : 0) }),
    }));
    lineStar.title = 'Save this line as a review card';
    const saveLbl = h('span', 'sg-d-save');
    saveLbl.append(lineStar, document.createTextNode(' Save line'));
    lineTools.append(saveLbl, allKnown);
    box.append(lineTools);
    const words = a.w || [];
    box.append(howItWorks(a, words));
    box.append(askBox(cue, a));
    if (a.notes && a.notes.length) {
      box.append(h('div', 'sg-section', 'Notes'));
      for (const n of a.notes) box.append(h('div', 'sg-d-note', n));
    }
    const forms = [];
    const seen = new Set();
    for (const w of words) {
      for (const f of formsOf(w)) {
        if (!seen.has(f.k)) {
          seen.add(f.k);
          forms.push({ f, w });
        }
      }
    }
    if (forms.length) {
      box.append(h('div', 'sg-section', 'Grammar in this line'));
      const row = h('div', 'sg-d-forms');
      const ctx = { key: shownKey, sentence: cue.text, translation: a.tr, lang: a.lang };
      for (const { f, w } of forms) {
        const chip = h('button', 'sg-form', f.name || f.k);
        if (deepTexts.has(guideCacheKey(f))) chip.classList.add('sg-saved');
        chip.title = 'Open the full guide to this form';
        chip.addEventListener('click', () => openPanelGuide(f, ctx, w));
        row.append(chip);
      }
      box.append(row);
    }
    if (words.length) {
      box.append(h('div', 'sg-section', 'Words'));
      for (const w of words) {
        const row = h('div', 'sg-word');
        const head = h('div', 'sg-word-head');
        head.append(h('span', 'sg-word-s', w.s));
        if (w.r && !sameText(w.r, w.s)) head.append(h('span', 'sg-word-r', w.r));
        head.append(h('span', 'sg-word-m', w.m || ''));
        const wctx = { sentence: cue.text, translation: a.tr, lang: langCode(a.lang), time: cue.start + (active() ? active().offset : 0) };
        const gb = ih('button', 'sg-say', 'book-open', '', 15);
        gb.title = 'Word guide';
        gb.addEventListener('click', () => openPanelGuide(wordGuideForm(w, wctx.lang), wctx, w, true));
        head.append(gb, starButton('word', langCode(a.lang), w.d || w.s, () => wordItem(w, wctx)));
        row.append(head);
        const parts = Array.isArray(w.p) ? w.p : [];
        if (parts.length > 1) row.append(h('div', 'sg-word-p', parts.map((p) => `${p.t} ${p.g}`).join('  +  ')));
        if (w.n) row.append(h('div', 'sg-word-n', w.n));
        box.append(row);
      }
    }
  }

  let panelGuide = null;

  // A guide in a large, comfortable reading view over the whole video.
  let reader = null;
  function closeReader() {
    if (!reader) return;
    const { el, onClose } = reader;
    reader = null;
    el.remove();
    if (onClose) onClose();
  }
  function openReader(form, ctx, w, isWord, onClose) {
    closeReader();
    const el = h('div', 'sg-reader');
    const card = h('div', 'sg-reader-card');
    const head = h('div', 'sg-reader-head');
    const kind = h('span', 'sg-reader-kind', isWord ? 'Word guide' : 'Grammar guide');
    const title = h('span', 'sg-reader-title', isWord ? form.name || form.k : form.name || form.k);
    title.lang = ctx.lang || '';
    const titles = h('div', 'sg-reader-titles');
    titles.append(kind, title);
    const lib = h('button', 'sg-btn sg-ghost', 'Library');
    lib.addEventListener('click', () => post({ type: 'openLibrary', k: form.k }));
    const close = ih('button', 'sg-icon-btn sg-close', 'x');
    close.title = 'Close (Esc)';
    close.addEventListener('click', closeReader);
    head.append(titles, lib, close);
    const body = h('div', 'sg-reader-body');
    body.lang = ctx.lang || '';
    card.append(head, body);
    el.append(card);
    el.addEventListener('pointerdown', (e) => {
      if (e.target === el) closeReader();
    });
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    ui.root.append(el);
    reader = { el, onClose };
    hidePop();
    if (isWord) showWordGuide(body, w, ctx);
    else showGuide(body, form, ctx, w);
  }

  function openPanelGuide(form, ctx, w, isWord) {
    panelGuide = { form, ctx, w, isWord };
    const p = ui.panel;
    p.setTab('line');
    p.guide.dataset.k = form.k;
    p.guideTitle.textContent = form.name || form.k;
    p.guide.classList.add('sg-show');
    p.guideBody.scrollTop = 0;
    if (isWord) showWordGuide(p.guideBody, w, ctx);
    else showGuide(p.guideBody, form, ctx, w);
  }

  // "How the sentence works": the line in its own order, chunk by chunk with a gloss under each, and
  // (opened on request) how it builds from the core outward. Older analyses show the literal rendering
  // and phrase chips they were saved with.
  function howItWorks(a, words) {
    const wrap = h('div', 'sg-how');
    wrap.append(h('div', 'sg-section', 'How the sentence works'));
    const chunks = Array.isArray(a.chunks) ? a.chunks.filter((c) => words[c.from] && words[c.to]) : [];
    if (chunks.length) {
      const row = h('div', 'sg-chunks');
      for (const c of chunks) {
        const el = h('span', 'sg-chunk sg-role-' + (c.role || 'other'));
        const jp = h('span', 'sg-chunk-t', words.slice(c.from, c.to + 1).map((w) => w.s).join(''));
        jp.lang = a.lang || '';
        el.append(jp, h('span', 'sg-chunk-m', c.m || ''), h('span', 'sg-chunk-r', ROLE_LABELS[c.role] || ''));
        row.append(el);
      }
      if (a.cont) row.append(h('span', 'sg-chunk-cont', 'continues →'));
      wrap.append(row);
    } else if (a.lit || words.length) {
      if (a.lit) wrap.append(h('div', 'sg-d-lit', a.lit));
      const chips = h('div', 'sg-chips');
      let cur = null;
      let chip = null;
      for (const w of words) {
        if (w.c !== cur || !chip) {
          cur = w.c;
          chip = h('span', 'sg-chip sg-role-' + (w.role || 'other'));
          chip.append(h('span', 'sg-chip-role', ROLE_LABELS[w.role] || 'other'), h('span', 'sg-chip-text', ''));
          chips.append(chip);
        }
        chip.lastChild.textContent += w.s;
      }
      wrap.append(chips);
      if (a.pat) wrap.append(h('div', 'sg-d-pat', a.pat));
    }
    if (Array.isArray(a.build) && a.build.length > 1) {
      const more = h('button', 'sg-more', 'How it fits together ▾');
      const steps = h('ol', 'sg-build-steps');
      steps.hidden = true;
      for (const st of a.build) {
        const li = h('li', 'sg-bstep');
        const t = h('span', 'sg-bstep-t', st.t);
        t.lang = a.lang || '';
        li.append(t, h('span', 'sg-bstep-m', st.m));
        if (st.why) li.append(h('span', 'sg-bstep-why', st.why));
        steps.append(li);
      }
      more.addEventListener('click', () => {
        steps.hidden = !steps.hidden;
        more.textContent = steps.hidden ? 'How it fits together ▾' : 'How it fits together ▴';
      });
      wrap.append(more, steps);
    }
    return wrap;
  }

  function renderTranscript() {
    if (!ui || !settings.panelOpen) return;
    const { list, rows } = ui.panel;
    list.textContent = '';
    rows.clear();
    const t = active();
    if (!t) return;
    const frag = document.createDocumentFragment();
    t.cues.forEach((cue, i) => {
      const row = h('div', 'sg-row');
      row.append(h('span', 'sg-row-time', fmtTime(cue.start + t.offset)));
      const body = h('span', 'sg-row-body');
      body.append(h('span', 'sg-row-text', cue.text));
      const a = analyses.get(t.keys[i]);
      body.append(h('span', 'sg-row-tr', a ? a.tr : ''));
      row.append(body);
      row.addEventListener('click', () => {
        video.currentTime = cue.start + t.offset + 0.01;
      });
      const key = t.keys[i];
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(row);
      row.dataset.i = String(i);
      frag.append(row);
    });
    list.append(frag);
    highlightRow(shownIndex);
    renderStatus();
  }

  function updateTranscriptRow(key) {
    if (!ui) return;
    const a = analyses.get(key);
    for (const row of ui.panel.rows.get(key) || []) {
      row.querySelector('.sg-row-tr').textContent = a ? a.tr : '';
    }
  }

  let litRow = null;
  function highlightRow(idx) {
    if (!ui || !settings.panelOpen) return;
    if (litRow) litRow.classList.remove('sg-current');
    litRow = idx >= 0 ? ui.panel.list.children[idx] || null : null;
    if (!litRow) return;
    litRow.classList.add('sg-current');
    const list = ui.panel.list;
    if (!list.matches(':hover')) list.scrollTop = litRow.offsetTop - list.offsetTop - list.clientHeight / 3;
  }

  // ------------------------------------------------- keyboard and picker

  function seekToCue(delta) {
    const t = active();
    if (!t || !video) return;
    const now = video.currentTime - t.offset;
    let idx = findCue(t.cues, now);
    if (idx === -1) {
      idx = t.cues.findIndex((c) => c.start > now);
      if (idx === -1) idx = t.cues.length;
      if (delta > 0) idx -= 1;
    }
    const target = t.cues[Math.max(0, Math.min(t.cues.length - 1, idx + delta))];
    if (target) video.currentTime = target.start + t.offset + 0.01;
  }

  // Hides all of Langtitles' subtitles (the site's own captions come back), or shows them again.
  function toggleSubtitles() {
    overlayHidden = !overlayHidden;
    applySettings();
    showToast(overlayHidden ? 'Subtitles hidden. Press H to show them again.' : 'Subtitles shown.');
  }

  function onKey(e) {
    if (reader && e.key === 'Escape') {
      closeReader();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (picking && e.key === 'Escape') {
      picking = false;
      return;
    }
    if (!ui || !video || !enabled() || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (!active() && e.key.toLowerCase() !== 'g') return;
    const key = e.key.toLowerCase();
    if (key === 'm' && listenMode() && !e.shiftKey) {
      shadowLine();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (tapSync && key === 't') {
      tapSync.mark();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Timing: [ earlier, ] later (Shift: 1 s steps, typed as { and }), \ resets.
    if (e.key === '[' || e.key === '{' || e.key === ']' || e.key === '}' || e.key === '\\') {
      if (e.key === '\\') nudgeOffset(null);
      else nudgeOffset((e.key === '[' || e.key === '{' ? -1 : 1) * (e.shiftKey ? 1 : 0.25));
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (key === 'a') seekToCue(-1);
    else if (key === 'd') seekToCue(1);
    else if (key === 's') replayLine(false);
    else if (key === 'l') replayLine(true);
    else if (key === 'g') setPanel(!settings.panelOpen);
    else if (key === 'r') toggleReadings();
    else if (key === 'h') {
      toggleSubtitles();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function selectorFor(el) {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return '#' + el.id;
    const classes = Array.from(el.classList).filter((c) => /^[A-Za-z_][\w-]*$/.test(c) && !c.startsWith('langtitles')).slice(0, 3);
    return classes.length ? el.tagName.toLowerCase() + '.' + classes.join('.') : '';
  }

  function onPickClick(e) {
    if (!picking) return;
    if (isOurs(e.target)) return;
    picking = false;
    e.preventDefault();
    e.stopPropagation();
    const hits = document.elementsFromPoint(e.clientX, e.clientY);
    const el = hits.find((x) => {
      if (x === video || isOurs(x)) return false;
      const text = (x.innerText || '').trim();
      return text.length > 0 && text.length < 400;
    });
    if (!el) {
      showToast('No text found there. Make sure a subtitle is on screen, then try again.');
      return;
    }
    domEl = el;
    domText = '';
    const sel = selectorFor(el);
    if (sel) {
      const hostSelectors = Object.assign({}, settings.hostSelectors, { [location.hostname]: sel });
      post({ type: 'saveSettings', patch: { hostSelectors } });
    }
    tracks.delete('dom');
    readDomCaption();
    manualPick = 'dom';
    activeId = null;
    chooseActive();
    showToast('Reading subtitles from the page.');
  }

  // ------------------------------------------------- readings and word bank

  function loadKnown(value) {
    const v = value || {};
    known.ja = new Set(Array.from(v.ja || ''));
    known.zh = new Set(Array.from(v.zh || ''));
  }

  function refreshLine() {
    shownKey = null;
    tick();
  }

  function loadKnownWords(value) {
    knownWords = {};
    for (const [lang, list] of Object.entries(value || {})) knownWords[lang] = new Set(list);
  }

  browser.storage.local.get(['known', 'knownWords']).then((r) => {
    loadKnown(r.known);
    loadKnownWords(r.knownWords);
    refreshLine();
  }, () => {});
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.known) loadKnown(changes.known.newValue);
    if (changes.knownWords) loadKnownWords(changes.knownWords.newValue);
    if (changes.known || changes.knownWords) refreshLine();
  });

  // ------------------------------------------------------- new and known words

  const NEW_THRESHOLD = 20;

  function isTrivial(w) {
    return /particle|punctuation|interjection|auxiliary|proper noun|name|助詞|symbol|onomatopoeia/i.test(w.pos || '') || ['connector', 'interjection', 'address'].includes(w.role) && /particle|conjunction/i.test(w.pos || '');
  }

  function wordKnown(w, lang) {
    const set = knownWords[lang];
    return Boolean(set && (set.has(w.d || w.s) || set.has(w.s)));
  }

  // Highlighting starts once enough words are marked known in the language, so that a
  // highlighted word means something.
  function highlighting(lang) {
    return settings.highlightNew && knownWords[lang] && knownWords[lang].size >= NEW_THRESHOLD;
  }

  function isNewWord(w, lang) {
    return highlighting(lang) && !isTrivial(w) && !wordKnown(w, lang);
  }

  function newWordsIn(a) {
    const lang = langCode(a.lang);
    if (!highlighting(lang)) return [];
    const seen = new Set();
    return (a.w || []).filter((w) => isNewWord(w, lang) && !seen.has(w.d || w.s) && seen.add(w.d || w.s));
  }

  async function setWordsKnown(lang, words, on) {
    const r = await browser.storage.local.get('knownWords');
    const all = Object.assign({}, r.knownWords);
    const set = new Set(all[lang] || []);
    for (const w of words) {
      if (on) set.add(w);
      else set.delete(w);
    }
    all[lang] = Array.from(set);
    await browser.storage.local.set({ knownWords: all });
    return set;
  }

  function knownWordButton(w, lang) {
    const b = h('button', 'sg-kw');
    const paint = () => {
      const on = wordKnown(w, lang);
      b.textContent = on ? '✓ Known' : 'Known?';
      b.classList.toggle('sg-on', on);
      b.title = on ? 'You know this word · click to undo' : 'Mark this word as one you know: no meaning or pieces above it, and no new-word underline (hover still shows everything)';
    };
    paint();
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const on = !wordKnown(w, lang);
      const set = await setWordsKnown(lang, [w.d || w.s], on);
      knownWords[lang] = set;
      paint();
      const n = set.size;
      if (on && n === NEW_THRESHOLD && settings.highlightNew) showToast(`${n} words known: words you don't know yet are now underlined.`);
    });
    return b;
  }

  // ------------------------------------------------------- replay and pausing

  function replayLine(loop) {
    const t = active();
    if (!t || !video) return;
    const now = video.currentTime - t.offset;
    let idx = findCue(t.cues, now);
    if (idx === -1) {
      idx = t.cues.findIndex((c) => c.start > now) - 1;
      if (idx < 0) idx = Math.max(0, t.cues.length - 1);
    }
    if (loop && replay && replay.loop) {
      stopReplay();
      if (ui) ui.panel.loopBtn.classList.remove('sg-on');
      showToast('Loop off.');
      return;
    }
    const cue = t.cues[idx];
    if (!replay) replay = { rate: video.playbackRate };
    replay.idx = idx;
    replay.end = cue.end;
    replay.start = cue.start;
    replay.loop = loop;
    if (settings.slowReplay) video.playbackRate = settings.slowRate || 0.75;
    video.currentTime = cue.start + t.offset + 0.01;
    const p = video.play();
    if (p && p.catch) p.catch(() => {});
    if (loop) showToast(`Looping this line${settings.slowReplay ? ' slowed down' : ''}. Press L or Loop again to stop.`);
    if (ui) ui.panel.loopBtn.classList.toggle('sg-on', Boolean(loop));
  }

  function stopReplay() {
    if (!replay) return;
    if (video) video.playbackRate = replay.rate || 1;
    replay = null;
    if (ui) ui.panel.loopBtn.classList.remove('sg-on');
  }

  // Runs every tick: ends or repeats a replay, and pauses after a line with exactly one new word.
  function studyChecks(t, now) {
    if (replay) {
      if (now >= replay.end - 0.02 && now < replay.end + 1.5) {
        if (replay.loop) {
          video.currentTime = replay.start + t.offset + 0.01;
        } else {
          stopReplay();
        }
      } else if (now < replay.start - 1 || now > replay.end + 1.5) {
        stopReplay(); // the viewer jumped elsewhere
      }
    }
    if (!settings.pauseOnePlus || listenMode() || !lineNew || video.paused || replay || popFor) return;
    const cue = t.cues[lineNew.idx];
    if (!cue || lineNew.words.length !== 1 || onePlusDone === lineNew.key) return;
    if (now >= cue.end - 0.25 && now < cue.end + 0.6) {
      onePlusDone = lineNew.key;
      video.pause();
      // Stay on this line even if the check ran a moment after it ended.
      if (now > cue.end - 0.08) video.currentTime = cue.end - 0.08 + t.offset;
      autoPaused = false;
      const w = lineNew.words[0];
      showToast(`One new word: ${w.s}${w.m ? ' (' + w.m + ')' : ''}. Hover it, or press Space to go on.`);
    }
  }

  // --------------------------------------------------------- pronunciation

  async function speakText(text, lang) {
    const ok = await SG.speech.speak(text, lang);
    if (!ok) showToast(SG.speech.missingVoiceHelp(lang));
  }

  function speakButton(text, lang) {
    const b = ih('button', 'sg-say', 'volume-2', '', 16);
    b.title = 'Hear it';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      speakText(text, lang);
    });
    return b;
  }

  // ------------------------------------------------------------ stroke order

  let strokeCssAdded = false;

  function strokeBlock(ch, lang) {
    const wrap = h('div', 'sg-strokes');
    if (!strokeCssAdded && ui) {
      const st = document.createElement('style');
      st.textContent = SG.strokes.CSS;
      ui.root.append(st);
      strokeCssAdded = true;
    }
    wrap.append(h('div', 'sg-g-h', 'Stroke order'));
    const row = h('div', 'sg-strokes-row');
    const pic = h('div', 'sg-strokes-pic', '…');
    const side = h('div', 'sg-strokes-side');
    row.append(pic, side);
    wrap.append(row);
    request({ type: 'stroke', ch, lang }).then((res) => {
      if (!res.data) {
        pic.textContent = 'No stroke order data for this character.';
        return;
      }
      let data;
      try {
        data = res.data.kind === 'kvg' ? SG.strokes.parseKanjiVG(res.data.text) : SG.strokes.parseHanziWriter(res.data.text);
      } catch (e) {
        pic.textContent = 'Stroke order data could not be read.';
        return;
      }
      const draw = () => SG.strokes.render(pic, data, { size: 120 });
      draw();
      const again = h('button', 'sg-btn', 'Replay');
      again.addEventListener('click', draw);
      side.append(h('div', 'sg-strokes-n', `${data.strokes.length} strokes`));
      const lg = SG.strokes.legend(data);
      if (lg.length) {
        const list = h('div', 'sg-strokes-legend');
        for (const c of lg) {
          const item = h('div', 'sg-strokes-comp');
          const sw = h('span', 'sg-strokes-sw', c.element);
          sw.style.color = c.color;
          item.append(sw, h('span', '', [c.original ? `from ${c.original}` : '', c.role].filter(Boolean).join(' · ')));
          list.append(item);
        }
        side.append(list);
      }
      side.append(again, h('div', 'sg-strokes-src', data.kind === 'kvg' ? 'KanjiVG, CC BY-SA 3.0' : 'Make Me a Hanzi'));
    });
    return wrap;
  }

  // ------------------------------------------------------------ episode words

  let studyMode = 'words';
  function openStudy(mode) {
    studyMode = mode;
    const p = ui.panel;
    p.setTab('words');
    for (const [id, b] of p.studyBtns) b.classList.toggle('sg-on', id === mode);
    p.wordsBody.hidden = mode !== 'words';
    p.studyBody.hidden = mode === 'words';
    if (mode === 'words') {
      if (!p.wordsBody.childElementCount) openEpisodeWords();
    } else if (mode === 'grammar') renderStudyGrammar(p.studyBody);
    else renderStudyPhrases(p.studyBody);
  }

  // Every grammar form in the episode's analysed lines, most frequent first. Free: it comes from the
  // line breakdowns already made.
  function collectStudy(kind) {
    const t = active();
    const out = new Map();
    if (!t) return { t, list: [] };
    t.cues.forEach((cue, i) => {
      const a = analyses.get(t.keys[i]);
      if (!a || !a.w) return;
      const ctx = { key: t.keys[i], sentence: cue.text, translation: a.tr, lang: langCode(a.lang), time: cue.start + t.offset };
      const add = (k, item) => {
        if (!out.has(k)) out.set(k, Object.assign(item, { count: 0, first: i, ctx }));
        out.get(k).count++;
      };
      if (kind === 'grammar') {
        a.w.forEach((w) => formsOf(w).forEach((f) => add(f.k, { f, w })));
      } else {
        (a.phrases || []).filter((p) => p && p.d && Array.isArray(p.w) && p.w.length >= 2).forEach((p) => add(p.k || p.d, { p }));
      }
    });
    return { t, list: Array.from(out.values()).sort((x, y) => y.count - x.count || x.first - y.first) };
  }

  function studyRows(body, kind) {
    body.textContent = '';
    const { t, list } = collectStudy(kind);
    if (!t) {
      body.append(h('div', 'sg-g-p', 'No subtitles yet.'));
      return;
    }
    const ready = t.keys.filter((k) => analyses.has(k)).length;
    const note = h('div', 'sg-find-status', `${list.length} ${kind === 'grammar' ? 'grammar forms' : 'phrases'} in the ${ready} of ${t.cues.length} lines prepared so far, most frequent first.`);
    const filter = h('label', 'sg-f-check');
    const box = h('input');
    box.type = 'checkbox';
    filter.append(box, document.createTextNode(kind === 'grammar' ? ' Only forms I haven\'t studied' : ' Only phrases I haven\'t saved'));
    const rows = h('div', 'sg-study');
    body.append(note, filter, rows);
    const draw = async () => {
      rows.textContent = '';
      const keys = list.map((x) => (kind === 'grammar' ? ['grammar', x.ctx.lang, x.f.k] : ['word', x.ctx.lang, x.p.d]).join('|'));
      const status = (await request({ type: 'bankStatus', keys })).status || {};
      list.forEach((x, n) => {
        const saved = Boolean(status[keys[n]]);
        const read = kind === 'grammar' && deepTexts.has(guideCacheKey(x.f));
        if (box.checked && (saved || read)) return;
        const row = h('div', 'sg-wl');
        const top = h('div', 'sg-wl-top');
        const name = h('button', 'sg-form' + (kind === 'grammar' ? '' : ' sg-form-word') + (read ? ' sg-saved' : ''), kind === 'grammar' ? x.f.name || x.f.k : x.p.d);
        name.title = kind === 'grammar' ? 'Open the guide to this form' : 'Open the guide to this phrase';
        name.addEventListener('click', () => {
          if (kind === 'grammar') openPanelGuide(x.f, x.ctx, x.w);
          else openPanelGuide(phraseGuideForm(x.p, x.ctx.lang), x.ctx, phraseAsWord(x.p), !phraseGuideForm(x.p, x.ctx.lang).grammar);
        });
        top.append(name, h('span', 'sg-wl-n', '×' + x.count));
        const star = kind === 'grammar'
          ? starButton('grammar', x.ctx.lang, x.f.k, async () => ({ kind: 'grammar', lang: x.ctx.lang, text: x.f.k, name: x.f.name || x.f.k, context: await lineContext(x.ctx) }))
          : starButton('word', x.ctx.lang, x.p.d, () => phraseItem(x.p, x.ctx));
        top.append(star);
        row.append(top);
        if (kind === 'phrases' && x.p.m) row.append(h('div', 'sg-wl-m', x.p.m));
        const ex = h('button', 'sg-wl-ex', t.cues[x.first].text);
        ex.title = 'Jump to this line';
        ex.addEventListener('click', () => {
          video.currentTime = t.cues[x.first].start + t.offset + 0.01;
        });
        row.append(ex);
        rows.append(row);
      });
      if (!rows.childElementCount) rows.append(h('div', 'sg-g-p', list.length ? 'All studied.' : 'Nothing yet: lines are listed here as they are prepared.'));
    };
    box.addEventListener('change', draw);
    draw();
  }
  function renderStudyGrammar(body) {
    studyRows(body, 'grammar');
  }
  function renderStudyPhrases(body) {
    studyRows(body, 'phrases');
  }

  async function openEpisodeWords() {
    const p = ui.panel;
    p.setTab('words');
    studyMode = 'words';
    for (const [id, b] of p.studyBtns) b.classList.toggle('sg-on', id === 'words');
    p.wordsBody.hidden = false;
    p.studyBody.hidden = true;
    const body = p.wordsBody;
    body.textContent = '';
    const t = active();
    if (!t) {
      body.append(h('div', 'sg-g-p', 'No subtitles yet.'));
      return;
    }
    if (t.source === 'dom') {
      body.append(h('div', 'sg-g-p', "Subtitles read off the page only arrive line by line, so there's no full episode to list yet. Find subtitles for the episode first (Find subtitles)."));
      return;
    }
    const lang = t.lang;
    body.append(h('div', 'sg-find-status', `Making a list from all ${t.cues.length} lines… (once per episode)`));
    const sig = SG.subtitles.lineKey(t.cues.map((c) => c.text).join('\n'), String(t.cues.length));
    const res = await request({ type: 'episodeWords', lines: t.cues.map((c) => c.text), sig });
    body.textContent = '';
    if (res.error) {
      body.append(h('div', 'sg-g-p', res.error));
      return;
    }
    const all = res.words || [];
    const cov = computeCoverage(all, lang);
    coverage.set(t.id, cov);
    renderStatus();
    const head = h('div', 'sg-cov');
    head.append(h('div', 'sg-scov-n', cov.pct + '%'), h('div', 'sg-cov-t', `of the words in this episode are ones you know (counting each time a word is used). ${cov.pct >= 90 ? 'Comfortable.' : cov.pct >= 75 ? 'A good level to learn from.' : 'Challenging: studying the words below first will help.'}`));
    body.append(head);
    const status = h('div', 'sg-find-status');
    const hideKnown = h('label', 'sg-f-check');
    const box = h('input');
    box.type = 'checkbox';
    box.checked = true;
    hideKnown.append(box, document.createTextNode(" Hide words I know"));
    const list = h('div', 'sg-results');
    body.append(status, hideKnown, list);
    const draw = () => {
      list.textContent = '';
      const shown = all.filter((x) => !(box.checked && knownWords[lang] && knownWords[lang].has(x.d)));
      status.textContent = `${shown.length} of ${all.length} words${box.checked ? " you haven't marked known" : ''}, most frequent first.`;
      for (const x of shown) {
        const row = h('div', 'sg-wl');
        const top = h('div', 'sg-wl-top');
        const word = h('span', 'sg-wl-w', x.d);
        word.lang = lang;
        top.append(word, h('span', 'sg-wl-r', x.r || ''), h('span', 'sg-wl-n', '×' + x.count));
        const fake = { s: x.d, d: x.d, r: x.r, m: x.m, pos: x.pos };
        const line = t.cues[x.line];
        const ctx = { sentence: line ? line.text : '', translation: '', lang, time: line ? line.start + t.offset : 0 };
        const kn = knownWordButton(fake, lang);
        kn.addEventListener('click', () => setTimeout(draw, 50));
        const gb = ih('button', 'sg-say', 'book-open', '', 15);
        gb.title = 'Word guide';
        gb.addEventListener('click', () => openPanelGuide(wordGuideForm(fake, lang), ctx, fake, true));
        top.append(speakButton(x.d, lang), gb, kn, starButton('word', lang, x.d, () => wordItem(fake, ctx)));
        row.append(top, h('div', 'sg-wl-m', [x.m, x.pos].filter(Boolean).join(' · ')));
        if (line) {
          const ex = h('button', 'sg-wl-ex', line.text);
          ex.title = 'Jump to this line';
          ex.addEventListener('click', () => {
            video.currentTime = line.start + t.offset + 0.01;
          });
          row.append(ex);
        }
        list.append(row);
      }
    };
    box.addEventListener('change', draw);
    draw();
  }

  async function toggleKnown(ch, lang) {
    const r = await browser.storage.local.get('known');
    const v = Object.assign({ ja: '', zh: '' }, r.known);
    const set = new Set(Array.from(v[lang] || ''));
    if (set.has(ch)) set.delete(ch);
    else set.add(ch);
    v[lang] = Array.from(set).join('');
    await browser.storage.local.set({ known: v });
    return set.has(ch);
  }

  function toggleReadings() {
    const t = active();
    const lang = t ? t.lang : '';
    let patch = null;
    const which = { ja: ['furigana', 'Furigana'], zh: ['pinyin', 'Pinyin'], ko: ['hanja', 'Hanja'] }[lang];
    if (!which) {
      showToast('Readings are shown over Japanese kanji (furigana), Chinese characters (pinyin) and Sino-Korean words (hanja).');
      return;
    }
    patch = { [which[0]]: !settings[which[0]] };
    Object.assign(settings, patch);
    post({ type: 'saveSettings', patch });
    showToast(`${which[1]} ${settings[which[0]] ? 'on' : 'off'} (R).`);
    refreshLine();
  }

  async function lineContext(ctx) {
    let show = '';
    try {
      show = SG.episode.describe(await currentEpisode());
    } catch (e) {
      /* the line is still worth saving without the show's name */
    }
    const song = listenMode() && listenNp ? listenNp : null;
    if (song) show = `${song.track}${song.artist ? ' — ' + song.artist : ''}`;
    const frame = song ? null : await saveFrame();
    return {
      sentence: ctx.sentence, translation: ctx.translation || '', show, url: tabUrl || location.href,
      time: Math.max(0, Math.round((ctx.time || 0) * 10) / 10), savedAt: Date.now(), frame: frame ? frame.id : undefined,
      art: song && song.art ? song.art : undefined, song: song ? true : undefined,
    };
  }

  async function wordItem(w, ctx) {
    return {
      kind: 'word', lang: ctx.lang, text: w.d || w.s,
      word: { s: w.s, r: w.r, f: SG.ruby.segmentsFor(w, ctx.lang), d: w.d, dr: w.dr || '', pos: w.pos, m: w.m, p: w.p, n: w.n, g: formsOf(w) },
      context: await lineContext(ctx),
    };
  }

  // A star that saves (or removes) a word or character, showing whether it is already saved.
  function starButton(kind, lang, text, makeItem) {
    const key = [kind, lang, text].join('|');
    const b = h('button', 'sg-star');
    const draw = (on) => {
      b.textContent = '';
      b.append(SG.icon('star', { size: 18, fill: on }));
    };
    draw(false);
    b.title = 'Save to your word bank';
    request({ type: 'bankStatus', keys: [key] }).then((res) => {
      if (res.status && res.status[key]) {
        draw(true);
        b.classList.add('sg-saved');
        b.title = 'Saved · click to remove';
      }
    });
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (b.classList.contains('sg-saved')) {
        await request({ type: 'bankRemove', key });
        draw(false);
        b.classList.remove('sg-saved');
        b.title = 'Save to your word bank';
        return;
      }
      const res = await request({ type: 'bankSave', item: await makeItem() });
      if (res.error) {
        showToast(res.error);
        return;
      }
      draw(true);
      b.classList.add('sg-saved');
      b.title = 'Saved · click to remove';
    });
    return b;
  }

  function renderCharEntry(el, ch, ctx, w, e) {
    el.classList.remove('sg-loading', 'sg-guide');
    el.textContent = '';
    const lang = ctx.lang;
    const box = h('div', 'sg-ce');
    const head = h('div', 'sg-ce-head');
    head.append(h('span', 'sg-ce-char', ch));
    const reads = h('div', 'sg-ce-reads');
    for (const r of e.readings || []) {
      const one = h('span', 'sg-ce-read sg-ce-' + r.kind, r.r);
      one.title = r.use || '';
      reads.append(one);
    }
    head.append(reads);
    const known1 = h('button', 'sg-btn sg-ce-known' + (known[lang].has(ch) ? ' sg-on' : ''), known[lang].has(ch) ? '✓ Known' : 'Mark known');
    known1.title = lang === 'ja' ? 'Known kanji get no furigana' : 'Known characters get no pinyin (if that option is on)';
    known1.addEventListener('click', async () => {
      const now = await toggleKnown(ch, lang);
      known1.textContent = now ? '✓ Known' : 'Mark known';
      known1.classList.toggle('sg-on', now);
    });
    head.append(known1, starButton('char', lang, ch, async () => ({ kind: 'char', lang, text: ch, entry: e, context: await lineContext(ctx), from: w.s })));
    box.append(head);
    if (e.meanings && e.meanings.length) box.append(h('div', 'sg-ce-mean', e.meanings.join('; ')));
    if (e.here) box.append(h('div', 'sg-ce-here', e.here));
    box.append(strokeBlock(ch, lang));
    if (e.parts && e.parts.length) {
      box.append(h('div', 'sg-g-h', 'Built from'));
      const parts = h('div', 'sg-ce-parts');
      e.parts.forEach((p, i) => {
        if (i) parts.append(h('span', 'sg-plus', '+'));
        const part = h('span', 'sg-ce-part');
        part.append(h('span', 'sg-ce-pc sg-c' + (i % 5), p.c), h('span', 'sg-ce-pg', p.g));
        parts.append(part);
      });
      box.append(parts);
      if (e.build) box.append(h('div', 'sg-g-p', e.build));
    }
    if (e.readings && e.readings.some((r) => r.use)) {
      box.append(h('div', 'sg-g-h', 'Readings'));
      for (const r of e.readings) box.append(h('div', 'sg-g-li', `${r.r} — ${r.use}`));
    }
    if (e.words && e.words.length) {
      box.append(h('div', 'sg-g-h', 'Words with it'));
      for (const x of e.words) {
        const row = h('div', 'sg-g-li');
        row.append(h('span', 'sg-g-ex', x.w), h('span', 'sg-ce-wr', ' ' + (x.r || '')), h('span', 'sg-g-ext', ' — ' + x.m));
        box.append(row);
      }
    }
    if (e.notes && e.notes.length) {
      box.append(h('div', 'sg-g-h', 'Notes'));
      for (const n of e.notes) box.append(h('div', 'sg-g-li', n));
    }
    el.append(box);
  }

  const charCache = new Map();

  async function showCharEntry(el, ch, ctx, w) {
    el.classList.add('sg-show');
    const k = ctx.lang + '|' + ch;
    if (charCache.has(k)) {
      renderCharEntry(el, ch, ctx, w, charCache.get(k));
      return;
    }
    el.classList.remove('sg-guide');
    el.textContent = '';
    // While Claude writes the full entry, the dictionary's facts show straight away.
    if (ctx.lang === 'ja') {
      const quick = await request({ type: 'kanjiQuick', ch, lang: 'ja' });
      const k2 = quick && quick.info;
      if (k2 && !charCache.has(k)) {
        const box = h('div', 'sg-pop-dict');
        const top = h('div', 'sg-dict-head');
        top.append(h('span', 'sg-dict-w', ch), h('span', 'sg-dict-r', [k2.on.join('・'), k2.kun.join('・')].filter(Boolean).join(' / ')), h('span', 'sg-dict-src', 'KANJIDIC'));
        box.append(top, h('div', 'sg-dict-s', k2.m.join('; ')));
        const facts = [k2.st ? `${k2.st} strokes` : '', k2.g ? (k2.g <= 6 ? `grade ${k2.g}` : 'jōyō (secondary school)') : '', k2.j ? `old JLPT ${k2.j}` : ''].filter(Boolean).join(' · ');
        if (facts) box.append(h('div', 'sg-dict-pos', facts));
        el.append(box);
      }
    }
    const waiting = h('div', 'sg-loading', `Writing an entry for ${ch}… (saved once written)`);
    el.append(waiting);
    const res = await request({ type: 'charInfo', ch, lang: ctx.lang, word: w.s, reading: w.r, sentence: ctx.sentence });
    if (res.error) {
      el.classList.remove('sg-loading');
      el.textContent = res.error;
      return;
    }
    charCache.set(k, res.entry);
    if (el.isConnected) renderCharEntry(el, ch, ctx, w, res.entry);
  }

  function seekIfPending() {
    if (pendingSeek == null || !video || video.readyState < 1) return;
    if (Number.isFinite(video.duration) && video.duration < pendingSeek) return;
    video.currentTime = Math.max(0, pendingSeek - 1.5);
    pendingSeek = null;
    post({ type: 'seekDone' });
  }

  // ------------------------------------------------------------ timing nudge

  // d: seconds to add to the shift (negative = earlier), or null to reset.
  function nudgeOffset(d) {
    const t = active();
    if (!t) return;
    t.offset = d == null ? 0 : Math.round((t.offset + d) * 100) / 100;
    t.userOffset = true;
    const label = (t.offset >= 0 ? '+' : '') + t.offset.toFixed(2) + 's';
    if (ui) ui.panel.offset.textContent = label;
    rememberOffset(t);
    shownKey = null;
    tick();
    showToast(t.offset === 0 ? 'Subtitle timing reset.' : `Subtitles ${t.offset < 0 ? 'earlier' : 'later'} by ${Math.abs(t.offset).toFixed(2)} s.  [ earlier · ] later · Shift for 1 s · \\ resets`);
  }

  // ------------------------------------------------------------ pitch accent

  const pitchCache = new Map();

  function pitchBlock(w) {
    const box = h('div', 'sg-pitch');
    const key = (w.d || w.s) + '|' + (w.r || '');
    const draw = (res) => {
      if (!res) return;
      const reading = w.s !== w.d && w.d ? '' : w.r;
      const kana = res.r || reading;
      box.append(h('span', 'sg-pitch-l', w.d && w.d !== w.s ? `Pitch (${w.d})` : 'Pitch'));
      res.a.slice(0, 2).forEach((acc) => box.append(SG.pitch.render(kana, acc)));
    };
    if (pitchCache.has(key)) draw(pitchCache.get(key));
    else {
      request({ type: 'pitch', items: [{ d: w.d, r: w.r, s: w.s }] }).then((res) => {
        const r = res.results && res.results[0];
        pitchCache.set(key, r || null);
        draw(r);
      });
    }
    return box;
  }

  // ------------------------------------------------------- ask about a line

  const askThreads = new Map(); // line key -> [{ q, a }]
  const askTargets = new Map(); // reqId -> { el, text, turn }

  const lessonTargets = new Map(); // reqId -> { el, turn } for the lesson that follows an answer

  // Under an answer: the lesson in it, with one click to add it to the guides it belongs to, and an
  // offer to write a guide when one is missing or was asked for.
  function showLesson(t, msg) {
    const ctx = t.ctx || {};
    if (!msg.lesson && !msg.guide) return;
    const box = h('div', 'sg-lesson');
    if (msg.lesson) box.append(h('div', 'sg-lesson-t', msg.lesson));
    const row = h('div', 'sg-d-forms');
    for (const target of msg.targets || []) {
      const chip = h('button', 'sg-form', 'Add to ' + (target.name || target.d) + ' guide');
      chip.title = 'Keep this point in that guide, under "From your questions"';
      const add = async () => {
        chip.disabled = true;
        const res = await request({ type: 'addNote', k: target.key, note: { text: msg.lesson, sentence: ctx.sentence || '', q: t.turn ? t.turn.q : '' } });
        chip.textContent = (res.where === 'guide' ? 'Added to ' : 'Saved for ') + (target.name || target.d) + ' ✓';
        chip.classList.add('sg-saved');
        deepTexts.delete(guideCacheKey({ k: target.key }));
      };
      chip.addEventListener('click', add);
      row.append(chip);
      if (settings.autoAddNotes && msg.lesson) add();
    }
    if (msg.guide && msg.guide.key) {
      const g = msg.guide;
      const make = ih('button', 'sg-form sg-form-word', g.kind === 'grammar' ? 'book-open' : 'wand-sparkles', (g.kind === 'grammar' ? 'Guide to ' : 'Make a guide for ') + (g.name || g.d), 13);
      make.addEventListener('click', () => {
        const lang = ctx.lang || 'ja';
        if (g.kind === 'grammar') openPanelGuide({ k: g.key, name: g.name || g.d }, ctx, { s: g.d, m: '' });
        else if (g.kind === 'phrase') {
          const p = { d: g.d, r: '', kind: 'set phrase', m: '', k: g.key };
          openPanelGuide(phraseGuideForm(p, lang), ctx, phraseAsWord(p), true);
        } else openPanelGuide(wordGuideForm({ s: g.d, d: g.d }, lang), ctx, { s: g.d, d: g.d, m: '' }, true);
      });
      row.append(make);
    }
    if (row.childElementCount) box.append(row);
    t.el.after(box);
  }

  function askBox(cue, a) {
    const key = shownKey;
    const wrap = h('div', 'sg-ask');
    const thread = h('div', 'sg-ask-thread');
    const turns = askThreads.get(key) || [];
    const addTurn = (turn) => {
      const q = h('div', 'sg-ask-q', turn.q);
      const ans = h('div', 'sg-ask-a', turn.a || '…');
      thread.append(q, ans);
      return ans;
    };
    turns.forEach(addTurn);
    // Questions asked about this line before (in earlier sessions) come back under it.
    if (!askThreads.has(key)) {
      request({ type: 'qaForLine', sentence: cue.text }).then((res) => {
        const saved = (res && res.list) || [];
        if (!saved.length || askThreads.has(key)) return;
        const list = saved.map((x) => ({ q: x.q, a: x.a, saved: true }));
        askThreads.set(key, list);
        thread.textContent = '';
        list.forEach(addTurn);
      });
    }
    const form = h('div', 'sg-ask-form');
    const input = h('textarea', 'sg-in sg-ask-in');
    input.rows = 1;
    input.placeholder = 'Ask about this line…';
    input.title = 'For example: why は and not が here? Could I say this to my boss?';
    const grow = () => wrap.classList.toggle('sg-ask-open', (ui && ui.host.shadowRoot.activeElement === input) || Boolean(input.value) || thread.childElementCount > 0);
    input.addEventListener('focus', () => wrap.classList.add('sg-ask-open'));
    input.addEventListener('blur', () => setTimeout(grow, 0));
    const go = h('button', 'sg-btn sg-go', 'Ask');
    const send = async () => {
      const question = input.value.trim();
      if (!question) return;
      // The scene goes with the first question about a line (kept with it; sent to Claude only if allowed).
      const firstTurn = !(askThreads.get(key) || []).length;
      const frame = firstTurn ? await saveFrame() : null;
      if (frame) askImages.set(key, frame.data);
      input.value = '';
      const t = active();
      const idx = shownIndex;
      const turn = { q: question, a: '' };
      const list = askThreads.get(key) || [];
      const history = list.filter((x) => x.a).map((x) => ({ q: x.q, a: x.a }));
      list.push(turn);
      askThreads.set(key, list);
      const ansEl = addTurn(turn);
      ansEl.classList.add('sg-loading');
      const reqId = 'q' + ++reqSeq;
      askTargets.set(reqId, { el: ansEl, text: '', turn, ctx: { sentence: cue.text, lang: langCode(a.lang), translation: a.tr } });
      post({
        type: 'ask', reqId, question, history,
        sentence: cue.text, translation: a.tr,
        words: (a.w || []).map((w) => `${w.s} = ${w.m}`).join('; '),
        phrases: (a.phrases || []).filter((p) => p && p.d).map((p) => `${p.d} = ${p.m}`).join('; '),
        forms: (a.w || []).flatMap((w) => formsOf(w)).map((f) => `${f.k} = ${f.name}`).join('; '),
        before: t ? t.cues.slice(Math.max(0, idx - 3), idx).map((c) => c.text) : [],
        after: t ? t.cues.slice(idx + 1, idx + 3).map((c) => c.text) : [],
        show: tabTitle || '',
        episode: t && t.episode ? t.episode : null,
        lang: a.lang || '',
        url: tabUrl || location.href,
        time: video ? Math.round(video.currentTime * 10) / 10 : null,
        frame: frame ? frame.id : undefined,
        image: settings.sceneToClaude ? askImages.get(key) : undefined,
      });
    };
    go.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    form.append(input, go);
    wrap.append(thread, form);
    if (turns.length) wrap.classList.add('sg-ask-open');
    return wrap;
  }

  function onAsk(msg) {
    if (msg.type === 'askLesson') {
      const t = lessonTargets.get(msg.reqId);
      if (t) showLesson(t, msg);
      return;
    }
    const t = askTargets.get(msg.reqId);
    if (!t) return;
    if (msg.type === 'askDone') lessonTargets.set(msg.reqId, t);
    t.el.classList.remove('sg-loading');
    if (msg.type === 'askDelta') {
      t.text += msg.delta;
      t.el.textContent = t.text;
    } else if (msg.type === 'askDone') {
      t.turn.a = msg.text;
      t.el.textContent = msg.text;
      askTargets.delete(msg.reqId);
    } else {
      t.el.textContent = msg.message;
      askTargets.delete(msg.reqId);
    }
  }

  // ---------------------------------------------- how much of the episode you know

  const coverage = new Map(); // track id -> { pct, known, total }

  function computeCoverage(words, lang) {
    let total = 0;
    let knownN = 0;
    for (const x of words) {
      total += x.count || 1;
      if (knownWords[lang] && knownWords[lang].has(x.d)) knownN += x.count || 1;
    }
    return { pct: total ? Math.round((knownN / total) * 100) : 0, total, known: knownN };
  }

  // --------------------------------------------------------- time watched

  let watchedSecs = 0;
  let watchedLast = null;

  // A small picture of the scene: straight from the video where the page allows it, else a screenshot of
  // the tab cropped to the video (copy-protected video comes out black either way).
  async function captureFrame() {
    if (!video || settings.sceneFrames === false || video.tagName !== 'VIDEO') return null;
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const c = document.createElement('canvas');
        c.width = 360;
        c.height = Math.round((360 * vh) / vw);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.65); // throws when the video comes from another site
      }
    } catch (e) {
      /* fall back to a screenshot of the tab */
    }
    const rect = window === window.top ? video.getBoundingClientRect() : null;
    const was = ui ? ui.host.style.visibility : '';
    if (ui) ui.host.style.visibility = 'hidden';
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const got = await request({ type: 'frameCapture', rect: rect && { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, dpr: devicePixelRatio || 1 });
    if (ui) ui.host.style.visibility = was;
    return got && got.data ? got.data : null;
  }
  async function saveFrame() {
    const data = await captureFrame().catch(() => null);
    if (!data) return null;
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    post({ type: 'frameSave', id, data });
    return { id, data };
  }

  // Each minute of watching with subtitles in a language you're learning, the episode is noted with the
  // lines seen so far (for the Library's recap and lesson) and, once, a frame from a few minutes in.
  let episodeNoteAt = 0;
  const episodeFramed = new Set();
  async function noteEpisode(t) {
    if (Date.now() - episodeNoteAt < 60000 || t.source === 'lyrics' || listenMode()) return;
    if (t.lang === langCode(settings.nativeLang)) return;
    episodeNoteAt = Date.now();
    const ep = await currentEpisode().catch(() => null);
    if (!ep || !ep.title || !SG.episode.confident(ep)) return;
    const reachedIndex = findCue(t.cues, video.currentTime - t.offset);
    let frame = null;
    const fk = SG.episode.key(ep, '');
    if (!episodeFramed.has(fk) && video.currentTime > 150) {
      episodeFramed.add(fk);
      frame = await captureFrame().catch(() => null);
    }
    post({
      type: 'episodeSeen', episode: ep, lang: t.lang, url: tabUrl || location.href, watched: Math.round(video.currentTime),
      lines: t.cues.map((c) => c.text), reachedIndex: reachedIndex >= 0 ? reachedIndex : t.cues.findIndex((c) => c.start > video.currentTime - t.offset) - 1, frame,
    });
  }

  // About once every 75 seconds of watching, a small frame with the line on screen goes with the episode,
  // so its lesson can show and talk about the scene.
  let frameAt = 0;
  async function frameForLesson(t) {
    if (settings.sceneFrames === false || listenMode() || t.source === 'lyrics' || t.lang === langCode(settings.nativeLang)) return;
    if (video.currentTime - frameAt < 75 && video.currentTime >= frameAt) return;
    frameAt = video.currentTime;
    const idx = findCue(t.cues, video.currentTime - t.offset);
    if (idx < 0) return; // only moments with a line on screen
    const ep = await currentEpisode().catch(() => null);
    if (!ep || !SG.episode.confident(ep)) return;
    const data = await captureFrame().catch(() => null);
    if (data) post({ type: 'episodeFrame', episode: ep, time: video.currentTime, idx, line: t.cues[idx].text, data });
  }

  function trackWatching() {
    const t = active();
    if (!video || video.paused || !t) {
      watchedLast = null;
      return;
    }
    noteEpisode(t);
    frameForLesson(t);
    const now = video.currentTime;
    if (watchedLast != null && now > watchedLast && now - watchedLast < 3) watchedSecs += now - watchedLast;
    watchedLast = now;
    if (watchedSecs >= 60) {
      post({ type: 'watched', lang: t.lang, minutes: Math.floor(watchedSecs / 60) });
      watchedSecs %= 60;
    }
  }

  // --------------------------------------------------------- subtitle sites

  function request(msg) {
    return new Promise((resolve) => {
      const reqId = 's' + ++reqSeq;
      subReqs.set(reqId, resolve);
      if (!post(Object.assign({ reqId }, msg))) {
        subReqs.delete(reqId);
        resolve({ error: 'Langtitles lost its connection; reload the page.' });
      }
    });
  }

  async function currentEpisode() {
    const res = await request({ type: 'tabInfo' });
    if (res.info) {
      tabUrl = res.info.url || tabUrl;
      tabTitle = res.info.title || tabTitle;
    }
    // In a player frame, the page around it names the show better than the frame's own title
    // (often a file name), so the tab comes first.
    const inFrame = window !== window.top;
    const sources = [];
    if (inFrame && tabUrl) sources.push({ url: tabUrl, title: tabTitle });
    sources.push({ url: location.href, title: document.title });
    if (document.referrer) sources.push({ url: document.referrer, title: '' });
    // Players are often frames inside frames; the episode can be in any of their addresses.
    for (const f of (res.info && res.info.frames) || []) {
      if (f !== location.href && f !== tabUrl) sources.push({ url: f, title: '' });
    }
    if (!inFrame && tabUrl && tabUrl !== location.href) sources.push({ url: tabUrl, title: tabTitle });
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) sources.push({ url: '', title: og.content });
    const ep = SG.episode.detect(sources);
    lastSiteTitle = ep.title || '';
    // A show you've saved, recognised by the name this site gives it (Monster on animepahe -> your Monster).
    if (!ep.tmdbId && !ep.imdbId && !ep.jimakuId) {
      const saved = (await request({ type: 'matchShow', episode: ep })).entry;
      if (saved) {
        for (const k of ['tmdbId', 'imdbId', 'jimakuId', 'type', 'year']) if (saved[k] && !ep[k]) ep[k] = saved[k];
        ep.title = saved.title || ep.title;
        if (ep.type === 'tv' && ep.episode != null && ep.season == null) ep.season = 1;
      }
    }
    // A show picked by hand on this page fills in what the addresses do not say.
    const pick = await showPickFor();
    if (pick) {
      // Picks are saved per page (the page address names the show), so a pick without ids of its
      // own, such as a Jimaku entry, belongs to this page's show too.
      const sameShow = (!pick.tmdbId && !pick.imdbId) || (!ep.tmdbId && !ep.imdbId)
        || (pick.tmdbId && pick.tmdbId === ep.tmdbId) || (pick.imdbId && pick.imdbId === ep.imdbId);
      if (sameShow) {
        for (const k of ['tmdbId', 'imdbId', 'jimakuId', 'type']) if (pick[k] && !ep[k]) ep[k] = pick[k];
        if (pick.title) ep.title = pick.title;
        if (ep.type === 'tv' && ep.episode != null && ep.season == null) ep.season = 1;
      }
    }
    return ep;
  }

  // The show picked by hand is remembered per page, without the episode in the address,
  // so every episode of that show on this site uses it.
  function pageKey() {
    try {
      const u = new URL(tabUrl || location.href);
      for (const k of ['season', 'episode', 's', 'e', 'ep', 'seasonId', 'episodeId', 'season_number', 'episode_number', 'server', 't']) u.searchParams.delete(k);
      return u.origin + u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '');
    } catch (e) {
      return '';
    }
  }

  async function showPickFor() {
    const k = pageKey();
    if (!k) return null;
    const r = await browser.storage.local.get('showPicks');
    return (r.showPicks || {})[k] || null;
  }

  let lastSiteTitle = '';
  async function saveShowPick(show) {
    request({ type: 'pickShow', show, siteTitle: lastSiteTitle, lang: wantedLangs()[0] });
    const k = pageKey();
    if (!k) return;
    const r = await browser.storage.local.get('showPicks');
    const all = r.showPicks || {};
    all[k] = { tmdbId: show.tmdbId || null, imdbId: show.imdbId || null, jimakuId: show.jimakuId || null, type: show.type, title: show.title, savedAt: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 300) delete all[keys.sort((a, b) => all[a].savedAt - all[b].savedAt)[0]];
    await browser.storage.local.set({ showPicks: all });
  }

  function wantedLangs() {
    const native = langCode(settings.nativeLang);
    const list = (settings.learning || []).map(langCode).filter((l) => l && l !== 'und' && l !== native);
    return list.length ? list : ['ja'];
  }

  function hasLearningTrack() {
    const langs = wantedLangs();
    for (const t of tracks.values()) if (t.source !== 'dom' && langs.includes(t.lang) && t.cues.length >= 5) return true;
    return false;
  }

  function sourceName(id) {
    return { opensubtitles: 'OpenSubtitles', subdl: 'SubDL', jimaku: 'Jimaku' }[id] || id;
  }

  // Lines a downloaded file up against the site's own subtitles, if there are any.
  function syncRemote(t, announce) {
    let ref = null;
    for (const r of tracks.values()) {
      if (r === t || r.source === 'remote' || r.source === 'file' || r.cues.length < 15) continue;
      if (!ref || r.cues.length > ref.cues.length) ref = r;
    }
    if (!ref) {
      if (announce) showToast('No other subtitles on this page to line the file up with. If the timing is off, use − / + in the panel (Shift for 2 s steps).');
      return false;
    }
    const res = SG.sync.align(ref.cues.map((c) => ({ start: c.start + ref.offset })), t.cues);
    if (!res.ok) {
      if (announce) showToast(`Could not line the file up with the ${langName(ref.lang)} subtitles. If the timing is off, use − / + in the panel.`);
      return false;
    }
    if (res.scale !== 1) {
      t.cues = t.cues.map((c) => ({ start: c.start * res.scale, end: c.end * res.scale, text: c.text }));
    }
    t.offset = res.offset;
    t.synced = true;
    rememberOffset(t, res.scale);
    shownKey = null;
    if (t.id === activeId) {
      renderTranscript();
      renderTrackList();
    }
    if (announce !== false) {
      const shift = Math.abs(res.offset) < 0.05 ? 'already in time' : `shifted ${res.offset > 0 ? '+' : ''}${res.offset.toFixed(2)} s`;
      showToast(`Timing matched to the site's ${langName(ref.lang)} subtitles (${shift}${res.scale !== 1 ? ', frame rate corrected' : ''}).`);
    }
    return true;
  }

  // The Song section (Listen mode): what's playing, where the lyrics came from, finding other lyrics,
  // pasting your own, the lyrics-sheet size, sing-along view and the song guide.
  function renderSong() {
    if (!ui) return;
    const box = ui.panel.songBox;
    box.textContent = '';
    if (!listenMode()) return;
    const np = listenNp;
    const now = h('div', 'sg-song-now');
    if (np && np.art) {
      const img = h('img', 'sg-song-art');
      img.src = np.art;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      now.append(img);
    }
    const names = h('div', 'sg-song-names');
    names.append(h('div', 'sg-song-track', np ? np.track : 'Nothing playing yet'), h('div', 'sg-song-artist', np ? [np.artist, np.album].filter(Boolean).join(' · ') : 'Play a song and its lyrics load here.'));
    now.append(names);
    box.append(now);
    if (listenNote) box.append(h('div', 'sg-song-note', listenNote));
    const cov = h('div', 'sg-scov');
    ui.panel.songCov = cov;
    if (active() && active().source === 'lyrics') {
      box.append(h('div', 'sg-section', 'Your coverage'), cov);
      paintSongCoverage();
    }
    if (ui.lyrArt) ui.lyrArt.style.backgroundImage = np && np.art ? `url("${np.art.replace(/"/g, '%22')}")` : '';

    // Sheet size and sing-along
    const look = h('div', 'sg-song-look');
    const sizes = h('div', 'sg-studyseg');
    for (const [k, label] of [['strip', 'Strip'], ['sheet', 'Sheet'], ['focus', 'Focus']]) {
      const b = h('button', 'sg-seg-b' + ((settings.lyricsSize || 'sheet') === k ? ' sg-on' : ''), label);
      b.title = { strip: 'One line along the bottom of the page', sheet: 'Lyrics docked at the side', focus: 'Big lyrics over the whole page' }[k];
      b.addEventListener('click', () => {
        settings.lyricsSize = k;
        savePatch({ lyricsSize: k });
        place();
        renderSong();
      });
      sizes.append(b);
    }
    const sing = h('label', 'sg-f-check');
    const singIn = h('input');
    singIn.type = 'checkbox';
    singIn.checked = Boolean(settings.singAlong);
    singIn.addEventListener('change', () => {
      settings.singAlong = singIn.checked;
      savePatch({ singAlong: singIn.checked });
      applySettings();
    });
    sing.append(singIn, document.createTextNode(' Sing-along view (readings only, bigger)'));
    const gaps = h('label', 'sg-f-check');
    const gapsIn = h('input');
    gapsIn.type = 'checkbox';
    gapsIn.checked = Boolean(settings.lyricGaps);
    gapsIn.addEventListener('change', () => {
      settings.lyricGaps = gapsIn.checked;
      savePatch({ lyricGaps: gapsIn.checked });
      applySettings();
    });
    gaps.append(gapsIn, document.createTextNode(' Fill the gaps: hide words you don\'t know yet; hover or tap one to check yourself'));
    look.append(sizes, sing, gaps);
    box.append(h('div', 'sg-section', 'Lyrics view'), look);

    // Tap to sync: lyrics without timings get them from you, one tap per line.
    const t = active();
    if (t && t.source === 'lyrics' && t.cues.some((c) => c.unsynced)) {
      box.append(h('div', 'sg-section', 'Timing'));
      box.append(h('div', 'sg-note', 'These lyrics have no timings. Press Tap to sync (the song restarts), then tap the button or press T as each line starts. The timings are saved for this song.'));
      const tapBtn = h('button', 'sg-btn sg-go', 'Tap to sync');
      tapBtn.addEventListener('click', () => startTapSync(t));
      box.append(tapBtn);
    }

    // Song guide
    if (np && t && t.source === 'lyrics') {
      box.append(h('div', 'sg-section', 'Song guide'));
      const gBody = h('div', 'sg-song-guide');
      const gBtn = ih('button', 'sg-btn', 'book-open', ' Write the song guide', 15);
      gBtn.classList.add('sg-song-guide-btn');
      box.append(h('div', 'sg-note sg-song-guide-about', 'Every lyric, line by line, then what you might miss: subtext, wordplay, references and how to read the story. Written once, kept in your Library.'));
      gBtn.addEventListener('click', () => {
        gBtn.remove();
        gBody.textContent = 'Writing the guide… It goes through every line, so a long or layered song takes a minute or two. It is written once and kept in your Library.';
        const reqId = 'sg' + ++reqSeq;
        songGuideTargets.set(reqId, gBody);
        // Every line in order (repeats included, so the guide can say what a returning chorus means by then).
        post({ type: 'songGuide', reqId, track: np.track, artist: np.artist, album: np.album, art: np.art, url: np.url, lang: t.lang, lyrics: t.cues.map((c) => c.text) });
      });
      box.append(gBtn, gBody);
    }

    // Find other lyrics
    box.append(h('div', 'sg-section', 'Find lyrics'));
    const q = h('input', 'sg-in');
    q.type = 'search';
    q.placeholder = 'Artist and song';
    q.value = np ? [np.artist, np.track].filter(Boolean).join(' ') : '';
    q.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') go.click();
    });
    const go = h('button', 'sg-btn', 'Search');
    const row = h('div', 'sg-song-search');
    row.append(q, go);
    const results = h('div', 'sg-song-results');
    go.addEventListener('click', async () => {
      if (!q.value.trim()) return;
      results.textContent = 'Searching LRCLIB…';
      const res = await request({ type: 'lyricsSearch', q: q.value.trim(), np: np || {} });
      results.textContent = '';
      if (res.error) return results.append(h('div', 'sg-note', res.error));
      if (!res.list || !res.list.length) return results.append(h('div', 'sg-note', 'Nothing found. Try fewer words, or paste the lyrics below.'));
      for (const x of res.list) {
        const b = h('button', 'sg-song-hit' + (x.near ? ' sg-near' : ''));
        const len = x.duration ? `${Math.floor(x.duration / 60)}:${String(Math.round(x.duration % 60)).padStart(2, '0')}` : '';
        b.append(h('span', 'sg-song-hit-t', x.track), h('span', 'sg-song-hit-a', [x.artist, x.album, len].filter(Boolean).join(' · ')), h('span', 'sg-song-hit-b', x.instrumental ? 'instrumental' : x.synced ? 'timed' : x.plain ? 'not timed' : ''));
        b.title = x.near ? 'Same length as the song playing' : '';
        b.addEventListener('click', async () => {
          const got = await request({ type: 'lyricsUse', id: x.id, np: np || { track: x.track, artist: x.artist } });
          if (got.track) useLyrics(got, 'manual');
          else showToast(got.error || 'Could not load those lyrics.');
        });
        results.append(b);
      }
    });
    box.append(row, results);

    // Paste your own (LRC with timings, or plain text)
    const paste = h('details', 'sg-song-paste');
    paste.append(h('summary', '', 'Paste lyrics or load an .lrc file'));
    const ta = h('textarea', 'sg-in');
    ta.rows = 5;
    ta.placeholder = '[00:12.30] first line\n[00:15.80] second line\n\n(or plain lyrics without times)';
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    const use = h('button', 'sg-btn sg-go', 'Use these lyrics');
    use.addEventListener('click', async () => {
      if (!ta.value.trim() || !np) return;
      const got = await request({ type: 'lyricsOwn', text: ta.value, np });
      if (got.track) useLyrics(got, 'manual');
      else showToast(got.error || 'Could not read those lyrics.');
    });
    const lrc = h('input');
    lrc.type = 'file';
    lrc.accept = '.lrc,.txt';
    lrc.style.display = 'none';
    lrc.addEventListener('change', async () => {
      const f = lrc.files[0];
      if (f) ta.value = await f.text();
    });
    const lrcBtn = h('button', 'sg-btn sg-ghost', 'Load .lrc');
    lrcBtn.addEventListener('click', () => lrc.click());
    const btns = h('div', 'sg-row-btns');
    btns.append(use, lrcBtn, lrc);
    paste.append(ta, btns);
    box.append(paste);
    box.append(h('div', 'sg-note', 'Lyrics come from LRCLIB, a free community lyrics library. They are for your own study.'));
  }

  // Watch mode: the show's opening and ending songs (MyAnimeList via Jikan), each with a song guide
  // written from its lyrics, and a link to play it in YouTube Music, where Listen mode takes over.
  async function openShowSongs(box, btn) {
    const ep = await currentEpisode().catch(() => null);
    const title = (ep && (ep.title || ep.show)) || tabTitle || document.title;
    btn.disabled = true;
    const note = h('div', 'sg-note', `Looking up "${title}" on MyAnimeList…`);
    box.append(note);
    const res = await request({ type: 'showSongs', title });
    note.remove();
    btn.remove();
    if (res.error) return box.append(h('div', 'sg-note', res.error));
    if (!res.list || !res.list.length) return box.append(h('div', 'sg-note', `MyAnimeList lists no opening or ending songs for ${res.anime ? res.anime.title : title}.`));
    box.append(h('div', 'sg-note', `From MyAnimeList: ${res.anime.title}`));
    for (const x of res.list) {
      const row = h('div', 'sg-ss');
      const top = h('div', 'sg-ss-top');
      top.append(h('span', 'sg-ss-kind', `${x.kind}${res.list.filter((y) => y.kind === x.kind).length > 1 ? ' ' + x.n : ''}`));
      const names = h('div', 'sg-ss-names');
      names.append(h('div', 'sg-ss-t', x.track + (x.trackAlt ? ` · ${x.trackAlt}` : '')), h('div', 'sg-ss-a', [x.artistJa || x.artist, x.eps ? 'episodes ' + x.eps : ''].filter(Boolean).join(' · ')));
      top.append(names);
      row.append(top);
      const acts = h('div', 'sg-ss-acts');
      const play = h('a', 'sg-link', 'Listen in YouTube Music');
      play.href = 'https://music.youtube.com/search?q=' + encodeURIComponent(`${x.artistJa || x.artist} ${x.track}`);
      play.target = '_blank';
      play.rel = 'noopener';
      const guideBtn = h('button', 'sg-link', 'Song guide');
      const body = h('div', 'sg-song-guide');
      guideBtn.addEventListener('click', () => {
        guideBtn.remove();
        body.textContent = 'Finding the lyrics and writing the guide…';
        const reqId = 'sg' + ++reqSeq;
        songGuideTargets.set(reqId, body);
        post({ type: 'songGuideFor', reqId, track: x.track, artist: x.artistJa || x.artist, show: res.anime.title });
      });
      acts.append(guideBtn, play);
      row.append(acts, body);
      box.append(row);
    }
  }

  // Tap to sync: the viewer taps as each line starts; the result is saved as this song's LRC.
  let tapSync = null; // { t, i, times }
  function startTapSync(t) {
    if (!video || !listenNp) return;
    tapSync = { t, i: 0, times: [] };
    const bar = h('div', 'sg-tapsync');
    const label = h('div', 'sg-tapsync-l');
    const tap = h('button', 'sg-btn sg-go sg-tapsync-b', 'Tap: this line starts now (T)');
    const stop = h('button', 'sg-link', 'Stop and save');
    const update = () => {
      const next = t.cues[tapSync.i];
      label.textContent = next ? `Next: ${next.text}` : 'All lines timed.';
    };
    tapSync.mark = () => {
      if (!tapSync || tapSync.i >= t.cues.length) return;
      tapSync.times.push(video.currentTime);
      tapSync.i++;
      update();
      if (tapSync.i >= t.cues.length) tapSync.finish();
    };
    tapSync.finish = async () => {
      const done = tapSync;
      tapSync = null;
      bar.remove();
      if (!done.times.length) return;
      const fmt = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${(x % 60).toFixed(2).padStart(5, '0')}`;
      const lrc = done.t.cues.slice(0, done.times.length).map((c, i) => `[${fmt(done.times[i])}]${c.text}`).concat(done.t.cues.slice(done.times.length).map((c) => c.text)).join('\n');
      const got = await request({ type: 'lyricsOwn', text: lrc, np: listenNp });
      if (got.track) useLyrics(got, 'manual');
      showToast(`Saved timings for ${done.times.length} line${done.times.length === 1 ? '' : 's'}.`);
    };
    tap.addEventListener('click', () => tapSync && tapSync.mark());
    stop.addEventListener('click', () => tapSync && tapSync.finish());
    update();
    bar.append(label, tap, stop);
    ui.root.append(bar);
    video.currentTime = 0;
    if (video.paused) video.play().catch(() => {});
  }

  function rememberOffset(t, scale) {
    if (t.source === 'lyrics' && listenNp) {
      clearTimeout(offsetSaveTimer);
      offsetSaveTimer = setTimeout(() => request({ type: 'lyricsOffset', np: listenNp, offset: t.offset }), 800);
      return;
    }
    if (t.source !== 'remote' || !t.episode) return;
    clearTimeout(offsetSaveTimer);
    offsetSaveTimer = setTimeout(() => {
      post({ type: 'saveSubOffset', episode: t.episode, lang: t.lang, offset: t.offset, scale: scale || 1 });
    }, 800);
  }

  function useLoaded(loaded, ep, how) {
    const track = Object.assign({}, loaded.track, { episode: ep });
    if ((loaded.reused || loaded.usual) && loaded.offset != null) {
      track.offset = loaded.offset;
      track.userOffset = true;
    }
    tracks.delete(track.id);
    addTrack(track);
    const t = tracks.get(track.id);
    if (!t) return;
    if (how === 'manual') {
      manualPick = t.id;
      activeId = null;
      chooseActive();
    }
    const synced = t.userOffset ? false : syncRemote(t, false);
    const parts = [`${how === 'auto' ? 'Loaded' : 'Using'} ${langName(t.lang)} subtitles from ${sourceName(t.provider)}`];
    if (synced) parts.push(`timing matched to the site (${t.offset >= 0 ? '+' : ''}${t.offset.toFixed(2)} s)`);
    else if (loaded.reused && t.userOffset) parts.push('with the timing you set last time');
    if (loaded.usual) parts.push(`from this show's usual ${loaded.usual}`);
    let msg = parts.join(', ') + '.';
    if (how === 'auto') msg += ' Wrong file? Press G → Find subtitles.';
    if (loaded.note) msg += ' ' + loaded.note + '.';
    showToast(msg);
  }

  // When the site has no subtitles in a language being learned, fetch them from a subtitle site.
  // The subtitle file chosen before for this episode loads as soon as the page does (no waiting for playback).
  let savedPickTried = false;
  async function loadSavedPick() {
    if (savedPickTried || !video || hasLearningTrack() || !enabled()) return;
    savedPickTried = true;
    const ep = await currentEpisode().catch(() => null);
    if (!ep || !SG.episode.confident(ep)) return;
    const res = await request({ type: 'autoSubs', episode: ep, langs: wantedLangs(), savedOnly: true });
    if (res.loaded && res.loaded.track && !hasLearningTrack()) useLoaded(res.loaded, ep, 'auto');
  }

  async function maybeAutoFind() {
    loadSavedPick();
    if (autoBusy || !settings.autoFind || !enabled() || !settings.hasKey || !(settings.subProviders || []).length) return;
    if (!video || video.paused || playedFor < 6 || hasLearningTrack()) return;
    autoBusy = true;
    try {
      const ep = await currentEpisode();
      lastEpisode = ep;
      if (!SG.episode.confident(ep)) {
        if (!autoTried.has('undetected')) {
          autoTried.add('undetected');
          showToast("Langtitles can't tell which episode this is, so it hasn't searched the subtitle sites. Press G → Find subtitles to search by hand.");
          autoNote = 'episode not detected';
        }
        return;
      }
      const langs = wantedLangs();
      const key = SG.episode.key(ep, langs.join(','));
      if (autoTried.has(key)) return;
      autoTried.add(key);
      autoNote = 'searching';
      const res = await request({ type: 'autoSubs', episode: ep, langs });
      if (hasLearningTrack()) return; // the site's own subtitles turned up meanwhile
      autoNote = res.loaded && res.loaded.track ? 'loaded from ' + sourceName(res.loaded.track.provider) : res.error || ((res.loaded && res.loaded.errors && res.loaded.errors[0]) || 'nothing found');
      if (res.loaded && res.loaded.track) useLoaded(res.loaded, ep, 'auto');
      else if (res.loaded && res.loaded.searched) {
        const why = res.loaded.errors && res.loaded.errors.length ? ' (' + res.loaded.errors[0] + ')' : '';
        showToast(`No ${langs.map(langName).join(' / ')} subtitles found for ${SG.episode.describe(ep)}${why}. Press G → Find subtitles to search by hand.`);
      }
    } finally {
      autoBusy = false;
    }
  }

  function field(label, input) {
    const wrap = h('label', 'sg-f');
    wrap.append(h('span', 'sg-f-label', label), input);
    return wrap;
  }

  async function openFind() {
    const p = ui.panel;
    p.setTab('subs');
    const body = p.findBody;
    body.textContent = '';
    if (!(settings.subProviders || []).length) {
      body.append(h('div', 'sg-g-p', 'No subtitle sites are set up yet. Open the Langtitles options and add a free OpenSubtitles, SubDL or Jimaku key under “Subtitle sites”.'));
      return;
    }
    const ep = await currentEpisode();
    const form = h('div', 'sg-form-grid');
    const title = h('input', 'sg-in');
    title.value = ep.title || '';
    title.placeholder = 'Show or movie name';
    const type = h('select', 'sg-in');
    type.append(new Option('TV episode', 'tv'), new Option('Movie', 'movie'));
    type.value = ep.type || (ep.episode != null ? 'tv' : 'tv');
    const id = h('input', 'sg-in');
    id.value = ep.tmdbId || ep.imdbId || '';
    id.placeholder = 'TMDB or IMDb id (optional)';
    const season = h('input', 'sg-in sg-num');
    season.type = 'number';
    season.min = '0';
    season.value = ep.season == null ? (ep.type === 'movie' ? '' : '1') : ep.season;
    const episode = h('input', 'sg-in sg-num');
    episode.type = 'number';
    episode.min = '0';
    episode.value = ep.episode == null ? '' : ep.episode;
    const lang = h('select', 'sg-in');
    const langs = wantedLangs();
    for (const code of langs) lang.append(new Option(langName(code), code));
    for (const code of ['ja', 'ko', 'zh', 'th', 'vi', 'id', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'en']) {
      if (!langs.includes(code)) lang.append(new Option(langName(code), code));
    }
    const go = h('button', 'sg-btn sg-go', 'Search');
    let picked = ep.jimakuId ? { jimakuId: ep.jimakuId } : null;
    const findShow = h('button', 'sg-btn', 'Find the show');
    findShow.title = 'Search the subtitle sites for shows and movies with this title, then pick the right one';
    const shows = h('div', 'sg-results sg-shows');
    findShow.addEventListener('click', async () => {
      const text = title.value.trim();
      if (!text) {
        status.textContent = 'Type the title first, for example Monster (2004).';
        return;
      }
      shows.textContent = '';
      status.textContent = 'Looking for the show…';
      findShow.disabled = true;
      const res = await request({ type: 'findShows', title: text });
      findShow.disabled = false;
      if (res.error) {
        status.textContent = res.error;
        return;
      }
      const list = res.found.shows || [];
      const notes = Object.entries(res.found.report).filter(([, r]) => !r.ok).map(([, r]) => r.message);
      status.textContent = (list.length ? 'Pick the right one:' : 'No shows found with that title. Try the English or Japanese title.') + (notes.length ? ' ' + notes.join(' · ') : '');
      for (const s of list) {
        const row = h('button', 'sg-result');
        const top = h('div', 'sg-result-top');
        top.append(h('span', 'sg-result-name', `${s.title || s.original}${s.year ? ` (${s.year})` : ''}`), h('span', 'sg-result-lang', s.type === 'movie' ? 'movie' : 'TV'));
        const meta = [];
        if (s.original && s.original !== s.title) meta.push(s.original);
        meta.push(s.sources.join(' + '));
        const want = lang.value === 'zh' ? ['zh-CN', 'zh-TW', 'zh-cn', 'zh-tw'] : [lang.value];
        const n = want.reduce((a, k) => a + (Number(s.counts[k]) || 0), 0);
        if (Object.keys(s.counts).length) meta.push(`OpenSubtitles: ${n} ${langName(lang.value)}`);
        if (s.jimakuId) meta.push('Jimaku entry');
        if (s.imdbId) meta.push(s.imdbId);
        row.append(top, h('div', 'sg-result-meta', meta.join(' · ')));
        row.addEventListener('click', async () => {
          picked = s;
          title.value = s.title || s.original;
          type.value = s.type;
          id.value = s.tmdbId || s.imdbId || '';
          idTitle = id.value ? title.value.trim().toLowerCase() : null;
          toggleSeason();
          if (s.type === 'tv' && !season.value) season.value = '1';
          shows.textContent = '';
          await saveShowPick(s);
          status.textContent = `Using ${s.title || s.original}${s.year ? ` (${s.year})` : ''}. Remembered for this page.`;
          run();
        });
        shows.append(row);
      }
    });
    // The id belongs to the title it came with; typing a different title drops a stale id,
    // which would otherwise override the title (the "nothing comes up until I clear the id" problem).
    let idTitle = id.value ? title.value.trim().toLowerCase() : null;
    title.addEventListener('input', () => {
      picked = null;
      if (idTitle !== null && title.value.trim().toLowerCase() !== idTitle) {
        id.value = '';
        idTitle = null;
      }
    });
    id.addEventListener('input', () => {
      idTitle = id.value.trim() ? title.value.trim().toLowerCase() : null;
    });
    const titleRow = h('div', 'sg-title-row');
    titleRow.append(title, findShow);
    form.append(field('Title', titleRow), field('Type', type), field('ID', id), field('Season', season), field('Episode', episode), field('Language', lang));
    const status = h('div', 'sg-find-status');
    status.textContent = SG.episode.confident(ep) ? `Detected ${SG.episode.describe(ep)}.` : 'Check the title, season and episode, then search.';
    const results = h('div', 'sg-results');
    const usual = h('div', 'sg-usual');
    const mine = h('div', 'sg-myshows');
    body.append(mine, usual, form, go, status, shows, results);
    request({ type: 'myShows' }).then((res) => {
      const list = (res && res.list) || [];
      if (!list.length) return;
      mine.append(h('div', 'sg-section', 'My shows'));
      const row = h('div', 'sg-myshows-row');
      for (const sh of list.slice(0, 12)) {
        const b = h('button', 'sg-myshow');
        b.title = sh.title + (sh.year ? ` (${sh.year})` : '') + (sh.subs ? ' · subtitles: ' + sh.subs : '');
        if (sh.poster) {
          const img = h('img', 'sg-myshow-img');
          img.src = sh.poster;
          img.alt = '';
          img.referrerPolicy = 'no-referrer';
          b.append(img);
        } else b.append(h('span', 'sg-myshow-ph', (sh.title || '?').slice(0, 1)));
        b.append(h('span', 'sg-myshow-t', sh.title));
        b.addEventListener('click', () => {
          picked = sh;
          title.value = sh.title;
          type.value = sh.type || 'tv';
          id.value = sh.tmdbId || sh.imdbId || '';
          idTitle = id.value ? title.value.trim().toLowerCase() : null;
          toggleSeason();
          if (type.value === 'tv' && !season.value) season.value = '1';
          saveShowPick(sh);
          run();
        });
        // Remove from My shows (the subtitles and words saved from it stay).
        const cell = h('div', 'sg-myshow-cell');
        const del = ih('button', 'sg-myshow-del', 'x', '', 12);
        del.title = `Remove ${sh.title} from My shows`;
        del.setAttribute('aria-label', del.title);
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          await request({ type: 'removeShow', id: sh.id });
          cell.remove();
          if (!row.childElementCount) mine.textContent = '';
        });
        cell.append(b, del);
        row.append(cell);
      }
      mine.append(row);
    });
    request({ type: 'showChoice', episode: ep, langs: wantedLangs() }).then((res) => {
      const c = res && res.choice;
      if (!c) {
        usual.append(h('span', '', 'Pick a result below and it becomes this show\'s usual subtitles: later episodes load from the same site and group by themselves.'));
        return;
      }
      usual.classList.add('sg-on');
      usual.append(h('span', 'sg-usual-k', 'Usual subtitles for this show'), h('span', 'sg-usual-v', c.label));
      const forget = h('button', 'sg-btn sg-ghost', 'Forget');
      forget.title = 'Stop preferring these; the best search result is used again';
      forget.addEventListener('click', () => {
        post({ type: 'forgetShowChoice', episode: ep, langs: wantedLangs() });
        usual.textContent = '';
        usual.classList.remove('sg-on');
        usual.append(h('span', '', 'Forgotten. Pick a result below to set new usual subtitles.'));
      });
      usual.append(forget);
    });
    const toggleSeason = () => {
      const tv = type.value === 'tv';
      season.parentNode.style.display = tv ? '' : 'none';
      episode.parentNode.style.display = tv ? '' : 'none';
    };
    type.addEventListener('change', toggleSeason);
    toggleSeason();

    const run = async () => {
      const raw = id.value.trim();
      const query = {
        type: type.value,
        title: title.value.trim(),
        tmdbId: /^\d+$/.test(raw) ? raw : null,
        imdbId: /^tt\d+$/i.test(raw) ? raw.toLowerCase() : null,
        season: type.value === 'tv' && season.value !== '' ? Number(season.value) : null,
        episode: type.value === 'tv' && episode.value !== '' ? Number(episode.value) : null,
        year: (picked && picked.year) || ep.year,
        jimakuId: picked && picked.jimakuId ? picked.jimakuId : null,
      };
      if (!query.title && !query.tmdbId && !query.imdbId && !query.jimakuId) {
        status.textContent = 'Enter a title or an id.';
        return;
      }
      const wanted = [lang.value];
      status.textContent = 'Searching…';
      results.textContent = '';
      go.disabled = true;
      let res = await request({ type: 'findSubs', episode: query, langs: wanted });
      let viaTitle = false;
      // An id that finds nothing (wrong or stale) shouldn't hide results the title would find.
      if (!res.error && !res.found.results.length && (query.tmdbId || query.imdbId) && query.title) {
        const byTitle = Object.assign({}, query, { tmdbId: null, imdbId: null });
        const again = await request({ type: 'findSubs', episode: byTitle, langs: wanted });
        if (!again.error && again.found.results.length) {
          res = again;
          viaTitle = true;
        }
      }
      go.disabled = false;
      if (res.error) {
        status.textContent = res.error;
        return;
      }
      const found = res.found;
      const notes = Object.entries(found.report).map(([pid, r]) => {
        if (r.ok) return `${sourceName(pid)}: ${r.count}`;
        return r.message.startsWith(sourceName(pid)) ? r.message : `${sourceName(pid)}: ${r.message}`;
      });
      status.textContent = (viaTitle ? 'Nothing for that ID, so searched by title. ' : '') + (found.results.length ? `${found.results.length} found, best first. ` : 'Nothing found. Try the English title, or check the season and episode. ') + notes.join(' · ');
      for (const r of found.results) {
        const row = h('button', 'sg-result');
        const top = h('div', 'sg-result-top');
        top.append(h('span', 'sg-result-src', sourceName(r.provider)), h('span', 'sg-result-lang', langName(r.lang)), h('span', 'sg-result-name', r.name || '(no release name)'));
        const meta = [];
        if (r.title) meta.push(r.title);
        if (r.season != null && r.episode != null) meta.push(`S${String(r.season).padStart(2, '0')}E${String(r.episode).padStart(2, '0')}`);
        else if (r.episode != null) meta.push('episode ' + r.episode);
        if (r.pack) meta.push('season pack');
        if (r.downloads) meta.push(`${r.downloads.toLocaleString()} downloads`);
        if (r.hi) meta.push('includes sound descriptions');
        if (r.trusted) meta.push('trusted uploader');
        const every = h('span', 'sg-every', 'Use for every episode');
        every.title = "Make this site and group this show's subtitles: later episodes load from them by themselves";
        every.addEventListener('click', async (e) => {
          e.stopPropagation();
          every.textContent = 'Saving…';
          const res = await request({ type: 'useForShow', result: r, episode: query });
          every.textContent = '✓ ' + (res.label || 'Saved') + ' for every episode';
          row.click();
        });
        row.append(top, h('div', 'sg-result-meta', meta.join(' · ')), every);
        row.addEventListener('click', async () => {
          for (const other of results.children) other.classList.remove('sg-on');
          row.classList.add('sg-on', 'sg-loading');
          status.textContent = 'Downloading…';
          const loaded = await request({ type: 'loadSub', result: r, episode: query });
          row.classList.remove('sg-loading');
          if (loaded.error) {
            status.textContent = loaded.error;
            return;
          }
          status.textContent = 'Loaded. Pick another file here if this one is wrong or out of sync.';
          useLoaded(loaded.loaded, query, 'manual');
        });
        results.append(row);
      }
    };
    go.addEventListener('click', run);
    for (const input of [title, id, season, episode]) {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') run();
      });
    }
    if (ep.title || ep.tmdbId || ep.imdbId) run();
    body.append(seasonSection(ep, lang));
  }

  // Prepare a whole season ahead through the batch API (half price, ready within a day).
  function seasonSection(ep, langSel) {
    const box = h('div', 'sg-season');
    box.append(h('div', 'sg-section', 'Prepare a whole season'));
    if (!(ep.tmdbId || ep.imdbId) || ep.type !== 'tv') {
      box.append(h('div', 'sg-find-status', 'Available when the episode is detected from the player (a TV show with an id).'));
      return box;
    }
    box.append(h('div', 'sg-find-status', 'Downloads subtitles for each episode and prepares every line at half price through the batch API. Results are usually ready within an hour (at most a day). Each episode uses one subtitle download (OpenSubtitles allows 5 a day, or 20 signed in; SubDL more).'));
    const grid = h('div', 'sg-form-grid');
    const from = h('input', 'sg-in sg-num');
    from.type = 'number';
    from.min = '1';
    from.value = String(ep.episode || 1);
    const to = h('input', 'sg-in sg-num');
    to.type = 'number';
    to.min = '1';
    to.value = String((ep.episode || 1) + 11);
    grid.append(field('From episode', from), field('To episode', to));
    const go = h('button', 'sg-btn sg-go', 'Prepare');
    const jobs = h('div', 'sg-jobs');
    const showJobs = async () => {
      const res = await request({ type: 'seasonJobs' });
      jobs.textContent = '';
      for (const j of (res.jobs || []).slice(0, 4)) {
        const row = h('div', 'sg-job');
        const p = j.progress ? ` · ${j.progress.succeeded || 0} of ${(j.progress.succeeded || 0) + (j.progress.processing || 0) + (j.progress.errored || 0)} requests back` : '';
        row.append(h('div', 'sg-job-t', `${j.show}, episodes ${j.from}–${j.to}`), h('div', 'sg-job-s', `${j.status}${j.lines ? ` · ${j.lines} lines` : ''}${j.ready ? ` · ${j.ready} ready` : ''}${p}`));
        jobs.append(row);
      }
    };
    go.addEventListener('click', async () => {
      const a = Number(from.value);
      const b = Number(to.value);
      if (!(a >= 1 && b >= a && b - a < 40)) {
        showToast('Pick a range of up to 40 episodes.');
        return;
      }
      go.disabled = true;
      showToast('Preparing the season in the background. You can keep watching.');
      const base = { type: 'tv', tmdbId: ep.tmdbId, imdbId: ep.imdbId, title: ep.title };
      request({ type: 'seasonStart', episode: base, season: ep.season == null ? 1 : ep.season, from: a, to: b, langs: [langSel.value] }).then(() => {
        go.disabled = false;
        showJobs();
      });
      setTimeout(showJobs, 1500);
    });
    for (const input of [from, to]) input.addEventListener('keydown', (e) => e.stopPropagation());
    box.append(grid, go, jobs);
    showJobs();
    return box;
  }

  // ------------------------------------------------------------------ start

  function reportState() {
    if (!port || !video) return;
    const t = active();
    let ready = 0;
    if (t) for (const k of t.keys) if (analyses.has(k)) ready++;
    post({
      type: 'state',
      state: {
        frame: location.hostname,
        track: t ? { label: t.label, lang: t.lang, source: t.source, lines: t.cues.length, ready } : null,
        tracks: tracks.size,
        error: lastError,
        cost: episodeCost,
        episode: lastEpisode ? (SG.episode.confident(lastEpisode) ? SG.episode.describe(lastEpisode) : 'not detected') : '',
        subSearch: autoNote,
      },
    });
  }

  // Phones and tablets: no hover, so taps open words and a close button resumes playback.
  const touchMode = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

  scan();
  setInterval(scan, 1500);
  setInterval(() => {
    if (!video) return;
    place();
    tick();
  }, 100);
  setInterval(() => {
    if (!video) return;
    // Count real playback, so a few seconds of an ad or a preview do not start a search.
    const now = video.currentTime;
    if (!video.paused && lastTickTime != null && now > lastTickTime && now - lastTickTime < 3) playedFor += now - lastTickTime;
    lastTickTime = now;
    pump();
    reportState();
    trackWatching();
    seekIfPending();
    maybeAutoFind();
  }, 1000);
})();
