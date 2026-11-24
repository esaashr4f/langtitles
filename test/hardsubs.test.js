'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../extension/shared/hardsubs.js');
const SG = globalThis.SG;

// A frame with a busy mid-tone picture, a large white object, and optionally outlined subtitle lines.
function frame(w, h, lines) {
  const px = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const set = (x, y, r, g, b) => {
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 90 + rnd() * 70, 110 + rnd() * 50, 60 + rnd() * 40);
  // a white pillow on a dark bed: bright, but not text
  for (let y = Math.floor(h * 0.55); y < h * 0.7; y++) for (let x = Math.floor(w * 0.2); x < w * 0.45; x++) set(x, y, 235, 232, 238);
  for (const [top, bottom] of lines) {
    for (let y = Math.floor(h * top); y < h * bottom; y++) {
      for (let x = Math.floor(w * 0.3); x < w * 0.7; x++) {
        const k = x % 5;
        if (k === 0 || k === 3) set(x, y, 10, 10, 10); // outline
        else if (k === 1 || k === 2) set(x, y, 250, 250, 250); // stroke
      }
    }
  }
  return px;
}

test('finds two burned-in subtitle lines and ignores bright objects', () => {
  const w = 384;
  const h = 216;
  // two lines from 79% to 86% and 87% to 94% of the height (like a typical anime site screenshot)
  const hit = SG.hardsubs.find(frame(w, h, [[0.79, 0.855], [0.87, 0.935]]), w, h);
  assert.ok(hit);
  assert.ok(Math.abs(hit.top - 0.21) < 0.02, String(hit.top));
  assert.ok(Math.abs(hit.bottom - 0.065) < 0.02, String(hit.bottom));
});

test('no subtitle: nothing found, even with a white object', () => {
  const w = 384;
  const h = 216;
  assert.strictEqual(SG.hardsubs.find(frame(w, h, []), w, h), null);
});

test('picture box inside a letterboxed video element', () => {
  const b = SG.hardsubs.pictureBox(1600, 1000, 1920, 1080);
  assert.strictEqual(Math.round(b.height), 900);
  assert.strictEqual(Math.round(b.top), 50);
});
