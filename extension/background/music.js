// Listen mode, background side: finds lyrics on LRCLIB (free, no key), remembers which lyrics and
// timing go with each song, keeps a list of songs listened to, and finds artwork when the page has none.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});
  const API = 'https://lrclib.net/api/';
  let queue = Promise.resolve();
  let retryAt = 0;

  // One request at a time, honouring Retry-After, identified as LRCLIB asks.
  function lrclib(path, params) {
    const run = async () => {
      const wait = retryAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 15000)));
      const url = API + path + '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
      const version = browser.runtime.getManifest().version;
      const res = await fetch(url, { headers: { 'Lrclib-Client': `Langtitles ${version}` } });
      if (res.status === 429) {
        retryAt = Date.now() + (Number(res.headers.get('Retry-After')) || 5) * 1000;
        throw new Error('LRCLIB is busy; try again in a moment');
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('LRCLIB error ' + res.status);
      return res.json();
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  async function picks() {
    return (await browser.storage.local.get('songPicks')).songPicks || {};
  }
  async function savePick(key, pick) {
    const all = await picks();
    if (pick) all[key] = Object.assign({}, all[key], pick, { at: Date.now() });
    else delete all[key];
    // Keep the most recent 1000 songs.
    const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
    for (const k of keys.slice(1000)) delete all[k];
    await browser.storage.local.set({ songPicks: all });
  }

  function trackFrom(rec, np, key) {
    const got = SG.lyrics.recordToCues(rec);
    if (!got) return null;
    return {
      id: 'lyrics:' + (rec.id || key),
      label: `${rec.trackName || np.track} · ${rec.artistName || np.artist || ''}`.trim(),
      source: 'lyrics',
      provider: 'lrclib',
      cues: got.cues,
      synced: got.synced,
      song: { key, track: rec.trackName || np.track, artist: rec.artistName || np.artist, album: rec.albumName || np.album || '', duration: rec.duration || np.duration || 0, lrclibId: rec.id || null },
    };
  }

  // Lyrics for what's playing: the saved choice, else LRCLIB by exact match, else the closest search hit.
  async function find(np) {
    const key = SG.lyrics.songKey(np);
    const saved = (await picks())[key];
    if (saved && saved.lrc) {
      const cues = SG.lyrics.parseLRC(saved.lrc, np.duration);
      if (cues.length) return { track: { id: 'lyrics:own:' + key, label: `${np.track} · your lyrics`, source: 'lyrics', provider: 'own', cues, synced: true, song: Object.assign({ key }, np) }, offset: saved.offset || 0, saved: true };
    }
    if (saved && saved.plain) {
      return { track: { id: 'lyrics:own:' + key, label: `${np.track} · ${saved.from === 'ytmusic' ? 'YouTube Music lyrics' : 'your lyrics'}`, source: 'lyrics', provider: saved.from === 'ytmusic' ? 'ytmusic' : 'own', cues: SG.lyrics.plainToCues(saved.plain, np.duration), synced: false, song: Object.assign({ key }, np) }, offset: 0, saved: true };
    }
    if (saved && saved.lrclibId) {
      const rec = await lrclib('get/' + saved.lrclibId, {}).catch(() => null);
      const t = rec && trackFrom(rec, np, key);
      if (t) return { track: t, offset: saved.offset || 0, saved: true };
    }
    if (!np.track) return { error: "Langtitles can't tell which song this is." };
    let rec = null;
    if (np.duration) {
      rec = await lrclib('get', { track_name: np.track, artist_name: np.artist, album_name: np.album, duration: Math.round(np.duration) }).catch(() => null);
    }
    if (!rec) {
      const list = (await lrclib('search', { track_name: np.track, artist_name: np.artist }).catch(() => null)) || [];
      rec = SG.lyrics.pickRecord(list, np);
      if (!rec && np.artist) rec = SG.lyrics.pickRecord((await lrclib('search', { q: `${np.artist} ${np.track}` }).catch(() => null)) || [], np);
    }
    const t = rec && trackFrom(rec, np, key);
    if (!t) return { error: `No lyrics found on LRCLIB for "${np.track}"${np.artist ? ' by ' + np.artist : ''}.` };
    return { track: t, offset: saved ? saved.offset || 0 : 0 };
  }

  // Hand search: a list for the Song tab to show.
  async function search(q, np) {
    const list = (await lrclib('search', { q })) || [];
    return list.slice(0, 20).map((r) => ({
      id: r.id, track: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration,
      synced: Boolean(r.syncedLyrics), plain: Boolean(r.plainLyrics), instrumental: Boolean(r.instrumental),
      near: np && np.duration && r.duration ? Math.abs(r.duration - np.duration) <= 3 : false,
    }));
  }
  async function useRecord(id, np) {
    const rec = await lrclib('get/' + id, {});
    const key = SG.lyrics.songKey(np);
    const t = rec && trackFrom(rec, np, key);
    if (!t) return { error: 'That record has no lyrics.' };
    await savePick(key, { lrclibId: id, lrc: null, plain: null, offset: 0 });
    return { track: t, offset: 0 };
  }
  async function useOwn(text, np, from) {
    const key = SG.lyrics.songKey(np);
    const synced = SG.lyrics.parseLRC(text, np.duration);
    await savePick(key, synced.length ? { lrc: text, plain: null, lrclibId: null, from: from || 'own' } : { plain: text, lrc: null, lrclibId: null, from: from === 'page' ? 'ytmusic' : 'own' });
    return find(np);
  }

  // Songs listened to, newest first, for Library → Music.
  async function remember(np) {
    if (!np || !np.track) return;
    const key = SG.lyrics.songKey(np);
    const all = (await browser.storage.local.get('songs')).songs || {};
    const prev = all[key] || { first: Date.now(), plays: 0 };
    all[key] = Object.assign(prev, { key, track: np.track, artist: np.artist || '', album: np.album || '', art: np.art || prev.art || '', lang: np.lang || prev.lang || '', site: np.site || '', url: np.url || prev.url || '', last: Date.now(), plays: (prev.plays || 0) + 1 });
    if (!all[key].art) all[key].art = await artwork(np).catch(() => '');
    await browser.storage.local.set({ songs: all });
    return all[key];
  }
  async function songs() {
    const all = (await browser.storage.local.get('songs')).songs || {};
    return Object.values(all).sort((a, b) => b.last - a.last);
  }

  // Artwork from the iTunes Search API (free, no key) when the page gave none.
  async function artwork(np) {
    const term = [np.artist, np.track].filter(Boolean).join(' ');
    if (!term) return '';
    const res = await fetch('https://itunes.apple.com/search?' + new URLSearchParams({ term, media: 'music', entity: 'song', limit: '3' }));
    if (!res.ok) return '';
    const j = await res.json();
    const hit = (j.results || [])[0];
    return hit && hit.artworkUrl100 ? hit.artworkUrl100.replace('100x100', '300x300') : '';
  }

  // A show's opening and ending songs, from MyAnimeList via Jikan (free, no key).
  async function showSongs(title) {
    const j = async (url) => {
      const res = await fetch(url);
      if (res.status === 429) throw new Error('Jikan is busy; try again in a moment');
      if (!res.ok) throw new Error('Jikan error ' + res.status);
      return res.json();
    };
    const found = (await j('https://api.jikan.moe/v4/anime?' + new URLSearchParams({ q: title, limit: '5', sfw: 'true' }))).data || [];
    const norm = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const want = norm(title);
    const anime = found.find((a) => [a.title, a.title_english, a.title_japanese].concat((a.titles || []).map((t) => t.title)).some((t) => norm(t) === want)) || found[0];
    if (!anime) return { error: `No anime called "${title}" on MyAnimeList.` };
    await new Promise((r) => setTimeout(r, 400)); // Jikan allows about 3 requests a second
    const themes = (await j(`https://api.jikan.moe/v4/anime/${anime.mal_id}/themes`)).data || {};
    const list = [];
    for (const [kind, lines] of [['OP', themes.openings || []], ['ED', themes.endings || []]]) {
      for (const line of lines) {
        const t = SG.lyrics.parseTheme(line);
        if (t) list.push(Object.assign({ kind }, t));
      }
    }
    return { anime: { id: anime.mal_id, title: anime.title, art: (anime.images && anime.images.jpg && anime.images.jpg.image_url) || '' }, list };
  }

  SG.music = { showSongs, find, search, useRecord, useOwn, savePick, remember, songs, picks };
})(typeof globalThis !== 'undefined' ? globalThis : this);
