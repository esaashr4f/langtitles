'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../extension/shared/lyrics.js');
const L = globalThis.SG.lyrics;

test('LRC lines, repeated time tags and gaps', () => {
  const cues = L.parseLRC('[ar:Someone]\n[00:12.00]君の名前を\n[00:15.50][01:20.00]呼んでいる\n[00:19.00]\n[00:21.25]夜が明ける', 120);
  assert.deepStrictEqual(cues.map((c) => [c.start, c.text]), [[12, '君の名前を'], [15.5, '呼んでいる'], [21.25, '夜が明ける'], [80, '呼んでいる']]);
  assert.strictEqual(cues[0].end, 15.5);
  assert.strictEqual(cues[1].end, 19); // the empty line ends it
  assert.ok(cues[3].end <= 92);
});

test('offset header shifts every line', () => {
  const cues = L.parseLRC('[offset:+500]\n[00:10.00]a\n[00:12.00]b');
  assert.strictEqual(cues[0].start, 9.5);
});

test('enhanced LRC word timings', () => {
  const cues = L.parseLRC('[00:05.00]<00:05.00>夢を<00:05.80>見て<00:06.40>いた');
  assert.strictEqual(cues[0].text, '夢を見ていた');
  assert.deepStrictEqual(cues[0].words.map((w) => [w.start, w.text]), [[5, '夢を'], [5.8, '見て'], [6.4, 'いた']]);
});

test('plain lyrics are spread over the song and flagged unsynced', () => {
  const cues = L.plainToCues('a\n\nb\nc', 30);
  assert.strictEqual(cues.length, 3);
  assert.strictEqual(cues[1].start, 10);
  assert.ok(cues.every((c) => c.unsynced));
});

test('LRCLIB pick: closest length, synced first, wrong versions dropped', () => {
  const list = [
    { trackName: 'Song', artistName: 'A', duration: 250, syncedLyrics: '[00:01.00]x' },
    { trackName: 'Song', artistName: 'A', duration: 201, plainLyrics: 'x' },
    { trackName: 'Song', artistName: 'A', duration: 203, syncedLyrics: '[00:01.00]x' },
    { trackName: 'Song', artistName: 'A', duration: 200, instrumental: true },
  ];
  assert.strictEqual(L.pickRecord(list, { track: 'Song', artist: 'A', duration: 200 }).duration, 203);
  assert.strictEqual(L.pickRecord(list, { track: 'Song', duration: 400 }), null);
});

test('video titles to artist and track', () => {
  assert.deepStrictEqual(L.parseVideoTitle('YOASOBI「アイドル」 Official Music Video'), { artist: 'YOASOBI', track: 'アイドル' });
  assert.deepStrictEqual(L.parseVideoTitle('Aimer - Ref:rain (Official Music Video)'), { artist: 'Aimer', track: 'Ref:rain' });
  assert.deepStrictEqual(L.parseVideoTitle('【MV】夜に駆ける', 'Ayase / YOASOBI - Topic'), { artist: 'Ayase / YOASOBI', track: '夜に駆ける' });
  assert.ok(L.looksLikeSong('Lemon', 'Kenshi Yonezu - Topic'));
  assert.ok(!L.looksLikeSong('How to cook rice', 'Cooking Channel', 'Howto & Style'));
});

test('chorus repeats are counted', () => {
  const r = L.repeats([{ text: 'a' }, { text: 'b' }, { text: 'a' }, { text: 'a' }]);
  assert.strictEqual(r.get('a'), 3);
});
