'use strict';
const test = require('node:test');
const assert = require('node:assert');
globalThis.browser = { storage: { local: {} } };
require('../extension/shared/settings.js');
const data = require('../extension/data/jlpt.json');
const level = (w) => globalThis.SG.jlptLevel(data, w);

test('JLPT levels by written form', () => {
  assert.equal(level({ s: '食べさせられた', d: '食べる' }), 5); // inflected: looked up by dictionary form
  assert.equal(level({ s: '野菜', d: '野菜' }), 5);
  assert.equal(level({ s: 'あそこ', d: 'あそこ' }), 5); // kana-only word
  assert.equal(level({ s: 'は', d: 'は' }), null); // the particle is not 歯 or 葉
  assert.equal(level({ s: 'の', d: 'の' }), null);
  const hard = Object.entries(data.kanji).find(([, n]) => n === 1)[0];
  assert.equal(level({ s: hard, d: hard }), 1);
});
