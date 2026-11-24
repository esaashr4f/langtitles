'use strict';
// Two computers sharing one Firefox Sync area: each has its own local storage and word bank.
const test = require('node:test');
const assert = require('node:assert');

require('../extension/shared/settings.js');
require('../extension/shared/backup.js');
require('../extension/shared/syncmerge.js');
const SG = globalThis.SG;

function area(store) {
  return {
    async get(keys) {
      if (keys == null) return JSON.parse(JSON.stringify(store));
      const out = {};
      for (const k of [].concat(keys)) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
      return out;
    },
    async set(obj) {
      Object.assign(store, JSON.parse(JSON.stringify(obj)));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete store[k];
    },
  };
}

const syncStore = {};
function computer(name) {
  const local = {};
  const bank = new Map();
  return {
    name,
    local,
    bank,
    browser: { storage: { local: area(local), sync: area(syncStore) } },
    cache: {
      async entries() {
        return Array.from(bank.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]);
      },
      async putMany(_s, list) {
        for (const [k, v] of list) bank.set(k, JSON.parse(JSON.stringify(v)));
      },
      async remove(_s, key) {
        bank.delete(key);
      },
    },
  };
}

// cloudsync.js reads globals (browser, SG.cache), so load a fresh copy per computer.
function loadFor(c) {
  globalThis.browser = c.browser;
  SG.cache = c.cache;
  delete require.cache[require.resolve('../extension/background/cloudsync.js')];
  const saved = globalThis.browser;
  globalThis.browser = Object.assign({}, saved, { storage: Object.assign({}, saved.storage, { sync: undefined }) }); // no timers
  require('../extension/background/cloudsync.js');
  globalThis.browser = saved;
  return SG.cloudsync;
}
async function sync(c) {
  const mod = loadFor(c);
  globalThis.browser = c.browser;
  SG.cache = c.cache;
  return mod.check();
}

const word = (text, at, extra) => Object.assign({ key: 'word|ja|' + text, kind: 'word', lang: 'ja', text, savedAt: at, updatedAt: at, contexts: [{ sentence: text + 'を見た', show: 'Show' }] }, extra || {});

test('two computers end up with the same word bank, settings and known words', async () => {
  const a = computer('A');
  const b = computer('B');
  a.local.settings = { firefoxSync: true, apiKey: 'key-a', fontScale: 1.2 };
  b.local.settings = { firefoxSync: true, apiKey: 'key-b' };
  a.bank.set('word|ja|猫', word('猫', 1000));
  a.local.knownWords = { ja: ['は', 'の'] };
  b.bank.set('word|ja|犬', word('犬', 2000));
  b.local.known = { ja: '日本' };

  let r = await sync(a);
  assert.ok(r.done, JSON.stringify(r));
  r = await sync(b);
  assert.ok(r.done, JSON.stringify(r));
  await sync(a);

  for (const c of [a, b]) {
    assert.deepEqual(Array.from(c.bank.keys()).sort(), ['word|ja|犬', 'word|ja|猫']);
    assert.deepEqual(c.local.knownWords.ja.sort(), ['の', 'は']);
    assert.equal(c.local.known.ja, '日本');
  }
  // A's settings were the newest change, and B keeps its own API key.
  assert.equal(b.local.settings.fontScale, 1.2);
  assert.equal(b.local.settings.apiKey, 'key-b');
  assert.ok(!JSON.stringify(syncStore).includes('key-a'));

  // A word removed on B is removed on A too, and doesn't come back.
  b.bank.delete('word|ja|猫');
  await sync(b);
  await sync(a);
  assert.ok(!a.bank.has('word|ja|猫'));
  await sync(b);
  assert.ok(!b.bank.has('word|ja|猫'));

  // A review on A (newer srs) reaches B, and B's extra example line survives.
  b.bank.set('word|ja|犬', Object.assign(b.bank.get('word|ja|犬'), { contexts: [{ sentence: '犬が好き' }, { sentence: '犬を見た' }] }));
  a.bank.set('word|ja|犬', Object.assign(a.bank.get('word|ja|犬'), { srs: { state: 'review', interval: 5 }, updatedAt: 9000 }));
  await sync(a);
  await sync(b);
  const dog = b.bank.get('word|ja|犬');
  assert.equal(dog.srs.interval, 5);
  assert.ok(dog.contexts.some((c) => c.sentence === '犬が好き'));
});

test('a big word bank drops example lines before it would overflow', async () => {
  for (const k of Object.keys(syncStore)) delete syncStore[k];
  const c = computer('C');
  c.local.settings = { firefoxSync: true };
  // Random text so gzip can't shrink it much.
  const rand = (n) => Array.from({ length: n }, () => String.fromCharCode(0x4e00 + Math.floor(Math.random() * 2000))).join('');
  for (let i = 0; i < 400; i++) c.bank.set('word|ja|w' + i, word('w' + i, i + 1, { contexts: [{ sentence: rand(120), translation: rand(60) }] }));
  const r = await sync(c);
  assert.ok(r.done, JSON.stringify(r));
  const meta = syncStore['lt-meta'];
  assert.ok(meta.n <= 13);
  for (const [k, v] of Object.entries(syncStore)) assert.ok(JSON.stringify(v).length + k.length < 8192, k);
  assert.ok(r.level >= 1);
});

test('mergeBank keeps a word re-added after it was removed elsewhere', () => {
  const M = SG.syncmerge;
  const local = new Map([['word|ja|x', word('x', 500)]]);
  const out = M.mergeBank(local, { bank: [], removed: { 'word|ja|x': 100 } }, ['word|ja|x'], 1000);
  assert.deepEqual(out.removes, []);
  assert.ok(!('word|ja|x' in out.removed));
});
