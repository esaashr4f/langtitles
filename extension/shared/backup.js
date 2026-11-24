// Backups: everything Langtitles keeps, in one file you can restore from (or move to another computer).
// Format: JSON { format: 'langtitles-backup', version, created, parts, storage, stores } or, when a
// passphrase is given, { format, version, encrypted: true, salt, iv, data } with the same JSON inside,
// encrypted with AES-GCM (key from the passphrase with PBKDF2-SHA-256).
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  const FORMAT = 'langtitles-backup';
  const VERSION = 1;
  // What a backup holds. Caches can be rebuilt (at a cost), so they're optional.
  const KEEP = ['bank', 'guides', 'questions', 'picks', 'chars', 'strokes', 'history', 'episodes', 'frames'];
  const CACHES = ['lines', 'deep', 'subs'];
  const SECRETS = ['apiKey', 'osApiKey', 'osUser', 'osPass', 'subdlKey', 'jimakuKey', 'backupPassphrase', 'tmdbKey'];
  // Storage keys that are only working state, not worth backing up.
  const SKIP_STORAGE = ['seasonJobs', 'backupState'];

  async function collect(opts) {
    opts = opts || {};
    const storage = await browser.storage.local.get(null);
    for (const k of SKIP_STORAGE) delete storage[k];
    if (storage.settings && !opts.includeKeys) {
      storage.settings = Object.assign({}, storage.settings);
      for (const k of SECRETS) delete storage.settings[k];
    }
    const stores = {};
    for (const name of KEEP.concat(opts.includeCaches ? CACHES : [])) stores[name] = await SG.cache.entries(name);
    return { format: FORMAT, version: VERSION, created: Date.now(), parts: { keys: Boolean(opts.includeKeys), caches: Boolean(opts.includeCaches) }, storage, stores };
  }

  function summary(data) {
    const n = (name) => ((data.stores || {})[name] || []).length;
    const bank = ((data.stores || {}).bank || []).map((e) => e[1] || {});
    const known = data.storage && data.storage.knownWords ? Object.values(data.storage.knownWords).reduce((a, l) => a + (l.length || 0), 0) : 0;
    return {
      created: data.created,
      words: bank.filter((x) => x.kind === 'word').length,
      characters: bank.filter((x) => x.kind === 'char').length,
      lines: bank.filter((x) => x.kind === 'line').length,
      grammar: bank.filter((x) => x.kind === 'grammar').length,
      guides: n('guides'),
      questions: n('questions'),
      knownWords: known,
      caches: data.parts && data.parts.caches,
      keys: data.parts && data.parts.keys,
    };
  }

  function describe(s) {
    const parts = [
      `${s.words} words`, `${s.characters} characters`, `${s.lines} lines`, `${s.grammar} grammar forms`,
      `${s.guides} guides`, `${s.questions} questions`, `${s.knownWords} known words`,
    ];
    return parts.join(', ') + (s.caches ? ', saved line breakdowns' : '') + (s.keys ? ', API keys' : '');
  }

  // ---- encryption
  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function keyFrom(pass, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function chunkedB64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }

  async function serialize(data, passphrase) {
    const json = JSON.stringify(data);
    if (!passphrase) return json;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(passphrase, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json)));
    return JSON.stringify({ format: FORMAT, version: VERSION, encrypted: true, salt: b64(salt), iv: b64(iv), data: chunkedB64(cipher) });
  }

  // Throws Error('passphrase') when the file is encrypted and no (or a wrong) passphrase was given.
  async function parse(text, passphrase) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error('This is not a Langtitles backup file.');
    }
    if (!obj || obj.format !== FORMAT) throw new Error('This is not a Langtitles backup file.');
    if (obj.encrypted) {
      if (!passphrase) throw new Error('passphrase');
      try {
        const key = await keyFrom(passphrase, unb64(obj.salt));
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.data));
        obj = JSON.parse(new TextDecoder().decode(plain));
      } catch (e) {
        throw new Error('passphrase');
      }
    }
    if (obj.version > VERSION) throw new Error('This backup comes from a newer Langtitles. Update Langtitles first.');
    return obj;
  }

  const stamp = (v) => (v && (v.updatedAt || v.savedAt || v.created || 0)) || 0;

  // mode 'merge': add what's missing, keep the newer of two copies; 'replace': make it exactly the backup
  // (API keys already set here are kept when the backup has none).
  async function restore(data, mode) {
    const current = await browser.storage.local.get(null);
    const incoming = Object.assign({}, data.storage || {});
    if (mode === 'replace') {
      const keep = {};
      if (current.settings) for (const k of SECRETS) if (current.settings[k] && !(incoming.settings || {})[k]) keep[k] = current.settings[k];
      if (incoming.settings) incoming.settings = Object.assign({}, incoming.settings, keep);
      await browser.storage.local.clear();
      await browser.storage.local.set(incoming);
      for (const name of Object.keys(data.stores || {})) {
        await SG.cache.clearStore(name);
        await SG.cache.putMany(name, data.stores[name]);
      }
      return;
    }
    // merge
    const out = {};
    for (const [k, v] of Object.entries(incoming)) {
      const cur = current[k];
      if (cur == null) out[k] = v;
      else if (k === 'settings') out.settings = Object.assign({}, v, cur); // your current settings win
      else if (k === 'knownWords' || k === 'known') {
        const merged = Object.assign({}, cur);
        for (const [lang, list] of Object.entries(v || {})) {
          if (typeof list === 'string') merged[lang] = Array.from(new Set(Array.from((cur[lang] || '') + list))).join('');
          else merged[lang] = Array.from(new Set([].concat(cur[lang] || [], list || [])));
        }
        out[k] = merged;
      } else if (k === 'spend' || k === 'usage' || k === 'history') {
        out[k] = Object.assign({}, v, cur);
      } else if (k === 'showPicks' || k === 'reviewLog') {
        out[k] = Object.assign({}, v, cur);
      }
    }
    await browser.storage.local.set(out);
    for (const [name, entries] of Object.entries(data.stores || {})) {
      const have = new Map(await SG.cache.entries(name));
      const put = entries.filter(([key, value]) => !have.has(key) || stamp(value) > stamp(have.get(key)));
      if (put.length) await SG.cache.putMany(name, put);
    }
  }

  function fileName(date) {
    const d = new Date(date || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `langtitles-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.langtitles`;
  }

  SG.backup = { collect, summary, describe, serialize, parse, restore, fileName, KEEP, CACHES, SECRETS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
