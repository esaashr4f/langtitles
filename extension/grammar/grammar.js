// Library: every word and grammar guide Langtitles has written, readable and searchable after watching.
(async function () {
  'use strict';
  const SG = globalThis.SG;
  const $ = (id) => document.getElementById(id);
  let guides = [];
  let knownKanji = null;
  browser.storage.local.get('known').then((r) => {
    knownKanji = new Set(Array.from(((r.known || {}).ja) || ''));
  }, () => {});
  let lang = '';
  let kind = 'grammar';
  let sort = 'group';
  let current = '';
  let jlpt = null;
  fetch('../data/jlpt.json').then((r) => r.json()).then((d) => {
    jlpt = d;
    if (guides.length) renderList();
  }, () => {});
  const collapsed = new Set();
  const langOf = (g) => SG.lang.langCode(g.lang || String(g.k || '').split('.')[0]);
  const formId = (g) => String(g.k || '').split('.').slice(1).join('.').toLowerCase();
  // Grammar forms sorted into the kinds a learner thinks in.
  const GRAMMAR_GROUPS = [
    ['Particles', /particle|^(wa|ga|w?o|ni|de|mo|no|to|e|he|ya|ka|kara|made|yori|dake|shika|bakari|nado|eun_neun|i_ga|eul_reul|ui|e_seo|de_structural|le|guo|zhe)$/],
    ['Sentence endings', /ending|sentence_final|final_|_final|^(yo|ne|na|zo|ze|sa|kana|kke|no_question|ne_yo|yo_ne|ma|ba|ne_zh|a_zh)$/],
    ['Verb and adjective forms', /te_form|^te$|causative|passive|potential|volitional|conditional|negative|past|polite|imperative|^tai|masu|nai|stem|tense|aspect|progressive|perfect|honorific|humble|keigo|conjugat|adjective|copula|desu|da$|dictionary/],
    ['Helper verbs after て', /^te_|_te_/],
    ['Connecting clauses', /connect|conjunct|because|although|while|nagara|reason|node|noni|kedo|keredo|shi$|tari|cause|contrast|sequence|and_then/],
  ];
  function grammarGroup(g) {
    const id = formId(g);
    // te + helper verb (ている, てしまう …) before plain verb forms, so ja.te_iru is not filed under "te form"
    if (/^te_(?!form)/.test(id)) return 'Helper verbs after て';
    for (const [name, re] of GRAMMAR_GROUPS) if (re.test(id)) return name;
    return 'Patterns and expressions';
  }
  const GROUP_ORDER = ['Particles', 'Verb and adjective forms', 'Helper verbs after て', 'Connecting clauses', 'Sentence endings', 'Patterns and expressions'];
  function wordGroup(g) {
    if (g.group === 'phrase' || String(g.k).startsWith('phrase.')) return 'Set phrases and expressions';
    if (g.kind === 'name') return 'Names';
    if (langOf(g) === 'ja' && jlpt) {
      const d = String(g.k || '').split('.').slice(2).join('.');
      const level = SG.jlptLevel(jlpt, { d, s: g.word || d });
      return level ? 'JLPT N' + level : 'Beyond the JLPT lists';
    }
    return 'Words';
  }
  const WORD_ORDER = ['Set phrases and expressions', 'JLPT N5', 'JLPT N4', 'JLPT N3', 'JLPT N2', 'JLPT N1', 'Beyond the JLPT lists', 'Words', 'Names'];
  const kindOf = (g) => (g.kind === 'show' ? 'show' : g.kind === 'song' ? 'song' : g.kind === 'name' || g.group === 'phrase' || String(g.k).startsWith('phrase.') ? 'word' : g.kind || (String(g.k).startsWith('word.') ? 'word' : 'grammar'));

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  async function load() {
    guides = (await SG.cache.getAll('guides')).sort((a, b) => b.savedAt - a.savedAt);
    // Songs listened to in Listen mode that have no guide yet still appear under Music.
    const played = Object.values((await browser.storage.local.get('songs')).songs || {});
    const withGuide = new Set(guides.filter((g) => g.kind === 'song').map((g) => g.k));
    // Shows watched with subtitles: one entry per show, its episodes inside.
    const eps = (await SG.cache.getAll('episodes').catch(() => [])).filter((e) => !e.meta);
    const byShow = new Map();
    for (const e of eps) {
      if (!byShow.has(e.showKey)) byShow.set(e.showKey, []);
      byShow.get(e.showKey).push(e);
    }
    for (const [showKey, list] of byShow) {
      list.sort((a, b) => a.season - b.season || a.episode - b.episode);
      const last = Math.max(...list.map((e) => e.last || 0));
      guides.push({ key: 'show:' + showKey, k: 'show:' + showKey, kind: 'show', name: list[0].show, lang: list[0].lang || '', text: '', savedAt: last, showKey, eps: list, poster: (list.find((e) => e.poster) || {}).poster || '' });
    }
    for (const x of played) {
      const k = 'song.' + x.key;
      if (withGuide.has(k)) continue;
      guides.push({ key: k, k, kind: 'song', noGuide: true, name: `${x.track}${x.artist ? ' — ' + x.artist : ''}`, lang: x.lang || '', text: '', savedAt: x.last || 0, song: x });
    }
    // A one-off note when Langtitles has corrected saved guides.
    const note = (await browser.storage.local.get('libraryFixNote')).libraryFixNote;
    const fixBox = $('fixNote');
    if (note && fixBox && !note.seen) {
      const s = (note.summary || []).reduce((a, x) => ({ added: a.added + x.added, retired: a.retired + x.retired }), { added: 0, retired: 0 });
      fixBox.hidden = false;
      fixBox.textContent = note.merged
        ? `${note.merged} guide${note.merged === 1 ? ' was a duplicate' : 's were duplicates'} of another (the same form under a different name) and ${note.merged === 1 ? 'has' : 'have'} been merged; your notes and the lines you met them in are kept, and old versions are in history.`
        : `Your guides were updated: ${s.added} rewritten or new guides (phrases saved as phrases, grammar as grammar), ${s.retired} replaced. Old versions are kept.`;
      const ok = document.createElement('button');
      ok.textContent = 'OK';
      ok.addEventListener('click', () => {
        fixBox.hidden = true;
        browser.storage.local.set({ libraryFixNote: Object.assign(note, { seen: true }) });
      });
      fixBox.append(' ', ok);
    }
    const nWords = guides.filter((g) => kindOf(g) === 'word').length;
    const nSongs = guides.filter((g) => kindOf(g) === 'song').length;
    const nShows = guides.filter((g) => kindOf(g) === 'show').length;
    const nGrammar = guides.length - nWords - nSongs - nShows;
    $('count').textContent = `${nWords} word${nWords === 1 ? '' : 's'} · ${nGrammar} grammar form${nGrammar === 1 ? '' : 's'}` + (nSongs ? ` · ${nSongs} song${nSongs === 1 ? '' : 's'}` : '');
    const kinds = $('kinds');
    kinds.textContent = '';
    const kindTabs = [['grammar', `Grammar · ${nGrammar}`], ['word', `Words · ${nWords}`]];
    if (nShows) kindTabs.push(['show', `Shows · ${nShows}`]);
    if (nSongs) kindTabs.push(['song', `Music · ${nSongs}`]);
    for (const [code, name] of kindTabs) {
      const b = h('button', code === kind ? 'on' : '', name);
      b.addEventListener('click', () => {
        kind = code;
        current = '';
        history.replaceState(null, '', location.pathname);
        load();
      });
      kinds.append(b);
    }
    kinds.className = 'seg';
    const langs = [...new Set(guides.map((g) => SG.lang.langCode(g.lang || (g.k || '').split('.')[0])))];
    const box = $('langs');
    box.textContent = '';
    if (langs.length > 1) {
      for (const code of [''].concat(langs)) {
        const b = h('button', code === lang ? 'on' : '', code ? SG.lang.langName(code) : 'All');
        b.addEventListener('click', () => {
          lang = code;
          load();
        });
        box.append(b);
      }
    }
    const wanted = decodeURIComponent(location.hash.slice(1));
    const pick = guides.find((g) => g.k === wanted) || guides.find((g) => g.k === current) || guides.find((g) => kindOf(g) === kind) || guides[0];
    if (pick && kindOf(pick) !== kind) {
      kind = kindOf(pick);
      for (const b of kinds.children) b.classList.toggle('on', b.textContent.toLowerCase().startsWith(kind));
    }
    renderList();
    if (pick) show(pick);
  }

  function matches(g, q) {
    if (kind && kindOf(g) !== kind) return false;
    if (lang && langOf(g) !== lang) return false;
    if (!q) return true;
    return [g.name, g.k, g.text, g.sentence].join('\n').toLowerCase().includes(q);
  }

  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    const nav = $('list');
    nav.textContent = '';
    const items = guides.filter((x) => matches(x, q));
    const byName = (a, b) => String(a.name || a.k).localeCompare(String(b.name || b.k), 'ja');
    let groups;
    if (sort === 'recent') groups = [['Most recent first', items]];
    else if (sort === 'az') groups = [['A to Z', items.slice().sort(byName)]];
    else {
      const order = kind === 'word' ? WORD_ORDER : kind === 'song' || kind === 'show' ? [] : GROUP_ORDER;
      const map = new Map();
      for (const g of items) {
        const name = kind === 'word' ? wordGroup(g) : kind === 'song' ? (g.song && g.song.artist) || 'Unknown artist' : kind === 'show' ? SG.lang.langName(langOf(g)) : grammarGroup(g);
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(g);
      }
      groups = [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([n, list]) => [n, list.sort(byName)]);
    }
    if (!items.length) nav.append(h('p', 'none', q ? 'Nothing matches.' : kind === 'word' ? 'No word guides yet: open the book on a word while watching.' : 'No grammar guides yet: open a form in a word\'s Guides row while watching.'));
    for (const [name, list] of groups) {
      const sec = h('section', 'group' + (collapsed.has(name) && !q ? ' shut' : ''));
      const head = h('button', 'group-head');
      head.append(h('span', '', name), h('span', 'n', String(list.length)));
      head.addEventListener('click', () => {
        if (collapsed.has(name)) collapsed.delete(name);
        else collapsed.add(name);
        sec.classList.toggle('shut');
      });
      const ul = h('div', 'group-body');
      for (const g of list) {
        const a = h('a', g.k === current ? 'on' : '');
        a.href = '#' + encodeURIComponent(g.k);
        const title = h('span', 't', g.name || g.k);
        title.lang = langOf(g);
        a.append(title);
        if (!lang) a.append(h('small', '', SG.lang.langName(langOf(g))));
        a.addEventListener('click', (e) => {
          e.preventDefault();
          history.replaceState(null, '', a.href);
          show(g);
        });
        ul.append(a);
      }
      sec.append(head, ul);
      nav.append(sec);
    }
  }
  for (const b of document.querySelectorAll('#sort button')) {
    b.addEventListener('click', () => {
      sort = b.dataset.sort;
      for (const x of document.querySelectorAll('#sort button')) x.classList.toggle('on', x === b);
      renderList();
    });
  }

  // A show: poster, a vocabulary guide from the episodes watched, and each episode with its frame,
  // a recap (that episode's lines only, so no spoilers) and a language lesson.
  function showShow(g, view) {
    const head = h('div', 'head song-head');
    if (g.poster) {
      const img = h('img', 'show-poster');
      img.src = g.poster;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      head.append(img);
    }
    const names = h('div', 'song-names');
    names.append(h('h2', '', g.name), h('div', 'meta', `${SG.lang.langName(langOf(g))} · ${g.eps.length} episode${g.eps.length === 1 ? '' : 's'} watched with subtitles`));
    head.append(names);
    view.append(head);
    const rm = h('button', 'show-remove', 'Remove this show');
    rm.title = 'Removes its episodes, recaps and lessons from the Library (saved words and guides stay)';
    rm.addEventListener('click', async () => {
      if (!confirm(`Remove ${g.name} from the Library? Its episodes, recaps and lessons are deleted; your saved words and guides stay.`)) return;
      await browser.runtime.sendMessage({ type: 'removeShowEpisodes', showKey: g.showKey });
      current = '';
      history.replaceState(null, '', location.pathname);
      load();
    });
    names.append(rm);

    const vocab = h('section', 'show-block');
    const vBtn = h('button', 'primary', 'Vocabulary guide to this show');
    vBtn.title = 'Written from the episodes you have watched only, and updated as you watch more';
    const vBody = h('article', 'guide');
    vBtn.addEventListener('click', async () => {
      vBtn.disabled = true;
      vBody.textContent = 'Writing… (from the episodes you have watched only)';
      const res = await browser.runtime.sendMessage({ type: 'showVocab', showKey: g.showKey });
      vBtn.remove();
      vBody.textContent = '';
      if (!res || res.error) vBody.textContent = (res && res.error) || 'Could not write the guide.';
      else {
        SG.renderGuide(vBody, res.text, { known: new Set(), plain: false });
        vBody.append(h('p', 'model', SG.modelLabel(res.model) + (res.cached ? ' · saved earlier' : '')));
      }
    });
    vocab.append(vBtn, vBody);
    view.append(vocab);
    view.append(finishedBlock(g));

    const list = h('div', 'eps');
    for (const e of g.eps) {
      const row = h('section', 'ep');
      const top = h('div', 'ep-top');
      if (e.frame) top.append(SG.frameImg(e.frame, 'ep-frame'));
      else top.append(h('div', 'ep-frame ep-frame-none'));
      const info = h('div', 'ep-info');
      info.append(h('div', 'ep-title', e.type === 'movie' ? 'Film' : `Season ${e.season}, episode ${e.episode}`));
      const pct = e.lines && e.lines.length ? Math.round(((e.reached || 0) / e.lines.length) * 100) : 0;
      info.append(h('div', 'meta', `Last watched ${new Date(e.last).toLocaleDateString()}${pct ? ` · ${Math.min(100, pct)}% of the lines` : ''}`));
      const acts = h('div', 'ep-acts');
      const body = h('article', 'guide lesson');
      const lb = h('button', e.walk ? 'done' : '', e.walk ? 'Read the lesson' : 'Write the lesson');
      lb.title = 'A teacher walking through the episode with you, from start to end (written once, then kept)';
      const write = async (again) => {
        body.textContent = 'Writing the lesson… It walks through the whole episode, so it takes a minute or two.';
        const res = await browser.runtime.sendMessage({ type: 'lessonWrite', key: e.key, again });
        body.textContent = '';
        if (!res || res.error) {
          body.textContent = (res && res.error) || 'Could not write it.';
          return;
        }
        e.walk = { text: res.text, model: res.model, frames: res.frames || [] };
        lb.textContent = 'Read the lesson';
        await renderLesson(body, res.text, res.frames || [], langOf(g), e);
        body.append(h('p', 'model', SG.modelLabel(res.model)));
        body.append(rewriteBtn());
      };
      const rewriteBtn = () => {
        const again = h('button', 'redo-link', 'Rewrite this lesson');
        again.addEventListener('click', () => write(true));
        return again;
      };
      lb.addEventListener('click', async () => {
        lb.classList.add('on');
        if (!e.walk) {
          write(false);
          return;
        }
        body.textContent = '';
        const res = { text: e.walk.text, model: e.walk.model, frames: e.walk.frames || [] };
        body.textContent = '';
        if (!res || res.error) {
          body.textContent = (res && res.error) || 'Could not write it.';
          return;
        }
        e.walk = { text: res.text, model: res.model, frames: res.frames || [], spoilers: e.walk && e.walk.spoilers };
        lb.textContent = 'Read the lesson';
        await renderLesson(body, res.text, res.frames || [], langOf(g), e);
        body.append(h('p', 'model', SG.modelLabel(res.model) + (e.walk.spoilers ? ' · spoilers allowed (show finished)' : '')));
        body.append(rewriteBtn());
      });
      acts.append(lb);
      if (e.url) {
        const a = h('a', '', 'Watch');
        a.href = e.url;
        a.target = '_blank';
        a.rel = 'noopener';
        acts.append(a);
      }
      info.append(acts);
      top.append(info);
      row.append(top, body);
      list.append(row);
    }
    view.append(list);
  }

  // "I've finished this show": get every episode's subtitles, then write every lesson (spoilers allowed).
  function finishedBlock(g) {
    const box = h('section', 'show-block finish');
    box.append(h('h3', '', "I've finished this show"));
    const body = h('div');
    box.append(body);
    browser.runtime.sendMessage({ type: 'showMeta', showKey: g.showKey }).then(async (meta) => {
      const f = meta && meta.finish;
      if (f && f.status === 'writing') {
        const p = f.progress || {};
        body.append(h('p', 'sub', `Writing ${f.total} lessons through the Batch API (half price, usually within an hour): ${p.succeeded || 0} done so far. They appear on each episode below.`));
        return;
      }
      if (f && f.status === 'done') {
        body.append(h('p', 'sub', `Done: ${f.saved || 0} lessons written with spoilers allowed. Open any episode below.`));
        companionBlock(body, g, meta.companion);
        return;
      }
      if (f && f.status === 'ready') {
        showEstimate(body, g, f);
        return;
      }
      body.append(h('p', 'sub', "Langtitles fetches the subtitles for every episode from this show's usual subtitle source (even episodes you never watched with it, at most 20 a minute), then writes a lesson for each one that walks you back through it and teaches the language, with spoilers allowed. You see the cost before anything is paid."));
      const seasons = [...new Set(g.eps.map((e) => e.season || 1))].sort((a, b) => a - b);
      const rows = h('div', 'finish-rows');
      const status = h('p', 'sub');
      const start = async (plan, scope, btn) => {
        btn.disabled = true;
        status.textContent = `Fetching subtitles for ${scope ? 'season ' + scope.season : 'every episode'}… (at most 20 a minute; anything missing can be fetched later)`;
        const res = await browser.runtime.sendMessage({ type: 'finishShow', showKey: g.showKey, plan, scope });
        if (!res || res.error) {
          status.textContent = (res && res.error) || 'Something went wrong.';
          btn.disabled = false;
          return;
        }
        body.textContent = '';
        showEstimate(body, g, res.meta.finish, res.estimate);
      };
      const rowPlan = (row) => {
        const [se, from, upto] = row.querySelectorAll('input');
        return { season: Number(se.value) || 1, from: Number(from.value) || 1, to: Number(upto.value) || 1 };
      };
      const addRow = (season, last) => {
        const row = h('div', 'finish-row');
        const se = h('input');
        se.type = 'number';
        se.min = '1';
        se.value = String(season);
        const from = h('input');
        from.type = 'number';
        from.min = '1';
        from.value = '1';
        const upto = h('input');
        upto.type = 'number';
        upto.min = '1';
        upto.value = String(last);
        row.append(document.createTextNode('Season '), se, document.createTextNode(' episodes '), from, document.createTextNode(' to '), upto);
        const one = h('button', 'season-done', "I've finished this season");
        one.addEventListener('click', () => {
          const plan = rowPlan(row);
          start([plan], { season: plan.season }, one);
        });
        row.append(one);
        rows.append(row);
        rows.classList.toggle('multi', rows.childElementCount > 1);
      };
      for (const se of seasons) addRow(se, Math.max(...g.eps.filter((e) => (e.season || 1) === se).map((e) => e.episode || 1), 1));
      if (!seasons.length) addRow(1, 12);
      const more = h('button', '', 'Add a season');
      more.addEventListener('click', () => addRow(Math.max(...Array.from(rows.children).map((r) => rowPlan(r).season)) + 1, 12));
      const go = h('button', 'primary', "I've finished this show");
      go.addEventListener('click', () => start(Array.from(rows.children).map(rowPlan), null, go));
      body.append(h('p', 'sub', 'Which episodes? (set the last episode of each season)'), rows, more, go, status);
    });
    return box;
  }

  // The show companion: a long watch-along of the whole show, built on the episode lessons.
  async function companionBlock(body, g, c) {
    const box = h('div', 'companion');
    box.append(h('h3', '', 'Show companion'));
    body.append(box);
    if (c && c.status === 'done') {
      const art = h('article', 'guide lesson');
      const lang = langOf(g) || 'ja';
      for (let i = 0; i < c.texts.length; i++) {
        const part = h('div');
        await renderLesson(part, c.texts[i] || '', [], lang, null);
        art.append(part);
      }
      box.append(art, h('p', 'model', SG.modelLabel(c.model)));
      return;
    }
    if (c && c.status === 'writing') {
      box.append(h('p', 'sub', `Writing the companion in ${c.total} parts through the Batch API: ${(c.progress || {}).succeeded || 0} done so far.`));
      return;
    }
    const est = await browser.runtime.sendMessage({ type: 'companionEstimate', showKey: g.showKey });
    if (!est || est.error) {
      box.append(h('p', 'sub', (est && est.error) || ''));
      return;
    }
    box.append(h('p', 'sub', `A long watch-along of the whole show from episode 1 to the end, as if we'd watched it together: the story, the surprises, the questions it leaves, and the language that carries it woven in, with links to every guide. ${est.parts} parts, about $${est.dollars.toFixed(2)} at half price.`));
    const go = h('button', 'primary', `Write the companion (about $${est.dollars.toFixed(2)})`);
    const status = h('p', 'sub');
    go.addEventListener('click', async () => {
      go.disabled = true;
      const res = await browser.runtime.sendMessage({ type: 'companionStart', showKey: g.showKey });
      status.textContent = res && res.ok ? `Sent ${res.total} parts; they're written within about an hour.` : (res && res.error) || 'Could not start.';
    });
    box.append(go, status);
  }

  async function showEstimate(body, g, finish, est) {
    est = est || (await browser.runtime.sendMessage({ type: 'finishEstimate', showKey: g.showKey }));
    const list = finish.episodes || [];
    const found = list.filter((r) => r.status === 'found' || r.status === 'have').length;
    const missing = list.filter((r) => r.status !== 'found' && r.status !== 'have');
    body.append(h('p', '', `Subtitles for ${found} of ${list.length} episodes.` + (missing.length ? ` Missing: ${missing.map((r) => `S${r.season}E${r.episode}`).join(', ')}.` : '')));
    body.append(h('p', '', `Writing ${est.episodes} lessons with ${SG.modelLabel(est.model).replace(/^Written by /, '')} through the Batch API (half price) costs about $${est.dollars.toFixed(2)}.`));
    const go = h('button', 'primary', `Write ${est.episodes} lessons (about $${est.dollars.toFixed(2)})`);
    const status = h('p', 'sub');
    go.addEventListener('click', async () => {
      go.disabled = true;
      const res = await browser.runtime.sendMessage({ type: 'finishStart', showKey: g.showKey });
      status.textContent = res && res.ok ? `Sent ${res.total} lessons. They're written within about an hour and appear on each episode.` : (res && res.error) || 'Could not start.';
    });
    body.append(go, status);
  }

  // A lesson or guide with links to word and grammar guides, and the scene frames it placed.
  async function renderLesson(target, text, frameIds, lang, e) {
    const data = frameIds.length ? await SG.cache.getMany('frames', frameIds).catch(() => new Map()) : new Map();
    const frames = frameIds.map((id) => (data.get(id) || {}).data || null);
    const info = new Map(((e && e.frames) || []).map((f) => [f.id, f]));
    SG.renderGuide(target, text, {
      known: knownKanji,
      onLink: (kind, k, label, el) => openLinked(kind, k, label, lang, el),
      frame: (n) => {
        const src = frames[n - 1];
        if (!src) return null;
        const fig = h('figure', 'lesson-frame');
        const img = h('img');
        img.src = src;
        img.alt = 'The scene';
        fig.append(img);
        const f = info.get(frameIds[n - 1]);
        if (f && f.line) {
          const cap = h('figcaption', '', f.line);
          cap.lang = lang;
          fig.append(cap);
        }
        return fig;
      },
    });
  }

  // A link in a lesson or song guide: open that guide here (writing it first if it doesn't exist yet).
  async function openLinked(kind, k, label, lang, el) {
    const want = kind === 'g' ? SG.canonicalForm(k.includes('.') ? k : `${lang}.${k}`) : `word.${lang}.${k}`;
    const have = guides.find((x) => x.k === want);
    if (have) return show(have);
    const was = el.textContent;
    el.classList.add('loading');
    el.textContent = was + ' (writing its guide…)';
    const res = await browser.runtime.sendMessage({ type: 'pageGuide', kind, k, label, lang });
    el.textContent = was;
    el.classList.remove('loading');
    if (!res || res.error) {
      alert((res && res.error) || 'Could not open that guide.');
      return null;
    }
    await load();
    const now = guides.find((x) => x.k === want) || guides.find((x) => x.name === label);
    if (now) show(now);
    return null;
  }

  // A song: artwork, where to play it again, and its guide (or how to get one).
  function showSong(g, view) {
    const x = g.song || {};
    const head = h('div', 'head song-head');
    if (x.art) {
      const img = h('img', 'song-art');
      img.src = x.art;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      head.append(img);
    }
    const names = h('div', 'song-names');
    names.append(h('h2', '', x.track || g.name), h('div', 'meta', [x.artist, x.album].filter(Boolean).join(' · ')));
    const meta = h('div', 'meta');
    if (x.url) {
      const a = h('a', '', 'Play it again');
      a.href = x.url;
      a.target = '_blank';
      a.rel = 'noopener';
      meta.append(a);
    }
    if (g.model) meta.append(document.createTextNode((x.url ? ' · ' : '') + SG.modelLabel(g.model) + ' · ' + new Date(g.savedAt).toLocaleDateString()));
    names.append(meta);
    head.append(names);
    view.append(head);
    if (x.artist) {
      const aBtn = h('button', '', `About ${x.artist}'s songs`);
      aBtn.title = 'Recurring words, themes and style across the songs you have studied by this artist';
      const aBody = h('article', 'guide lesson');
      aBtn.addEventListener('click', async () => {
        aBtn.disabled = true;
        aBody.textContent = 'Writing…';
        const res = await browser.runtime.sendMessage({ type: 'artistGuide', artist: x.artist });
        aBody.textContent = '';
        if (!res || res.error) aBody.textContent = (res && res.error) || 'Could not write it.';
        else renderLesson(aBody, res.text, [], langOf(g) || 'ko', null);
      });
      view.append(aBtn, aBody);
    }
    const body = h('article', 'guide');
    if (!g.noGuide) {
      // Rewrite (e.g. in the newer format), with the cost up front; the old version goes to history.
      const redo = h('div', 'cost-choice');
      const r1 = h('button', '', 'Rewrite this guide');
      const go = async () => {
        redo.textContent = 'Rewriting… (a minute or two)';
        const res = await browser.runtime.sendMessage({ type: 'songGuideRedo', key: g.key });
        if (!res || res.error) {
          redo.textContent = (res && res.error) || 'Could not rewrite it.';
          return;
        }
        g.text = res.text;
        g.model = res.model;
        redo.textContent = '';
        body.textContent = '';
        renderLesson(body, res.text, [], langOf(g) || 'ja', null);
      };
      r1.addEventListener('click', () => go());
      redo.append(r1);
      view.append(redo);
    }
    if (g.noGuide) body.append(h('p', 'none', 'No guide for this song yet. Play it, open the panel (G) → Song → Write the song guide.'));
    else renderLesson(body, g.text, [], langOf(g) || 'ja', null);
    view.append(body);
    if (!g.noGuide) {
      const tools = h('div', 'tools');
      const del = h('button', '', 'Delete this guide');
      del.addEventListener('click', async () => {
        await SG.cache.remove('guides', g.key);
        current = '';
        history.replaceState(null, '', location.pathname);
        load();
      });
      tools.append(del);
      view.append(tools);
    }
  }

  function show(g) {
    current = g.k;
    for (const a of $('list').children) a.classList.toggle('on', a.getAttribute('href') === '#' + encodeURIComponent(g.k));
    const view = $('view');
    view.textContent = '';
    const head = h('div', 'head');
    if (kindOf(g) === 'song') return showSong(g, view);
    if (kindOf(g) === 'show') return showShow(g, view);
    head.append(h('div', 'eyebrow', kindOf(g) === 'word' ? 'Word guide · ' + wordGroup(g) : 'Grammar · ' + grammarGroup(g)));
    head.append(h('h2', '', g.name || g.k));
    const meta = h('div', 'meta');
    meta.append(document.createTextNode(SG.lang.langName(langOf(g))));
    if (g.sentence) {
      const q = h('q', '', g.sentence);
      if (g.lang) q.lang = g.lang;
      meta.append(document.createTextNode(' · first met in '), q);
    }
    meta.append(document.createTextNode(' · ' + new Date(g.savedAt).toLocaleDateString() + (g.model ? ' · ' + SG.modelLabel(g.model) : '') + (g.updatedAt && g.rewritten ? ' (updated ' + new Date(g.updatedAt).toLocaleDateString() + ')' : '')));
    head.append(meta);
    const tools = h('div', 'tools');
    const del = h('button', '', 'Delete this guide');
    del.title = 'The next time you meet it, Langtitles writes a fresh guide';
    del.addEventListener('click', async () => {
      await SG.cache.remove('guides', g.key);
      current = '';
      history.replaceState(null, '', location.pathname);
      load();
    });
    tools.append(del);
    // Every line you've met it in, with what it meant there.
    let enc = null;
    if (Array.isArray(g.encounters) && g.encounters.length) {
      enc = h('details', 'encounters');
      const lines = [{ sentence: g.sentence, meaning: '' }].concat(g.encounters).filter((x, i, all) => x.sentence && all.findIndex((y) => y.sentence === x.sentence) === i);
      enc.append(h('summary', '', `Lines you've met it in · ${lines.length}`));
      const ul = h('ul');
      for (const e of lines) {
        const li = h('li');
        const q = h('q', '', e.sentence);
        if (g.lang) q.lang = g.lang;
        li.append(q);
        if (e.meaning) li.append(document.createTextNode(' — ' + e.meaning));
        if (e.why) li.append(h('div', 'why', e.why));
        ul.append(li);
      }
      enc.append(ul);
    }
    const body = h('div', 'guide');
    if (g.lang) body.lang = g.lang;
    SG.renderGuide(body, SG.guideText.withoutSections(g.text, ['Where you met it', "Other uses you've met"]), { known: knownKanji });
    view.append(head, tools, body, ...(enc ? [enc] : []));
    window.scrollTo(0, 0);
  }

  // ---- Check my guides: finds guides that need rewriting, with the reason, and rewrites the ones ticked.
  async function checkup() {
    const view = $('view');
    view.textContent = '';
    view.append(h('h2', '', 'Check my guides'), h('p', 'sub', 'Looking through your guides…'));
    let builtin = {};
    try {
      for (const l of ['ja', 'ko', 'zh']) Object.assign(builtin, (await (await fetch(`../data/grammar/${l}.json`)).json()).forms || {});
    } catch (e) {
      /* no built-in guides */
    }
    // Free tidy first: notes that were appended per line ("Other uses you've met", "Where you met it") come out
    // of the saved text (kept in history), since the guide now stays general and lines are listed separately.
    const tidied = await browser.runtime.sendMessage({ type: 'tidyGuides' }).catch(() => null);
    if (tidied && tidied.count) guides = (await SG.cache.getAll('guides')).sort((a, b) => b.savedAt - a.savedAt);
    const problems = [];
    for (const g of guides) {
      const why = [];
      const parts = String(g.k || '').split('.');
      const isWord = parts[0] === 'word';
      const d = parts.slice(2).join('.');
      const text = g.text || '';
      if (g.kind === 'name' || g.kind === 'song') continue;
      if (isWord && SG.canonicalForm(`${parts[1]}.fn_${d}`) !== `${parts[1]}.fn_${d}`) why.push('Grammar written up as a word: it should be a grammar guide.');
      if (isWord && /(set phrase|fixed expression|idiom|compound particle|part of the (?:pattern|phrase|expression))/i.test(SG.guideText.section(text, 'What it means').slice(0, 600))) why.push('Probably filed under one word of a phrase: check whether the phrase has its own guide.');
      if (SG.guideText.hasRomaji(text)) why.push('Contains romaji.');
      if (g.sentence && SG.guideText.leansOnLine(text, g.sentence)) why.push('Written around one line (' + g.sentence.slice(0, 24) + (g.sentence.length > 24 ? '…' : '') + ') instead of in general: it reads wrong in other lines.');
      if (/garbled|can't say for sure|probably not the word/i.test(text)) why.push('Calls something a subtitle error or isn\'t sure: worth a second look.');
      const heads = (text.match(/^## /gm) || []).length;
      if (heads < 4) why.push('Missing sections.');
      if (g.kind === 'grammar' && builtin[g.k] && g.model !== 'built-in' && g.model !== 'rewrite') why.push('A built-in guide exists for this (free to swap in).');
      if (!text.includes('{') && /[\u4e00-\u9fff]/.test(text)) why.push('No furigana.');
      if (why.length) problems.push({ g, why });
    }
    view.textContent = '';
    view.append(h('h2', '', 'Check my guides'));
    if (tidied && tidied.count) view.append(h('p', 'sub', `Tidied ${tidied.count} guide${tidied.count === 1 ? '' : 's'} for free: removed notes that had been added for single lines (old versions are in history).`));
    if (!problems.length) {
      view.append(h('p', '', 'Everything looks fine.'));
      return;
    }
    const paid = problems.filter((p) => !(p.g.kind === 'grammar' && builtin[p.g.k])).length;
    view.append(h('p', 'sub', `${problems.length} guides could be better. Rewriting costs roughly 3¢ each with Sonnet or 6¢ with Opus (${paid} would cost anything; guides with a built-in version are swapped for free). Old versions are kept and your notes stay.`));
    const list = h('div', 'checkup');
    const boxes = [];
    for (const p of problems) {
      const row = h('label', 'checkup-row');
      const box = h('input');
      box.type = 'checkbox';
      box.checked = true;
      boxes.push([box, p]);
      const info = h('div');
      info.append(h('b', '', p.g.name || p.g.k));
      for (const w of p.why) info.append(h('div', 'sub', w));
      row.append(box, info);
      list.append(row);
    }
    const model = h('select');
    model.append(new Option('Rewrite with Sonnet', 'claude-sonnet-5-5'), new Option('Rewrite with Opus', 'claude-opus-5-5'));
    const go = h('button', 'checkup-btn', 'Rewrite ticked guides');
    const status = h('p', 'sub');
    go.addEventListener('click', async () => {
      go.disabled = true;
      const todo = boxes.filter(([b]) => b.checked).map(([, p]) => p);
      let n = 0;
      for (const p of todo) {
        status.textContent = `Rewriting ${++n} of ${todo.length}: ${p.g.name || p.g.k}…`;
        const res = await browser.runtime.sendMessage({ type: 'rewriteGuide', key: p.g.key, model: model.value });
        if (res && res.error) status.textContent = res.error;
      }
      status.textContent = `Done: ${todo.length} rewritten.`;
      go.disabled = false;
      await load();
    });
    view.append(list, model, go, status);
  }
  $('checkup').addEventListener('click', checkup);

  $('search').addEventListener('input', renderList);
  // Guides written while this tab is open show up when you come back to it.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
  window.addEventListener('hashchange', () => {
    const g = guides.find((x) => x.k === decodeURIComponent(location.hash.slice(1)));
    if (g) show(g);
  });
  await load();
})();
