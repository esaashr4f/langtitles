// Your shows: picked once (with a poster), remembered with their subtitle source, and recognised again
// by the title a site gives them, so later episodes need no searching.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  const normTitle = (t) => String(t || '').toLowerCase().replace(/\(\d{4}\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  async function all() {
    return (await browser.storage.local.get('myShows')).myShows || [];
  }
  async function saveAll(list) {
    await browser.storage.local.set({ myShows: list.slice(0, 200) });
  }
  const sameShow = (a, b) => (a.tmdbId && a.tmdbId === b.tmdbId) || (a.imdbId && a.imdbId === b.imdbId)
    || (a.jimakuId && a.jimakuId === b.jimakuId) || (!a.tmdbId && !a.imdbId && !a.jimakuId && normTitle(a.title) === normTitle(b.title));

  // Picks a show (from "Find the show"); `siteTitle` is the name the site used, remembered as an alias.
  async function pick(show, siteTitle, lang) {
    const list = await all();
    let entry = list.find((x) => sameShow(x, show));
    if (!entry) {
      entry = { id: 's' + Date.now().toString(36), title: show.title || show.original || '', original: show.original || '', year: show.year || null, type: show.type || 'tv', tmdbId: show.tmdbId || null, imdbId: show.imdbId || null, jimakuId: show.jimakuId || null, lang: lang || '', aliases: [], addedAt: Date.now() };
      list.unshift(entry);
    }
    for (const k of ['tmdbId', 'imdbId', 'jimakuId', 'year']) if (show[k] && !entry[k]) entry[k] = show[k];
    const alias = normTitle(siteTitle);
    if (alias && !entry.aliases.includes(alias)) entry.aliases.push(alias);
    entry.updatedAt = Date.now();
    if (!entry.poster) entry.poster = await posterFor(entry).catch(() => '');
    await saveAll(list);
    return entry;
  }

  // The saved show a site title (or a detected episode) refers to, if any.
  async function match(ep) {
    if (!ep) return null;
    const list = await all();
    const t = normTitle(ep.title);
    return list.find((x) => sameShow(x, ep) && (ep.tmdbId || ep.imdbId || ep.jimakuId))
      || list.find((x) => t && (x.aliases.includes(t) || normTitle(x.title) === t || normTitle(x.original) === t)) || null;
  }

  async function remove(id) {
    await saveAll((await all()).filter((x) => x.id !== id));
  }

  async function update(id, patch) {
    const list = await all();
    const e = list.find((x) => x.id === id);
    if (e) Object.assign(e, patch, { updatedAt: Date.now() });
    await saveAll(list);
    return e;
  }

  // ---- posters: AniList for anime (no key), TVmaze for TV (no key), TMDB with an optional key.
  async function anilist(title) {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query($s:String){Media(search:$s,type:ANIME){id coverImage{large} title{romaji english}}}', variables: { s: title } }),
    });
    if (!res.ok) return '';
    const j = await res.json();
    return (j.data && j.data.Media && j.data.Media.coverImage && j.data.Media.coverImage.large) || '';
  }
  async function tvmaze(title) {
    const res = await fetch('https://api.tvmaze.com/singlesearch/shows?q=' + encodeURIComponent(title));
    if (!res.ok) return '';
    const j = await res.json();
    return (j.image && (j.image.medium || j.image.original)) || '';
  }
  async function tmdb(entry, key) {
    if (!key) return '';
    const kind = entry.type === 'movie' ? 'movie' : 'tv';
    const url = entry.tmdbId
      ? `https://api.themoviedb.org/3/${kind}/${entry.tmdbId}?api_key=${encodeURIComponent(key)}`
      : `https://api.themoviedb.org/3/search/${kind}?query=${encodeURIComponent(entry.title)}&api_key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const j = await res.json();
    const path = j.poster_path || (j.results && j.results[0] && j.results[0].poster_path);
    return path ? 'https://image.tmdb.org/t/p/w342' + path : '';
  }
  async function posterFor(entry) {
    const settings = await SG.loadSettings();
    const anime = entry.jimakuId || entry.lang === 'ja';
    const tries = settings.tmdbKey ? [() => tmdb(entry, settings.tmdbKey)] : [];
    if (anime) tries.push(() => anilist(entry.title), () => tvmaze(entry.title));
    else tries.push(() => tvmaze(entry.title), () => anilist(entry.title));
    for (const t of tries) {
      try {
        const url = await t();
        if (url) return url;
      } catch (e) {
        /* try the next source */
      }
    }
    return '';
  }

  SG.shows = { all, pick, match, remove, update, posterFor, normTitle };
})(typeof globalThis !== 'undefined' ? globalThis : this);
