'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../extension/shared/grammar-ids.js');
const SG = globalThis.SG;
const ja = require('../extension/data/grammar/ja.json');

test('form identifiers are normalised to the fixed list', () => {
  assert.strictEqual(SG.canonicalForm('ja.te_form_request'), 'ja.te_form');
  assert.strictEqual(SG.canonicalForm('ja.Te-Form'), 'ja.te_form');
  assert.strictEqual(SG.canonicalForm('ja.chau'), 'ja.te_shimau');
  assert.strictEqual(SG.canonicalForm('ja.particle_yo'), 'ja.ending_yo');
  assert.strictEqual(SG.canonicalForm('ja.something_new'), 'ja.something_new');
  assert.strictEqual(SG.canonicalForm('word.ja.頑張る'), 'word.ja.頑張る');
  assert.strictEqual(SG.canonicalForm('ko.connective_aseo'), 'ko.connective_aseo');
});

test('built-in guides use fixed identifiers and the guide headings', () => {
  const ids = Object.keys(ja.forms);
  assert.ok(ids.length >= 25);
  for (const k of ids) {
    assert.ok(SG.GRAMMAR_IDS.ja.includes(k.slice(3)), k);
    const { name, text } = ja.forms[k];
    assert.ok(name && text.startsWith('## What it is'), k);
    assert.ok(/## When it seems to fit but doesn't/.test(text), k);
  }
});

test('release groups are read from subtitle file names', () => {
  require('../extension/shared/episode.js');
  const g = globalThis.SG.episode.releaseGroup;
  assert.strictEqual(g('[Kamigami] Monster - 05 [1080p].ass'), 'kamigami');
  assert.strictEqual(g('【DMG】Monster 05.srt'), 'dmg');
  assert.strictEqual(g('Monster.S01E05.720p.WEB-DL-NTb.srt'), 'ntb');
  assert.strictEqual(g('Monster - 05.ass'), '');
  assert.strictEqual(g('Monster.S01E05-720p.srt'), '');
  const k = globalThis.SG.episode.showKey;
  assert.strictEqual(k({ type: 'tv', tmdbId: 30981, season: 1, episode: 5 }, 'ja'), k({ type: 'tv', tmdbId: 30981, season: 1, episode: 6 }, 'ja'));
});
