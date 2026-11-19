'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
require('../extension/shared/guidetext.js');
require('../extension/background/libraryfixes.js');
const SG = globalThis.SG;
const data = JSON.parse(fs.readFileSync(require.resolve('../extension/data/library-fixes-ja.json'), 'utf8'));

test('guide text helpers', () => {
  assert.strictEqual(SG.guideText.stripRomaji('頑張って (ganbatte) means "do your best" (the sense here)'), '頑張って means "do your best" (the sense here)');
  assert.strictEqual(SG.guideText.stripRomaji('{食|た}べても (tabete mo)'), '{食|た}べても');
  const t = '## What it is\nA\n\n## Where you met it\nold';
  assert.strictEqual(SG.guideText.section(t, 'Where you met it'), 'old');
  assert.strictEqual(SG.guideText.section(SG.guideText.replaceSection(t, 'Where you met it', 'new'), 'Where you met it'), 'new');
  assert.strictEqual(SG.guideText.section(SG.guideText.replaceSection(t, 'Extra', 'x'), 'Extra'), 'x');
});

test('library fixes plan on a sample of saved guides', () => {
  const g = (k, extra) => ['guide|1|English|' + k, Object.assign({ key: 'guide|1|English|' + k, k, name: k, kind: k.startsWith('word.') ? 'word' : 'grammar', text: '## What it means\nx\n\n## Where you met it\nold', sentence: 'line of ' + k, savedAt: 1 }, extra || {})];
  const guides = [
    g('word.ja.関する'), g('word.ja.なり'), g('word.ja.こと'), g('ja.copula_da'), g('ja.copula_da_desu'),
    g('ja.te_form', { text: '頑張って (ganbatte) is…' }), g('word.ja.イルザ'), g('word.ja.では'),
    g('ja.particle_ni', { sentence: 'ことビルカー投資銀行の オーベルト氏殺害に関しては' }),
  ];
  const p = SG.libraryFixes.plan(guides, data, { keyFor: (k) => 'guide|1|English|' + k, now: 50 });
  const put = new Map(p.put);
  const removed = new Set(p.remove);
  assert.ok(removed.has('guide|1|English|word.ja.関する'));
  assert.ok(put.get('guide|1|English|phrase.ja.に関して').text.includes('compound particle'));
  assert.strictEqual(put.get('guide|1|English|phrase.ja.に関して').sentence, 'line of word.ja.関する', 'takes over the line the old guide was met in');
  assert.ok(removed.has('guide|1|English|word.ja.なり'));
  assert.ok(put.get('guide|1|English|ja.nari'));
  assert.ok(SG.guideText.section(put.get('guide|1|English|word.ja.こと').text, 'Where you met it').includes('not a garbled'));
  assert.ok(removed.has('guide|1|English|ja.copula_da'));
  assert.strictEqual(put.get('guide|1|English|ja.copula_da_desu').sentence, 'line of ja.copula_da_desu');
  assert.ok(!put.get('guide|1|English|ja.te_form').text.includes('ganbatte'));
  assert.strictEqual(put.get('guide|1|English|word.ja.イルザ').kind, 'name');
  assert.strictEqual(put.get('guide|1|English|ja.particle_ni').sentence, '');
  assert.strictEqual(p.aliases['word.ja.関する'], 'phrase.ja.に関して');
  assert.ok(p.history.length >= 8, 'old versions kept');
  for (const key of p.remove) assert.ok(!put.has(key));
});
