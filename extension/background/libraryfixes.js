// Applies a set of fixes to the saved guides once (extension/data/library-fixes-<lang>.json):
// rewritten and new guides, guides retired in favour of the right phrase or grammar guide (the old
// version is kept in history so it can be restored), section corrections, romaji removal and names
// turned into one-line entries. Guides you've never saved are only added, never forced on you: an
// added guide is stored, and a retired guide you don't have is just an alias for later.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  // guides: [[storeKey, entry]]. Returns { put: [[key, entry]], remove: [key], history: [[key, entry]], aliases: {fromK: toK} }.
  function plan(guides, data, opts) {
    const now = (opts && opts.now) || Date.now();
    const keyFor = (opts && opts.keyFor) || ((k) => k);
    const byK = new Map();
    for (const [key, g] of guides) if (g && g.k) byK.set(g.k, [key, g]);
    const put = new Map();
    const remove = new Set();
    const history = [];
    const aliases = {};
    const pendingNotes = {};
    const current = (k) => (put.has(keyFor(k)) ? [keyFor(k), put.get(keyFor(k))] : byK.get(k));
    const keep = (key, g) => {
      history.push([key + '|' + now, Object.assign({}, g, { retiredAt: now })]);
    };
    for (const op of data.ops) {
      if (op.op === 'add') {
        const old = byK.get(op.k);
        const entry = {
          key: keyFor(op.k), k: op.k, name: op.name, kind: op.kind === 'grammar' ? 'grammar' : 'word', lang: data.lang,
          text: op.text, sentence: old ? old.sentence : '', word: old ? old.word : '', model: 'rewrite', rewritten: true,
          savedAt: old ? old[1].savedAt : now, updatedAt: now,
        };
        if (op.k.startsWith('phrase.')) entry.group = 'phrase';
        if (old) keep(old[0], old[1]);
        put.set(entry.key, entry);
      } else if (op.op === 'replace') {
        aliases[op.from] = op.to;
        const old = byK.get(op.from);
        if (!old) continue;
        keep(old[0], old[1]);
        remove.add(old[0]);
        const target = current(op.to);
        if (target) {
          // The kept guide inherits the line you met the old one in, if it has none.
          const t = Object.assign({}, target[1]);
          if (!t.sentence && old[1].sentence) t.sentence = old[1].sentence;
          t.updatedAt = now;
          put.set(target[0], t);
        } else {
          // Nothing to merge into: the old guide becomes the target under its new name.
          const moved = Object.assign({}, old[1], { k: op.to, key: keyFor(op.to), updatedAt: now, renamedFrom: op.from });
          put.set(moved.key, moved);
        }
      } else if (op.op === 'note') {
        const note = { text: op.text, sentence: op.sentence || '', at: now, source: 'question' };
        const cur = current(op.k);
        if (cur) {
          const g = Object.assign({}, cur[1]);
          if (!(g.notes || []).some((n) => n.text === op.text)) g.notes = (g.notes || []).concat(note);
          put.set(cur[0], g);
        } else {
          (pendingNotes[op.k] = pendingNotes[op.k] || []).push(note);
        }
      } else if (op.op === 'section' || op.op === 'romaji' || op.op === 'name' || op.op === 'relink') {
        const cur = current(op.k);
        if (!cur) continue;
        const g = Object.assign({}, cur[1]);
        keep(cur[0], cur[1]);
        if (op.op === 'section') g.text = SG.guideText.replaceSection(g.text, op.heading, op.text);
        if (op.op === 'romaji') g.text = SG.guideText.stripRomaji(g.text);
        if (op.op === 'name') {
          g.text = '## What it means\n' + op.text;
          g.kind = 'name';
        }
        if (op.op === 'relink' && String(g.sentence || '').replace(/\s+/g, '') === op.line.replace(/\s+/g, '')) g.sentence = '';
        g.updatedAt = now;
        put.set(cur[0], g);
      }
    }
    for (const key of put.keys()) remove.delete(key);
    return { put: Array.from(put.entries()), remove: Array.from(remove), history, aliases, pendingNotes };
  }

  async function applyAll(cache, keyFor) {
    const done = (await browser.storage.local.get('libraryFixes')).libraryFixes || {};
    const summary = [];
    for (const lang of ['ja']) {
      let data;
      try {
        data = await (await fetch(browser.runtime.getURL(`data/library-fixes-${lang}.json`))).json();
      } catch (e) {
        continue;
      }
      if ((done[lang] || 0) >= data.version) continue;
      const guides = await cache.entries('guides');
      const p = plan(guides, data, { keyFor });
      if (p.history.length) await cache.putMany('history', p.history);
      if (p.put.length) await cache.putMany('guides', p.put);
      for (const key of p.remove) await cache.remove('guides', key);
      const stored = (await browser.storage.local.get('guideAliases')).guideAliases || {};
      done[lang] = data.version;
      const waiting = (await browser.storage.local.get('guideNotes')).guideNotes || {};
      for (const [k, list] of Object.entries(p.pendingNotes)) {
        const have = waiting[k] || [];
        waiting[k] = have.concat(list.filter((n) => !have.some((x) => x.text === n.text)));
      }
      await browser.storage.local.set({ guideAliases: Object.assign(stored, p.aliases), libraryFixes: done, guideNotes: waiting });
      summary.push({ lang, added: data.ops.filter((o) => o.op === 'add').length, retired: p.remove.length, changed: p.put.length });
    }
    if (summary.length) {
      await browser.storage.local.set({ libraryFixNote: { at: Date.now(), summary } });
    }
    return summary;
  }

  SG.libraryFixes = { plan, applyAll };
})(typeof globalThis !== 'undefined' ? globalThis : this);
