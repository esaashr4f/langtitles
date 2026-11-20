// Small text helpers for guides: sections, romaji, names.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  // Romaji in brackets straight after Japanese ("頑張って (ganbatte)", "は (wa)"). To be removed, the
  // bracket must read as Hepburn romaji and agree with the kana it follows ("って" -> "...tte"); after
  // kanji alone it must be Hepburn and not an English word. English glosses in brackets survive.
  const KANA = {
    あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
    さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
    だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
    ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
    や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'o', ん: 'n',
  };
  function kanaToRomaji(kana) {
    const hira = String(kana).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    let out = '';
    for (let i = 0; i < hira.length; i++) {
      const c = hira[i];
      const next = hira[i + 1];
      if (c === 'っ') {
        const r = KANA[next] || '';
        out += r.startsWith('ch') ? 't' : r[0] || '';
        continue;
      }
      if (next && 'ゃゅょ'.includes(next) && KANA[c]) {
        const y = { ゃ: 'a', ゅ: 'u', ょ: 'o' }[next];
        const base = KANA[c];
        out += /^(shi|chi|ji)$/.test(base) ? base.slice(0, -1) + y : base.slice(0, -1) + 'y' + y;
        i++;
        continue;
      }
      if (c === 'ー') {
        out += out.slice(-1);
        continue;
      }
      out += KANA[c] || '';
    }
    return out;
  }
  const norm = (r) => r.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s'\-]/g, '');
  const HEPBURN = /^(?:(?:ky|gy|sh|ch|ny|hy|by|py|my|ry|ts|j|[kgsztdnhbpmyrw])?[aiueo]|fu|n|(?:kk|ss|tt|pp|tch|ssh)[aiueo]|(?:kk|ss|tt|pp)(?:y|h)[aiueo])+$/;
  const KEEP = new Set(("on'yomi kun'yomi onyomi kunyomi rendaku ichidan godan kanji kana hiragana katakana furigana keigo jukujikun " +
    'okurigana kango wago gairaigo sonkeigo kenjougo teineigo').split(' '));
  const ENGLISH = new Set(('a i o an no to so do go be me we he she the one ten tan man men ban can den hen pen sun run gun fun bun nun ' +
    'home some same game name time tame dome mane sane bone tone zone done gone none note rate date gate hate mate sake bake make take ' +
    'wake site bite kite mite rite ride hide side tide wide rose nose pose hose dose tune dune june rune moon noon soon boon rude see ' +
    'one once mine wine dine nine pine line kin sin tin win bin pin din gin yen yes yo ah oh uh um hm message open ago are were').split(' '));
  const BRACKET = /([぀-ヿ一-鿿々{}|]+)\s?\(([^()\n]{1,40})\)/g;
  function isRomajiFor(japanese, inner) {
    // Pinyin (tone marks other than macrons) and learner terms stay.
    if (KEEP.has(inner.toLowerCase()) || /[áàǎéèěíìǐóòǒúùǔǖǘǚǜ]/.test(inner)) return false;
    const words = inner.toLowerCase().split(/[\s\-]+/).filter(Boolean);
    if (!words.length || words.every((w) => ENGLISH.has(w.replace(/'/g, '')))) return false;
    const r = norm(inner);
    // Syllables Hepburn doesn't use (di, ti, si, tu, hu…) mean it's English or pinyin, not romaji.
    if (!r || !HEPBURN.test(r) || /(?:^|[aiueon])(?:di|ti|si|zi|tu|du|hu|wu|wi|we|yi|ye)/.test(r)) return false;
    // Readings in furigana markup count as kana: {頑張|がんば}って -> がんばって
    const kana = japanese.replace(/\{[^|}]*\|([^}]*)\}/g, '$1').match(/[぀-ヿ]+$/);
    if (kana) {
      const k = norm(kanaToRomaji(kana[0]));
      const kOu = k.replace(/ou/g, 'o').replace(/uu/g, 'u');
      return Boolean(k) && (r.endsWith(k) || r.endsWith(kOu) || r.replace(/wa$/, 'ha').endsWith(k) || r.replace(/^o$/, 'wo') === k);
    }
    return words.length === 1 || words.every((w) => !ENGLISH.has(w));
  }
  function stripRomaji(text) {
    return String(text || '').replace(BRACKET, (all, jp, inner) => (isRomajiFor(jp, inner) ? jp : all));
  }
  function hasRomaji(text) {
    let found = false;
    String(text || '').replace(BRACKET, (all, jp, inner) => {
      if (isRomajiFor(jp, inner)) found = true;
      return all;
    });
    return found;
  }

  const sectionRe = (heading) => new RegExp('(^## ' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))', 'm');
  function section(text, heading) {
    const m = sectionRe(heading).exec(String(text || ''));
    return m ? m[2].trim() : '';
  }
  // Replaces a section's body, or appends the section when the guide doesn't have it.
  function replaceSection(text, heading, body) {
    const t = String(text || '');
    const re = sectionRe(heading);
    if (re.test(t)) return t.replace(re, (all, head) => head + body.trim() + '\n\n').trim();
    return (t.trim() + '\n\n## ' + heading + '\n' + body.trim()).trim();
  }

  // The guide without the named sections (and without a trailing blank).
  function withoutSections(text, headings) {
    let t = String(text || '');
    for (const hd of headings || []) t = t.replace(sectionRe(hd), '');
    return t.trim();
  }

  // Does the guide's general part lean on one line? (quotes it, or talks about "your line" / "here")
  function leansOnLine(text, sentence) {
    const body = withoutSections(text, ['Where you met it', "Other uses you've met"]);
    const firstPart = body.split(/^## /m).slice(0, 3).join('## ');
    const s = String(sentence || '').replace(/\s+/g, '');
    if (s.length >= 4 && firstPart.replace(/\s+/g, '').includes(s.slice(0, Math.min(12, s.length)))) return true;
    return /\b(in|on) (your|this|the) line\b|\bwhere you met it\b|\bin the line where\b/i.test(firstPart);
  }

  SG.guideText = { stripRomaji, hasRomaji, section, replaceSection, withoutSections, leansOnLine, kanaToRomaji };
})(typeof globalThis !== 'undefined' ? globalThis : this);
