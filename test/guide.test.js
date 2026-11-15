'use strict';
// renderGuide only needs a tiny slice of the DOM; a stub keeps the test dependency-free.
const test = require('node:test');
const assert = require('node:assert');

class Node {
  constructor(tag) { this.tag = tag; this.className = ''; this.children = []; this._text = ''; }
  append(...kids) { for (const k of kids) { if (k.tag === '#frag') this.children.push(...k.children); else this.children.push(k); } }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
}
class Text {
  constructor(t) { this.tag = '#text'; this.className = ''; this.children = []; this._text = t; }
  get textContent() { return this._text; }
}
globalThis.document = {
  createElement: (tag) => new Node(tag),
  createDocumentFragment: () => new Node('#frag'),
  createTextNode: (t) => new Text(t),
};
require('../extension/shared/guide.js');

test('renderGuide turns headings, list items and examples into blocks', () => {
  const target = new Node('div');
  target.textContent = 'old';
  globalThis.SG.renderGuide(target, '## What it is\nMakes it causative.\n\n## When to use it\n- Being made to do something\n母に野菜を食べさせられた。 — My mom made me eat vegetables.\n## Partial');
  const kinds = target.children.map((c) => c.className);
  assert.deepEqual(kinds, ['sg-g-h', 'sg-g-p', 'sg-g-h', 'sg-g-li', 'sg-g-p', 'sg-g-h']);
  assert.equal(target.children[0].textContent, 'What it is');
  assert.deepEqual(target.children[4].children.map((c) => c.className), ['sg-g-ex', 'sg-g-ext']);
  assert.equal(target.children[4].children[1].textContent, ' — My mom made me eat vegetables.');
  assert.ok(!target.textContent.includes('old'));
});

test('readings over kanji, left off known kanji and while still streaming', () => {
  const t = new Node('div');
  globalThis.SG.renderGuide(t, '{母|はは}に{野菜|やさい}を{食|た}べさせられた。 — My mom made me eat vegetables.\n{未完', { known: new Set(['母']) });
  const ex = t.children[0].children[0];
  const kinds = ex.children.map((c) => c.tag);
  assert.deepEqual(kinds, ['#text', '#text', 'ruby', '#text', 'ruby', '#text']);
  assert.equal(ex.children[0].textContent, '母'); // known: no reading
  assert.equal(ex.children[2].children[1].textContent, 'やさい');
  assert.equal(t.children.length, 1); // the unfinished "{未完" waits for the rest
  const plain = new Node('div');
  globalThis.SG.renderGuide(plain, '{野菜|やさい}', { plain: true });
  assert.equal(plain.textContent, '野菜');
});
