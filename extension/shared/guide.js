// Turns a grammar guide's plain text ("## " headings, "- " list items, "sentence — translation"
// examples) into DOM. Used by the video overlay and the grammar library page.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const HAN = /[㐀-䶿一-鿿豈-﫿々]/g;
  let knownKanji = null;
  let plainText = false;

  // "{食|た}べる" -> ruby: readings over kanji, left off kanji the learner knows.
  function rich(text) {
    const frag = document.createDocumentFragment();
    const re = /\{([^{}|]+)\|([^{}]+)\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
      const base = m[1];
      const chars = base.match(HAN) || [];
      if (plainText || (knownKanji && chars.length && chars.every((c) => knownKanji.has(c)))) {
        frag.append(document.createTextNode(base));
      } else {
        const r = document.createElement('ruby');
        r.append(document.createTextNode(base));
        const rt = document.createElement('rt');
        rt.textContent = m[2];
        r.append(rt);
        frag.append(r);
      }
      last = re.lastIndex;
    }
    if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
    // A half-streamed "{食|た" stays hidden until it is complete.
    return frag;
  }

  function span(cls, text) {
    const e = el('span', cls);
    e.append(rich(text));
    return e;
  }

  // Example lines: "<sentence> — <translation>". Showing the translation dimmer makes them scannable.
  function line(cls, text) {
    const div = el('div', cls);
    const at = text.indexOf(' — ');
    if (at > 0) {
      div.append(span('sg-g-ex', text.slice(0, at)), span('sg-g-ext', ' — ' + text.slice(at + 3)));
    } else {
      div.append(rich(text));
    }
    return div;
  }

  // Renders into `target`, replacing what was there. Works on partial (streaming) text too.
  // opts.known: a Set of kanji that need no reading.
  function renderGuide(target, text, opts) {
    knownKanji = opts && opts.known ? opts.known : null;
    plainText = Boolean(opts && opts.plain);
    text = String(text || '').replace(/\{[^{}]*$/, '');
    const frag = document.createDocumentFragment();
    for (const raw of String(text || '').split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      if (/^#{1,4}\s/.test(t)) frag.append(line('sg-g-h', t.replace(/^#{1,4}\s+/, '')));
      else if (/^[-•*]\s/.test(t)) frag.append(line('sg-g-li', t.replace(/^[-•*]\s+/, '')));
      else frag.append(line('sg-g-p', t));
    }
    target.textContent = '';
    target.append(frag);
  }

  SG.renderGuide = renderGuide;
})(typeof globalThis !== 'undefined' ? globalThis : this);
