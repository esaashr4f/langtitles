// Merging the word bank, known words and settings between computers (Firefox Sync, see
// background/cloudsync.js). Plain functions with no browser calls, so they can be tested.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  const stamp = (v) => (v && (v.updatedAt || v.savedAt || v.created || 0)) || 0;
  const KEEP_REMOVED = 90 * 24 * 3600 * 1000; // how long a removal is remembered

  // Settings that stay on one computer: keys and logins, and things about this computer only.
  const LOCAL_ONLY = ['panelOpen', 'settingsVersion', 'driveClientId', 'baseURL'];

  function syncedSettings(settings, secrets) {
    const out = {};
    for (const [k, v] of Object.entries(settings || {})) {
      if ((secrets || []).includes(k) || LOCAL_ONLY.includes(k)) continue;
      out[k] = v;
    }
    return out;
  }

  // A word bank entry without the heavy parts: one example line, a few forms it was met as,
  // and nothing over 1,500 characters. level 1 also drops the example line.
  function compactEntry(e, level) {
    const out = {};
    for (const [k, v] of Object.entries(e || {})) {
      if (k === 'contexts' || k === 'metAs') continue;
      if (v != null && typeof v === 'object' && JSON.stringify(v).length > 1500) continue;
      if (typeof v === 'string' && v.length > 1500) continue;
      out[k] = v;
    }
    if (!level && e.contexts && e.contexts[0]) {
      const c = e.contexts[0];
      const ctx = {};
      for (const k of ['sentence', 'translation', 'show', 'title', 'episode', 'time', 't', 'url', 'lang']) if (c[k] != null && c[k] !== '') ctx[k] = c[k];
      out.contexts = [ctx];
    }
    if (!level && e.metAs) out.metAs = e.metAs.slice(0, 3).map((m) => ({ s: m.s, m: m.m || '' }));
    return out;
  }

  // Remote entry over a local one: the newer fields win, and example lines from both are kept.
  function mergeEntry(local, remote) {
    const out = Object.assign({}, local, remote);
    const ctx = (remote.contexts || []).concat(local.contexts || []);
    const seen = new Set();
    out.contexts = ctx.filter((c) => c && !seen.has(c.sentence) && seen.add(c.sentence)).slice(0, 12);
    const met = (remote.metAs || []).concat(local.metAs || []);
    const seenM = new Set();
    out.metAs = met.filter((m) => m && !seenM.has(m.s) && seenM.add(m.s)).slice(0, 12);
    if (!out.metAs.length) delete out.metAs;
    return out;
  }

  // local: Map key -> entry. remote: { bank: [entry], removed: { key: time } } or null.
  // lastKeys: the keys this computer had after its last sync (to notice what you removed here).
  // Returns what to change here, and the removals to publish.
  function mergeBank(local, remote, lastKeys, now) {
    const removed = Object.assign({}, (remote && remote.removed) || {});
    for (const key of lastKeys || []) if (!local.has(key) && !(removed[key] >= now)) removed[key] = now;
    const puts = [];
    const removes = [];
    for (const r of (remote && remote.bank) || []) {
      if (!r || !r.key) continue;
      if (removed[r.key] && removed[r.key] >= stamp(r)) continue;
      const l = local.get(r.key);
      if (!l) puts.push([r.key, r]);
      else if (stamp(r) > stamp(l)) puts.push([r.key, mergeEntry(l, r)]);
    }
    for (const [key, at] of Object.entries(removed)) {
      const l = local.get(key);
      if (l && stamp(l) <= at) removes.push(key);
      // Re-added after it was removed: the removal no longer applies.
      if (l && stamp(l) > at) delete removed[key];
    }
    for (const [key, at] of Object.entries(removed)) if (now - at > KEEP_REMOVED) delete removed[key];
    return { puts, removes, removed };
  }

  // Known words ({ lang: [word] }) and known characters ({ lang: 'chars' }): union of both.
  function mergeKnown(a, b) {
    const out = Object.assign({}, a || {});
    for (const [lang, list] of Object.entries(b || {})) {
      if (typeof list === 'string') out[lang] = Array.from(new Set(Array.from((out[lang] || '') + list))).join('');
      else out[lang] = Array.from(new Set([].concat(out[lang] || [], list || [])));
    }
    return out;
  }

  function sameKnown(a, b) {
    const norm = (x) => JSON.stringify(Object.keys(x || {}).sort().map((k) => [k, typeof x[k] === 'string' ? Array.from(x[k]).sort().join('') : [].concat(x[k]).sort()]));
    return norm(a) === norm(b);
  }

  // Which settings win. mine changed since the last sync if its JSON differs from lastJson
  // (empty: this computer has never synced).
  function pickSettings(mine, remote, lastJson, lastRemoteAt) {
    const mineJson = JSON.stringify(mine);
    // A computer joining sync takes the settings already there, rather than replacing them with its defaults.
    if (!lastJson && remote && remote.settings) return { use: 'remote' };
    const mineChanged = mineJson !== lastJson;
    const remoteChanged = remote && remote.settings && (remote.settingsAt || 0) > (lastRemoteAt || 0);
    if (remoteChanged && !mineChanged) return { use: 'remote' };
    if (mineChanged || !remote || !remote.settings) return { use: 'mine' };
    return { use: 'same' };
  }

  SG.syncmerge = { syncedSettings, compactEntry, mergeEntry, mergeBank, mergeKnown, sameKnown, pickSettings, stamp, LOCAL_ONLY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
