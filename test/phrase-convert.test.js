'use strict';
// The phrase check relies on JMdict listing set phrases as expressions; make sure the ones the user met are there.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../extension/data/dict');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'ja-words.json'), 'utf8'));
const exact = (form) => (JSON.parse(fs.readFileSync(path.join(dir, `ja-words-${form.codePointAt(0) % meta.shards}.json`), 'utf8'))[form] || []);

test('set phrases the user met are dictionary expressions', () => {
  for (const p of ['に関して', '店を出す', '歯切れが悪い']) {
    const hit = exact(p).find((e) => e.s.some((x) => /exp/.test(x[0])));
    assert.ok(hit, p + ' should be an expression entry');
  }
});
