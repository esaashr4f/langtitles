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
  const kindOf = (g) => (g.kind === 'name' || g.group === 'phrase' || String(g.k).startsWith('phrase.') ? 'word' : g.kind || (String(g.k).startsWith('word.') ? 'word' : 'grammar'));

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  async function load() {
    guides = (await SG.cache.getAll('guides')).sort((a, b) => b.savedAt - a.savedAt);
    // A one-off note when Langtitles has corrected saved guides.
    const note = (await browser.storage.local.get('libraryFixNote')).libraryFixNote;
    const fixBox = $('fixNote');
    if (note && fixBox && !note.seen) {
      const s = note.summary.reduce((a, x) => ({ added: a.added + x.added, retired: a.retired + x.retired }), { added: 0, retired: 0 });
      fixBox.hidden = false;
      fixBox.textContent = `Your guides were updated: ${s.added} rewritten or new guides (phrases saved as phrases, grammar as grammar), ${s.retired} replaced. Old versions are kept.`;
      const ok = document.createElement('button');
      ok.textContent = 'OK';
      ok.addEventListener('click', () => {
        fixBox.hidden = true;
        browser.storage.local.set({ libraryFixNote: Object.assign(note, { seen: true }) });
      });
      fixBox.append(' ', ok);
    }
    const nWords = guides.filter((g) => kindOf(g) === 'word').length;
    $('count').textContent = `${nWords} word${nWords === 1 ? '' : 's'} · ${guides.length - nWords} grammar form${guides.length - nWords === 1 ? '' : 's'}`;
    const kinds = $('kinds');
    kinds.textContent = '';
    for (const [code, name] of [['grammar', `Grammar · ${guides.length - nWords}`], ['word', `Words · ${nWords}`]]) {
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
      const order = kind === 'word' ? WORD_ORDER : GROUP_ORDER;
      const map = new Map();
      for (const g of items) {
        const name = kind === 'word' ? wordGroup(g) : grammarGroup(g);
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(g);
      }
      groups = [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([n, list]) => [n, list.sort(byName)]);
    }
    if (!items.length) nav.append(h('p', 'none', q ? 'Nothing matches.' : kind === 'word' ? 'No word guides yet: open 📖 on a word while watching.' : 'No grammar guides yet: open a form in a word\'s Guides row while watching.'));
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

  function show(g) {
    current = g.k;
    for (const a of $('list').children) a.classList.toggle('on', a.getAttribute('href') === '#' + encodeURIComponent(g.k));
    const view = $('view');
    view.textContent = '';
    const head = h('div', 'head');
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
      enc.append(h('summary', '', `Met in ${g.encounters.length + (g.sentence ? 1 : 0)} lines`));
      const ul = h('ul');
      for (const e of [{ sentence: g.sentence, meaning: '' }].concat(g.encounters).filter((x) => x.sentence)) {
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
    SG.renderGuide(body, g.text, { known: knownKanji });
    view.append(head, tools, ...(enc ? [enc] : []), body);
    window.scrollTo(0, 0);
  }

  // ---- Check my guides: finds guides that need rewriting, with the reason, and rewrites the ones ticked.
  async function checkup() {
    const view = $('view');
    view.textContent = '';
    view.append(h('h2', '', 'Check my guides'), h('p', 'sub', 'Looking through your guides…'));
    let builtin = {};
    try {
      builtin = (await (await fetch('../data/grammar/ja.json')).json()).forms || {};
    } catch (e) {
      /* no built-in guides */
    }
    const problems = [];
    for (const g of guides) {
      const why = [];
      const parts = String(g.k || '').split('.');
      const isWord = parts[0] === 'word';
      const d = parts.slice(2).join('.');
      const text = g.text || '';
      if (g.kind === 'name') continue;
      if (isWord && SG.canonicalForm(`${parts[1]}.fn_${d}`) !== `${parts[1]}.fn_${d}`) why.push('Grammar written up as a word: it should be a grammar guide.');
      if (isWord && /(set phrase|fixed expression|idiom|compound particle|part of the (?:pattern|phrase|expression))/i.test(SG.guideText.section(text, 'What it means').slice(0, 600))) why.push('Probably filed under one word of a phrase: check whether the phrase has its own guide.');
      if (SG.guideText.hasRomaji(text)) why.push('Contains romaji.');
      if (/garbled|can't say for sure|probably not the word/i.test(text)) why.push('Calls something a subtitle error or isn\'t sure: worth a second look.');
      const heads = (text.match(/^## /gm) || []).length;
      if (heads < 4) why.push('Missing sections.');
      if (g.kind === 'grammar' && builtin[g.k] && g.model !== 'built-in' && g.model !== 'rewrite') why.push('A built-in guide exists for this (free to swap in).');
      if (!text.includes('{') && /[\u4e00-\u9fff]/.test(text)) why.push('No furigana.');
      if (why.length) problems.push({ g, why });
    }
    view.textContent = '';
    view.append(h('h2', '', 'Check my guides'));
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
