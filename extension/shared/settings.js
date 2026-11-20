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
    model: 'claude-opus-5-5', // the main model: anything without its own choice below
    // A model per feature ('' = the main model). Sonnet for most of the writing, Opus for new grammar forms.
    featureModels: {
      grammarGuides: 'claude-opus-5-5',
      wordGuides: 'claude-sonnet-5-5',
      kanji: 'claude-sonnet-5-5',
      episodeWords: 'claude-sonnet-5-5',
      review: 'claude-sonnet-5-5',
      ask: 'claude-sonnet-5-5',
      songGuides: 'claude-sonnet-5-5',
      lessons: 'claude-sonnet-5-5',
    },
    siteMode: {}, // host -> 'watch' | 'listen', set with the panel's switch
    lyricsSize: 'sheet', // Listen mode on music sites: 'strip' | 'sheet' | 'focus'
    singAlong: false, // Listen mode: readings only, bigger
    sceneFrames: true, // keep a small picture of the scene with saved lines, words and questions
    sceneToClaude: false, // also send that picture to Claude with a question (Use the scene)
    lyricGaps: false, // Listen mode: words you don't know yet are blanked until you hover them
    lineModel: 'claude-haiku-5-5', // line-by-line breakdowns and episode word lists: almost all of the cost
    effort: 'low',
    nativeLang: 'English',
    learning: ['ja', 'ko', 'zh'],
    hostLang: {}, // hostname -> language code the user last picked there
    hostSelectors: {}, // hostname -> CSS selector of the caption element picked with "Pick on page"
    lookaheadMin: 10, // minutes of subtitles to prepare ahead of the playhead; 0 = whole video
    chunkSize: 8,
    concurrency: 3,
    showParts: false, // the pieces (x + y + z) above words; they are always in the hover popup
    settingsVersion: 2,
    showMeaning: true,
    furigana: true, // hiragana over kanji you have not marked as known
    pinyin: true, // pinyin over Chinese characters
    hideKnownPinyin: true, // also hide pinyin over hanzi marked as known
    showRoles: true,
    showPhrases: true,
    phraseBrackets: false, // brackets over phrases on the subtitle (phrases are always in the word card and Line tab)
    autoAddNotes: false, // add the lesson from each Ask answer to its guides without asking
    matchCheck: true, // check saved guides against new lines (cheap model)
    checkGuides: true, // proofread new guides with the cheap model before saving
    showTranslation: true,
    fontScale: 1,
    // How the subtitles look: font (sans | rounded | serif), colour, background (none | shadow | box),
    // height above the bottom of the video (%), and an optional band covering burned-in subtitles.
    subFont: 'sans',
    subColor: '#ffffff',
    subBg: 'none',
    subBottom: 8,
    coverHardsubs: false,
    coverBottom: 5,
    coverHeight: 20,
    // Sit just above subtitles burned into the picture, following them as they move.
    followHardsubs: false,
    // While following them, blur the burned-in subtitles until you point at them.
    peekHardsubs: false,
    // Per-site layouts ({ host: { subBottom, subColor, … } }), for sites with burned-in subtitles.
    siteLooks: {},
    autoFind: true, // load subtitles from subtitle sites when the site has none in your language
    osApiKey: '',
    osUser: '',
    osPass: '',
    subdlKey: '',
    jimakuKey: '',
    tmdbKey: '', // optional: best posters for films and TV
    hanja: true, // hanja over Sino-Korean words
    toneColors: true, // pinyin coloured by tone
    pitchAccent: true, // Japanese pitch accent in the hover popup, word lists and review
    addGrammarToReview: true, // grammar forms you open guides for become review cards
    // Automatic backups to Downloads/Langtitles backups (see background/autobackup.js).
    autoBackup: true,
    backupEveryHours: 24,
    backupKeep: 4, // full snapshots kept; change files since the oldest kept snapshot are kept too
    backupCaches: false,
    backupKeys: false, // only when a passphrase is set
    backupPassphrase: '',
    monthlyCap: 0, // stop Claude requests once this month's estimated spend reaches this many dollars; 0 = no cap
    glossClasses: ['noun', 'name', 'verb', 'adjective', 'adverb', 'particle', 'other'], // kinds of words that get notes above them
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
    { key: 'phraseBrackets', label: 'Phrase brackets', title: 'A bracket with one meaning over set phrases and idioms (に関して, 歯切れが悪い). Off: phrases show in the word card (Part of …) and the Line tab only' },
    { key: 'showParts', label: 'Pieces', title: 'The pieces a word is built from, with what each does (x + y + z)' },
    { key: 'furigana', lang: 'ja', label: 'Furigana', title: 'Hiragana over kanji you have not marked known' },
    { key: 'pinyin', lang: 'zh', label: 'Pinyin', title: 'Pinyin over Chinese characters' },
    { key: 'toneColors', lang: 'zh', label: 'Tone colours', title: 'Pinyin coloured by tone' },
    { key: 'hanja', lang: 'ko', label: 'Hanja', title: 'Hanja over Sino-Korean words' },
    { key: 'showRoles', label: 'Roles', title: 'Coloured bars and labels for each phrase\'s job (subject, object, …)' },
    { key: 'showTranslation', label: 'Translation', title: 'The translation under the line' },
    { key: 'highlightNew', label: 'New-word underline', title: 'Underline words you have not marked known' },
    { key: 'hideKnownGlosses', label: 'Plain known words', title: 'No meaning or pieces above words you have marked known' },
  ];

  // Kinds of words, for choosing which get their meaning and pieces drawn above them.
  SG.WORD_CLASSES = [
    { key: 'noun', label: 'Nouns', title: 'Nouns, pronouns, numbers and counters' },
    { key: 'name', label: 'Names', title: 'Names of people, places, organisations and titles' },
    { key: 'verb', label: 'Verbs', title: 'Verbs, in any form' },
    { key: 'adjective', label: 'Adjectives', title: 'Adjectives, including Japanese i- and na-adjectives' },
    { key: 'adverb', label: 'Adverbs', title: 'Adverbs' },
    { key: 'particle', label: 'Particles & endings', title: 'Particles, auxiliaries, copulas, conjunctions and measure words' },
    { key: 'other', label: 'Other', title: 'Interjections, set expressions and anything else' },
  ];

  // Sorts a word into one of those kinds from its part of speech ("verb, causative-passive, past",
  // "na-adjective", "noun + particle"): whichever kind is named first wins.
  const CLASS_PATTERNS = [
    ['name', /\bproper\b|\b(personal|place|given|family|company|brand)\s+name\b|\bname\s+of\b|^name\b|人名|地名|固有名詞/i],
    ['particle', /\b(particle|auxiliary|copula|conjunction|postposition|classifier|measure word|suffix|ending)\b|助詞|助動詞/i],
    ['verb', /\bverbs?\b|動詞/i],
    ['adjective', /\badjectiv\w*|形容/i],
    ['adverb', /\badverb\w*|副詞/i],
    ['noun', /\b(noun|pronoun|numeral|number|counter)\w*|名詞|代名詞/i],
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

  // Settings a site can have its own value for.
  // Who wrote a guide, for the label under it.
  SG.modelLabel = function (id) {
    if (!id) return '';
    if (id === 'built-in') return 'Built in';
    if (id === 'rewrite') return 'Rewritten by Claude';
    const m = SG.MODELS.find((x) => x.id === id);
    return 'Written by ' + (m ? m.name.replace(/^Claude /, '') : id);
  };

  SG.FEATURES = [
    { key: 'grammarGuides', label: 'Grammar guides' },
    { key: 'wordGuides', label: 'Word and phrase guides' },
    { key: 'ask', label: 'Ask about a line' },
    { key: 'songGuides', label: 'Song guides' },
    { key: 'lessons', label: 'Episode lessons and whole-show guides' },
    { key: 'kanji', label: 'Kanji and character entries' },
    { key: 'episodeWords', label: 'Episode words' },
    { key: 'review', label: 'Review questions' },
  ];
  SG.modelFor = function (s, feature) {
    const m = (s.featureModels || {})[feature];
    return m || (SG.DEFAULTS && SG.DEFAULTS.featureModels && SG.DEFAULTS.featureModels[feature]) || s.model;
  };

  SG.LOOK_KEYS = ['subFont', 'subColor', 'subBg', 'fontScale', 'subBottom', 'coverHardsubs', 'coverBottom', 'coverHeight', 'showTranslation', 'followHardsubs', 'peekHardsubs'];

  SG.SUB_COLOURS = [
    ['#ffffff', 'White'],
    ['#fff4c2', 'Warm cream'],
    ['#ffe14d', 'Yellow'],
    ['#a8f0d0', 'Mint'],
    ['#b9dcff', 'Sky'],
    ['#ffc4dd', 'Rose'],
  ];

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
    for (const secret of ['apiKey', 'baseURL', 'osApiKey', 'osUser', 'osPass', 'subdlKey', 'jimakuKey', 'backupPassphrase', 'tmdbKey']) delete out[secret];
    return out;
  };

  SG.loadSettings = async function () {
    const stored = await browser.storage.local.get('settings');
    const s = Object.assign({}, SG.DEFAULTS, stored.settings || {});
    // Version 2: the pieces moved from above the words to the hover popup by default.
    if (stored.settings && (stored.settings.settingsVersion || 1) < 2) {
      s.showParts = false;
      s.settingsVersion = 2;
      await browser.storage.local.set({ settings: s });
    }
    return s;
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
