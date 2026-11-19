'use strict';
const test = require('node:test');
const assert = require('node:assert');

// A tiny in-memory stand-in for browser.storage and the cache, enough for the backup module.
function env() {
  let storage = {};
  const stores = { bank: new Map(), guides: new Map(), questions: new Map(), picks: new Map(), chars: new Map(), strokes: new Map(), history: new Map(), lines: new Map(), deep: new Map(), subs: new Map() };
  globalThis.browser = {
    storage: { local: {
      get: async (k) => (k === null ? JSON.parse(JSON.stringify(storage)) : { [k]: storage[k] }),
      set: async (o) => { storage = Object.assign(storage, JSON.parse(JSON.stringify(o))); },
      clear: async () => { storage = {}; },
    } },
  };
  globalThis.SG = globalThis.SG || {};
  SG.cache = {
    entries: async (n) => Array.from((stores[n] || (stores[n] = new Map())).entries()),
    putMany: async (n, list) => { stores[n] = stores[n] || new Map(); for (const [k, v] of list) stores[n].set(k, v); },
    clearStore: async (n) => stores[n] && stores[n].clear(),
  };
  return { stores, get storage() { return storage; }, set storage(v) { storage = v; } };
}

test('backup round trip, encryption, merge and replace', async () => {
  const e = env();
  require('../extension/shared/backup.js');
  const B = globalThis.SG.backup;
  e.storage = { settings: { apiKey: 'secret', model: 'm' }, knownWords: { ja: ['食べる'] } };
  e.stores.bank.set('word|ja|食べる', { kind: 'word', text: '食べる', savedAt: 10 });
  e.stores.guides.set('g1', { k: 'ja.te_form', text: 'x', savedAt: 5 });
  const data = await B.collect({});
  assert.strictEqual(data.storage.settings.apiKey, undefined, 'keys left out by default');
  const s = B.summary(data);
  assert.strictEqual(s.words, 1);
  assert.strictEqual(s.guides, 1);

  const text = await B.serialize(data, 'pw');
  await assert.rejects(() => B.parse(text, ''), /passphrase/);
  await assert.rejects(() => B.parse(text, 'wrong'), /passphrase/);
  const back = await B.parse(text, 'pw');
  assert.deepStrictEqual(back.stores.bank, data.stores.bank);

  // merge: keeps current settings and adds known words and missing records
  e.storage = { settings: { apiKey: 'mine', model: 'other' }, knownWords: { ja: ['見る'] } };
  e.stores.bank.clear();
  e.stores.guides.set('g1', { k: 'ja.te_form', text: 'newer', savedAt: 99 });
  await B.restore(back, 'merge');
  assert.strictEqual(e.storage.settings.model, 'other');
  assert.deepStrictEqual(e.storage.knownWords.ja.sort(), ['見る', '食べる'].sort());
  assert.ok(e.stores.bank.has('word|ja|食べる'));
  assert.strictEqual(e.stores.guides.get('g1').text, 'newer', 'newer local copy wins');

  // replace: exactly the backup, but an API key already set here is kept
  await B.restore(back, 'replace');
  assert.strictEqual(e.storage.settings.model, 'm');
  assert.strictEqual(e.storage.settings.apiKey, 'mine');
  assert.strictEqual(e.stores.guides.get('g1').text, 'x');
});
