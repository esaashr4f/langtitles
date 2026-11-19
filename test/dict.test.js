'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('../extension/shared/deinflect.js');
globalThis.browser = { runtime: { getURL: (p) => p } };
globalThis.fetch = async (p) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '../extension', p), 'utf8')) });
require('../extension/background/dict.js');
const SG = globalThis.SG;

test('deinflection finds dictionary forms', () => {
  const forms = (w) => SG.deinflect.deinflect(w).map((c) => c.form);
  assert.ok(forms('頑張って').includes('頑張る'));
  assert.ok(forms('食べさせられた').includes('食べる'));
  assert.ok(forms('高くなかった').includes('高い'));
  assert.ok(forms('行った').includes('行く'));
  assert.ok(forms('してる').includes('する'));
});

test('dictionary lookups, expressions and kanji', async () => {
  const r = await SG.dict.lookup('食べさせられた');
  assert.strictEqual(r.form, '食べる');
  assert.match(r.entries[0].s[0][1], /eat/);
  assert.match((await SG.dict.lookup('頑張っていた')).form, /^頑張/);
  assert.strictEqual((await SG.dict.lookup('取り巻く', '取り巻く')).entries[0].r[0], 'とりまく');
  const words = [{ s: '歯切れ' }, { s: 'が' }, { s: '悪い', d: '悪い' }, { s: 'ようだ' }];
  const ex = await SG.dict.expressions(words);
  assert.ok(ex.some((e) => e.d === '歯切れが悪い' && e.w.join() === '0,1,2'));
  const shop = await SG.dict.expressions([{ s: '店' }, { s: 'を' }, { s: '出した', d: '出す' }]);
  assert.ok(shop.some((e) => e.d === '店を出す'));
  const k = await SG.dict.kanjiInfo('頑');
  assert.ok(k.on.length && k.st > 0);
});

test('Korean dictionary', async () => {
  const c = await SG.dict.card('ko', '학교', '학교');
  assert.strictEqual(c.entries[0].read, '學校');
  const v = await SG.dict.card('ko', '먹어요', '');
  assert.strictEqual(v.form, '먹다');
  assert.ok((await SG.dict.hanjaInfo('學')).e);
});

test('Chinese dictionary', async () => {
  const c = await SG.dict.card('zh', '學校', '');
  assert.strictEqual(c.entries[0].read, 'xué xiào');
  assert.match(c.entries[0].senses[0][1], /school/);
});
