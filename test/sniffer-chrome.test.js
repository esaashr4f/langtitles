'use strict';
// Chrome: subtitle files passed on from the page (chrome/netcapture.js) go through the same checks.
const test = require('node:test');
const assert = require('node:assert');
require('../extension/shared/subtitles.js');
require('../extension/shared/lang.js');
require('../extension/background/sniffer.js');
const { sniffer } = globalThis.SG;

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n昨日、母に野菜を食べさせられた。\n\n00:00:04.000 --> 00:00:06.000\n今日は学校に行きたくない。\n';

test('a subtitle file passed on from the page becomes a track for its tab', () => {
  const seen = [];
  sniffer.onTrack((tabId, t) => seen.push([tabId, t.lang, t.cues.length]));
  assert.ok(sniffer.ingest(7, 'https://cdn.example/ep3/ja.vtt', 'text/vtt', VTT));
  assert.deepEqual(seen, [[7, 'ja', 2]]);
  assert.equal(sniffer.tracksFor(7).length, 1);
});

test('things that are not subtitles are turned away', () => {
  assert.equal(sniffer.ingest(8, 'https://example.com/app.js', 'application/javascript', VTT), false);
  assert.equal(sniffer.ingest(8, 'https://example.com/a.vtt', 'text/vtt', 'x'.repeat(7 * 1024 * 1024)), false);
  assert.equal(sniffer.tracksFor(8).length, 0);
});
