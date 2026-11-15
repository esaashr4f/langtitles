// Settings shared by the background page, content script, popup and options page.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  // Prices are USD per million tokens and only feed the spend estimate shown in the popup.
  SG.MODELS = [
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', inPrice: 4, outPrice: 20, note: 'Accurate breakdowns. Default.' },
    { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', inPrice: 8, outPrice: 40, note: 'Most capable, slowest and most expensive.' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', inPrice: 2, outPrice: 10, note: 'Faster, about half the cost of Opus.' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', inPrice: 0.1, outPrice: 0.5, note: 'Fastest and far cheaper; simpler explanations.' },
  ];

  SG.DEFAULTS = {
    enabled: true,
    disabledHosts: [],
    apiKey: '',
    baseURL: '', // advanced: an API-compatible proxy; empty means api.anthropic.com
    model: 'claude-opus-5-5', // guides, questions, character entries, review questions
    lineModel: 'claude-haiku-5-5', // line-by-line breakdowns and episode word lists: almost all of the cost
    effort: 'low',
    nativeLang: 'English',
    learning: ['ja', 'ko', 'zh'],
    hostLang: {}, // hostname -> language code the user last picked there
    hostSelectors: {}, // hostname -> CSS selector of the caption element picked with "Pick on page"
    lookaheadMin: 10, // minutes of subtitles to prepare ahead of the playhead; 0 = whole video
    chunkSize: 8,
    concurrency: 3,
    showParts: true,
    showMeaning: true,
    furigana: true, // hiragana over kanji you have not marked as known
    pinyin: true, // pinyin over Chinese characters
    hideKnownPinyin: true, // also hide pinyin over hanzi marked as known
    showRoles: true,
    showTranslation: true,
    fontScale: 1,
    autoFind: true, // load subtitles from subtitle sites when the site has none in your language
    osApiKey: '',
    osUser: '',
    osPass: '',
    subdlKey: '',
    jimakuKey: '',
    hanja: true, // hanja over Sino-Korean words
    toneColors: true, // pinyin coloured by tone
    pitchAccent: true, // Japanese pitch accent in the hover popup, word lists and review
    addGrammarToReview: true, // grammar forms you open guides for become review cards
    monthlyCap: 0, // stop Claude requests once this month's estimated spend reaches this many dollars; 0 = no cap
    glossClasses: ['noun', 'verb', 'adjective', 'adverb', 'particle', 'other'], // kinds of words that get notes above them
    jlptFrom: 5, // notes above Japanese words from this JLPT level up: 5 = every level, 4 = N4 and harder (N5 words plain), …
    hideKnownGlosses: true, // no meaning or pieces above words marked as known
    highlightNew: true, // mark words you haven't marked as known (once 20 are known in that language)
    pauseOnePlus: false, // pause after a line with exactly one new word
    slowReplay: true, // S replays the line slowed down
    slowRate: 0.75,
    newPerDay: 20, // new cards per day in review
    autoKnownFromReview: true, // words and characters you've learned in review count as known
    hoverPause: true,
    resumeOnLeave: true,
    autoDeep: true,
    hideNative: true,
    panelOpen: false,
  };

  // Annotations that can be switched on and off while watching (side panel and toolbar popup).
  SG.ANNOTATIONS = [
    { key: 'showMeaning', label: 'Meaning', title: 'What each word means, above it' },
    { key: 'showParts', label: 'Pieces', title: 'The pieces a word is built from, with what each does (x + y + z)' },
    { key: 'furigana', label: 'Furigana', title: 'Hiragana over kanji you have not marked known' },
    { key: 'pinyin', label: 'Pinyin', title: 'Pinyin over Chinese characters' },
    { key: 'toneColors', label: 'Tone colours', title: 'Pinyin coloured by tone' },
    { key: 'hanja', label: 'Hanja', title: 'Hanja over Sino-Korean words' },
    { key: 'showRoles', label: 'Roles', title: 'Coloured bars and labels for each phrase\'s job (subject, object, …)' },
    { key: 'showTranslation', label: 'Translation', title: 'The translation under the line' },
    { key: 'highlightNew', label: 'New-word underline', title: 'Underline words you have not marked known' },
    { key: 'hideKnownGlosses', label: 'Plain known words', title: 'No meaning or pieces above words you have marked known' },
  ];

  // Kinds of words, for choosing which get their meaning and pieces drawn above them.
  SG.WORD_CLASSES = [
    { key: 'noun', label: 'Nouns', title: 'Nouns, pronouns, names, numbers and counters' },
    { key: 'verb', label: 'Verbs', title: 'Verbs, in any form' },
    { key: 'adjective', label: 'Adjectives', title: 'Adjectives, including Japanese i- and na-adjectives' },
    { key: 'adverb', label: 'Adverbs', title: 'Adverbs' },
    { key: 'particle', label: 'Particles & endings', title: 'Particles, auxiliaries, copulas, conjunctions and measure words' },
    { key: 'other', label: 'Other', title: 'Interjections, set expressions and anything else' },
  ];

  // Sorts a word into one of those kinds from its part of speech ("verb, causative-passive, past",
  // "na-adjective", "noun + particle"): whichever kind is named first wins.
  const CLASS_PATTERNS = [
    ['particle', /\b(particle|auxiliary|copula|conjunction|postposition|classifier|measure word|suffix|ending)\b|助詞|助動詞/i],
    ['verb', /\bverbs?\b|動詞/i],
    ['adjective', /\badjectiv\w*|形容/i],
    ['adverb', /\badverb\w*|副詞/i],
    ['noun', /\b(noun|pronoun|proper|name|numeral|number|counter)\w*|名詞|代名詞/i],
  ];
  SG.wordClass = function (pos) {
    const text = String(pos || '');
    let best = 'other';
    let at = Infinity;
    for (const [key, re] of CLASS_PATTERNS) {
      const m = re.exec(text);
      if (m && m.index < at) {
        at = m.index;
        best = key;
      }
    }
    return best;
  };

  SG.JLPT_CHOICES = [
    { value: 5, label: 'All', title: 'Notes above Japanese words at every JLPT level' },
    { value: 4, label: 'N4+', title: 'No notes above N5 words' },
    { value: 3, label: 'N3+', title: 'No notes above N5 and N4 words' },
    { value: 2, label: 'N2+', title: 'No notes above N5 to N3 words' },
    { value: 1, label: 'N1', title: 'Notes only above N1 words (and words on no JLPT list)' },
  ];

  // JLPT level of a Japanese word (5 = N5 … 1 = N1), or null when it is on no list.
  // Data: Jonathan Waller's JLPT lists (tanos.co.uk, CC BY), extension/data/jlpt.json.
  // Words are matched by how they are written; kana-only words match only kana-only entries,
  // so the particle は is not mistaken for 歯 or 葉.
  SG.jlptLevel = function (data, w) {
    if (!data || !w) return null;
    const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
    for (const form of [w.d, w.s]) {
      if (!form) continue;
      const map = HAN.test(form) ? data.kanji : data.kana;
      if (map && map[form] != null) return map[form];
    }
    return null;
  };

  // Everything the content script may see. The API key never leaves the background page.
  SG.publicSettings = function (s) {
    const out = Object.assign({}, s);
    out.hasKey = Boolean(s.apiKey);
    out.subProviders = [s.osApiKey && 'opensubtitles', s.subdlKey && 'subdl', s.jimakuKey && 'jimaku'].filter(Boolean);
    for (const secret of ['apiKey', 'baseURL', 'osApiKey', 'osUser', 'osPass', 'subdlKey', 'jimakuKey']) delete out[secret];
    return out;
  };

  SG.loadSettings = async function () {
    const stored = await browser.storage.local.get('settings');
    return Object.assign({}, SG.DEFAULTS, stored.settings || {});
  };

  SG.saveSettings = async function (patch) {
    const next = Object.assign(await SG.loadSettings(), patch);
    await browser.storage.local.set({ settings: next });
    return next;
  };

  SG.hostEnabled = function (settings, hostname) {
    return Boolean(settings.enabled) && !(settings.disabledHosts || []).includes(hostname);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
