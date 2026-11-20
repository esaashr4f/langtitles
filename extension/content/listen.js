// Listen mode, page side: one small adapter per music site that answers "what is playing?"
// (track, artist, album, length, artwork) and "where is the audio?". Everything else in Listen mode
// talks only to these, so adding a site means adding an adapter here.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});
  const host = location.hostname;

  function kind() {
    if (host === 'music.youtube.com') return 'ytmusic';
    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') return 'youtube';
    if (host === 'open.spotify.com') return 'spotify';
    if (host === 'music.apple.com' || host === 'beta.music.apple.com') return 'apple';
    return null;
  }
  // Sites that are about music: Listen mode is the default there.
  const musicSite = () => ['ytmusic', 'spotify', 'apple'].includes(kind());

  const text = (sel, scope) => {
    const el = (scope || document).querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  };

  // The page's Media Session metadata (what the OS media controls show), read through the page's own
  // object where Firefox's content-script view hides it.
  function session() {
    try {
      const ms = (navigator.wrappedJSObject || navigator).mediaSession;
      const m = ms && ms.metadata;
      if (!m || !m.title) return null;
      const art = Array.from(m.artwork || []).map((a) => a.src).filter(Boolean).pop() || '';
      return { track: String(m.title), artist: String(m.artist || ''), album: String(m.album || ''), art };
    } catch (e) {
      return null;
    }
  }

  // Every audio and video element, including ones inside shadow roots (Apple Music).
  function media(rootNode, out, depth) {
    for (const el of rootNode.querySelectorAll('video, audio')) out.push(el);
    if (depth < 4) for (const el of rootNode.querySelectorAll('*')) if (el.shadowRoot) media(el.shadowRoot, out, depth + 1);
    return out;
  }
  // The element actually playing the song: playing beats paused, longer beats shorter.
  function mediaElement() {
    let best = null;
    let score = -1;
    for (const el of media(document, [], 0)) {
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      const s = (el.paused ? 0 : 1e6) + (el.currentTime > 0 ? 1e5 : 0) + d;
      if (s > score) {
        score = s;
        best = el;
      }
    }
    return best;
  }

  function nowPlaying(el) {
    const k = kind();
    const ms = session();
    const duration = el && Number.isFinite(el.duration) ? el.duration : 0;
    let np = null;
    if (k === 'ytmusic') {
      const bar = document.querySelector('ytmusic-player-bar');
      const byline = text('.byline', bar || document).split(/\s*•\s*/);
      np = { track: text('.title', bar || document) || (ms && ms.track), artist: byline[0] || (ms && ms.artist) || '', album: byline.length > 2 ? byline[1] : (ms && ms.album) || '', art: (ms && ms.art) || '' };
    } else if (k === 'youtube') {
      const title = text('h1.ytd-watch-metadata, #title h1, h1.title') || document.title.replace(/\s*-\s*YouTube$/, '');
      const channel = text('#owner #channel-name a, ytd-video-owner-renderer #channel-name a, #upload-info #channel-name');
      const genre = (document.querySelector('meta[itemprop="genre"]') || {}).content || '';
      const parsed = SG.lyrics.parseVideoTitle(title, channel);
      np = { track: parsed.track, artist: parsed.artist, album: '', art: (ms && ms.art) || '', isSong: SG.lyrics.looksLikeSong(title, channel, genre), title };
    } else if (k === 'spotify') {
      np = {
        track: text('[data-testid="context-item-info-title"]') || (ms && ms.track) || '',
        artist: text('[data-testid="context-item-info-artist"]') || (ms && ms.artist) || '',
        album: (ms && ms.album) || '',
        art: (ms && ms.art) || '',
      };
    } else if (ms) {
      np = ms;
    } else if (el) {
      const parsed = SG.lyrics.parseVideoTitle(document.title);
      np = { track: parsed.track, artist: parsed.artist, album: '', art: '' };
    }
    if (!np || !np.track) return null;
    np.duration = duration || np.duration || 0;
    np.track = String(np.track).trim();
    np.artist = String(np.artist || '').trim();
    if (np.isSong == null) np.isSong = musicSite() || Boolean(ms);
    np.url = location.href.split('#')[0];
    return np;
  }

  // Spotify's progress bar, for when the audio element's clock isn't readable.
  function spotifyPosition() {
    const t = text('[data-testid="playback-position"]');
    const m = t.match(/(?:(\d+):)?(\d+):(\d\d)/);
    return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : null;
  }

  // YouTube Music's own lyrics (licensed, usually not timed), from its Lyrics tab. The tab only loads
  // its text once opened, so this opens it if needed and waits a moment.
  async function pageLyrics() {
    const k = kind();
    if (k === 'spotify' || k === 'apple') {
      // Their own lyrics view, when it's open (Spotify: the microphone button; Apple Music: the lyrics button).
      const sels = k === 'spotify'
        ? ['[data-testid="fullscreen-lyric"]', '[data-testid="lyrics-line"]', '.lyrics-lyricsContent-lyric']
        : ['.lyrics__line', '.lyric-line', '[data-testid="lyric-line"]'];
      for (const sel of sels) {
        const lines = Array.from(document.querySelectorAll(sel)).map((el) => el.textContent.trim()).filter(Boolean);
        if (lines.length > 2) return lines.join('\n');
      }
      return null;
    }
    if (k !== 'ytmusic') return null;
    const read = () => {
      for (const sel of [
        'ytmusic-description-shelf-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"] .description',
        'ytmusic-section-list-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"] ytmusic-description-shelf-renderer .description',
        '#tab-renderer ytmusic-description-shelf-renderer .description',
      ]) {
        const el = document.querySelector(sel);
        const t = el && el.innerText ? el.innerText.trim() : '';
        if (t && t.split('\n').length > 2) return t;
      }
      return null;
    };
    let text = read();
    if (!text) {
      const tab = Array.from(document.querySelectorAll('tp-yt-paper-tab, .tab-header')).find((el) => /^(lyrics|歌詞|가사)$/i.test(el.textContent.trim()));
      if (!tab) return null;
      tab.click();
      for (let i = 0; i < 20 && !text; i++) {
        await new Promise((r) => setTimeout(r, 250));
        text = read();
      }
    }
    if (!text) return null;
    // The source line at the end ("Source: LyricFind") is not a lyric.
    return text.split('\n').filter((l) => !/^(source|出典|출처)\s*[:：]/i.test(l.trim())).join('\n');
  }

  SG.listen = { pageLyrics, kind, musicSite, nowPlaying, mediaElement, spotifyPosition };
})(typeof globalThis !== 'undefined' ? globalThis : this);
