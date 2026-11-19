// Every question asked about a line, with its answer, grouped by show and episode.
(async function () {
  'use strict';
  const SG = globalThis.SG;
  const $ = (id) => document.getElementById(id);
  let all = [];
  let current = '';

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const groupOf = (x) => {
    const ep = x.episode;
    const show = (ep && ep.title) || x.show || 'Other';
    const epLabel = ep && ep.episode != null ? `Episode ${ep.episode}` : '';
    return { key: show + '|' + epLabel, show, ep: epLabel };
  };
  const fmt = (t) => (t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);

  async function load() {
    all = (await SG.cache.getAll('questions')).sort((a, b) => b.savedAt - a.savedAt);
    $('count').textContent = `${all.length} question${all.length === 1 ? '' : 's'}`;
    render();
  }

  function render() {
    const q = $('search').value.trim().toLowerCase();
    const items = all.filter((x) => !q || [x.q, x.a, x.sentence, x.translation, x.show].join('\n').toLowerCase().includes(q));
    const groups = new Map();
    for (const x of items) {
      const g = groupOf(x);
      if (!groups.has(g.key)) groups.set(g.key, Object.assign(g, { list: [] }));
      groups.get(g.key).list.push(x);
    }
    const nav = $('list');
    nav.textContent = '';
    for (const g of groups.values()) {
      const a = h('a', g.key === current ? 'on' : '');
      a.href = '#';
      const t = h('span', 't', g.show + (g.ep ? ' · ' + g.ep : ''));
      a.append(t, h('small', '', String(g.list.length)));
      a.addEventListener('click', (e) => {
        e.preventDefault();
        current = g.key;
        render();
      });
      nav.append(a);
    }
    const view = $('view');
    view.textContent = '';
    const pick = groups.get(current) || groups.values().next().value;
    if (!pick) {
      const empty = h('div', 'empty');
      if (all.length) empty.append(h('p', '', 'Nothing matches.'));
      else {
        empty.append(h('h2', '', 'No questions yet'));
        empty.append(h('p', '', "Ask about any line in the side panel's Line tab. Every question and answer is kept here, grouped by show and episode, and shown again under the same line when you come back to it."));
      }
      view.append(empty);
      return;
    }
    current = pick.key;
    for (const el of nav.children) el.classList.toggle('on', el.querySelector('.t').textContent === pick.show + (pick.ep ? ' · ' + pick.ep : ''));
    const head = h('div', 'head');
    head.append(h('h2', '', pick.show + (pick.ep ? ' · ' + pick.ep : '')));
    view.append(head);
    for (const x of pick.list) {
      const box = h('div', 'qa');
      const line = h('div', 'qa-line', x.sentence);
      if (x.lang) line.lang = x.lang;
      box.append(line);
      if (x.translation) box.append(h('div', 'qa-tr', x.translation));
      const meta = h('div', 'qa-meta');
      meta.append(document.createTextNode(new Date(x.savedAt).toLocaleString()));
      if (x.time != null && x.url) {
        const link = h('a', '', 'Watch at ' + fmt(x.time));
        link.href = x.url;
        link.target = '_blank';
        meta.append(link);
      }
      const del = h('button', 'qa-del', 'Delete');
      del.addEventListener('click', async () => {
        await SG.cache.remove('questions', x.id);
        load();
      });
      meta.append(del);
      box.append(meta, h('div', 'qa-q', x.q));
      const ans = h('div', 'qa-a guide');
      if (x.lang) ans.lang = x.lang;
      ans.textContent = x.a;
      box.append(ans);
      view.append(box);
    }
  }

  $('search').addEventListener('input', render);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
  await load();
})();
