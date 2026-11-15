'use strict';
const test = require('node:test');
const assert = require('node:assert');
globalThis.browser = { storage: { local: {} } };
require('../extension/shared/settings.js');
const { wordClass } = globalThis.SG;

test('word classes from parts of speech', () => {
  const cases = {
    noun: 'noun', 'noun (time)': 'noun', pronoun: 'noun', 'proper noun': 'noun', 'noun + particle': 'noun', counter: 'noun',
    'verb, causative-passive, past': 'verb', 'verb, past polite': 'verb', 'suru verb': 'verb',
    'na-adjective': 'adjective', 'i-adjective, negative': 'adjective', adjective: 'adjective',
    adverb: 'adverb', 'adverb / noun': 'adverb',
    particle: 'particle', 'aspect particle': 'particle', 'auxiliary verb': 'particle', copula: 'particle', conjunction: 'particle', 'measure word': 'particle',
    interjection: 'other', expression: 'other', '': 'other',
  };
  for (const [pos, want] of Object.entries(cases)) assert.equal(wordClass(pos), want, pos);
});
