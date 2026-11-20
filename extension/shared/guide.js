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
  let onLink = null;

  // "{食|た}べる" -> ruby: readings over kanji, left off kanji the learner knows.
  // "[[w:食べる|食べた]]" / "[[g:ja.te_form|て-form]]" -> a link to that word's or form's guide.
  function rich(text) {
    const frag = document.createDocumentFragment();
    const re = /\[\[(w|g|p):([^|\]]+)(?:\|([^\]]*))?\]\]|\{([^{}|]+)\|([^{}]+)\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        const kind = m[1];
        const key = m[2];
        const label = m[3] || m[2];
        const a = el('span', 'sg-g-link');
        a.append(rich(label));
        a.dataset.kind = m[1];
        a.dataset.k = m[2];
        if (onLink) {
          const cb = onLink;
          a.tabIndex = 0;
          a.setAttribute('role', 'link');
          a.title = kind === 'g' ? 'Open the guide to this form' : 'Open the guide to this word';
          const go = (e) => {
            e.preventDefault();
            e.stopPropagation();
            cb(kind, key, label.replace(/\{([^{}|]+)\|[^{}]+\}/g, '$1'), a);
          };
          a.addEventListener('click', go);
          a.addEventListener('keydown', (e) => e.key === 'Enter' && go(e));
        }
        frag.append(a);
        last = re.lastIndex;
        continue;
      }
      const base = m[4];
      const chars = base.match(HAN) || [];
      if (plainText || (knownKanji && chars.length && chars.every((c) => knownKanji.has(c)))) {
        frag.append(document.createTextNode(base));
      } else {
        const r = document.createElement('ruby');
        r.append(document.createTextNode(base));
        const rt = document.createElement('rt');
        rt.textContent = m[5];
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
  // opts.known: a Set of kanji that need no reading. opts.onLink(kind, key, label, el): links to guides.
  // opts.frame(n): an element for a "[[frame:n]]" line (a picture of the scene), or null.
  function renderGuide(target, text, opts) {
    knownKanji = opts && opts.known ? opts.known : null;
    plainText = Boolean(opts && opts.plain);
    onLink = opts && opts.onLink ? opts.onLink : null;
    text = String(text || '').replace(/\{[^{}]*$/, '').replace(/\[\[[^\]]*$/, '');
    const frag = document.createDocumentFragment();
    for (const raw of String(text || '').split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      const fm = /^\[\[frame:(\d+)\]\]$/.exec(t);
      if (fm) {
        const f = opts && opts.frame ? opts.frame(Number(fm[1])) : null;
        if (f) frag.append(f);
        continue;
      }
      if (/^###\s/.test(t)) frag.append(line('sg-g-h sg-g-h3', t.replace(/^###\s+/, '')));
      else if (/^>\s?/.test(t)) frag.append(line('sg-g-quote', t.replace(/^>\s?/, '')));
      else if (/^#{1,4}\s/.test(t)) frag.append(line('sg-g-h', t.replace(/^#{1,4}\s+/, '')));
      else if (/^[-•*]\s/.test(t)) frag.append(line('sg-g-li', t.replace(/^[-•*]\s+/, '')));
      else frag.append(line('sg-g-p', t));
    }
    target.textContent = '';
    target.append(frag);
  }

  SG.renderGuide = renderGuide;
})(typeof globalThis !== 'undefined' ? globalThis : this);
