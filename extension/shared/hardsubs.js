// Finds subtitles burned into the video picture (light text with a dark outline near the bottom),
// so Langtitles' own subtitles can sit just above them. Works on a small copy of one frame.
(function () {
  'use strict';
  const SG = (globalThis.SG = globalThis.SG || {});

  // rgba: Uint8ClampedArray of a w×h frame. Returns the burned-in subtitle block nearest the bottom,
  // as fractions of the frame height measured from the bottom ({ top, bottom }), or null.
  function find(rgba, w, h) {
    const from = Math.floor(h * 0.5); // only the lower half of the picture
    const x0 = Math.floor(w * 0.05);
    const x1 = Math.ceil(w * 0.95);
    const luma = new Uint8Array(w * h);
    for (let y = from; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        luma[y * w + x] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
      }
    }
    const lightTextAt = (x, y) => {
      const i = (y * w + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      return luma[y * w + x] >= 190 && Math.max(r, g, b) - Math.min(r, g, b) < 60;
    };
    const darkNear = (x, y) => {
      for (let d = 1; d <= 2; d++) {
        if (x - d >= 0 && luma[y * w + x - d] < 80) return true;
        if (x + d < w && luma[y * w + x + d] < 80) return true;
        if (y - d >= from && luma[(y - d) * w + x] < 80) return true;
        if (y + d < h && luma[(y + d) * w + x] < 80) return true;
      }
      return false;
    };
    // A text row has many outlined light pixels, with many light/dark changes along it, spread around the middle.
    const rows = [];
    for (let y = from; y < h; y++) {
      let n = 0;
      let flips = 0;
      let sumX = 0;
      let last = false;
      for (let x = x0; x < x1; x++) {
        const on = lightTextAt(x, y) && darkNear(x, y);
        if (on) {
          n++;
          sumX += x;
        }
        if (on !== last) flips++;
        last = on;
      }
      const centre = n ? sumX / n / w : 0;
      rows.push({ y, text: n >= (x1 - x0) * 0.015 && flips >= 10 && centre > 0.3 && centre < 0.7 });
    }
    // Join text rows into blocks; lines of one subtitle are close together.
    const gap = Math.max(2, Math.round(h * 0.035));
    const blocks = [];
    let cur = null;
    for (const r of rows) {
      if (!r.text) continue;
      if (cur && r.y - cur.end <= gap) {
        cur.end = r.y;
        cur.rows++;
      } else {
        cur = { start: r.y, end: r.y, rows: 1 };
        blocks.push(cur);
      }
    }
    // The subtitle is the lowest block of a plausible size: one or two lines of text.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const height = (b.end - b.start + 1) / h;
      if (height < 0.025 || height > 0.24 || b.rows / (b.end - b.start + 1) < 0.35) continue;
      return { top: (h - b.start) / h, bottom: (h - 1 - b.end) / h };
    }
    return null;
  }

  // Where the picture sits inside the <video> box (players letterbox it).
  function pictureBox(boxW, boxH, videoW, videoH) {
    if (!videoW || !videoH) return { top: 0, height: boxH };
    const scale = Math.min(boxW / videoW, boxH / videoH);
    const height = videoH * scale;
    return { top: (boxH - height) / 2, height };
  }

  SG.hardsubs = { find, pictureBox };
})();
