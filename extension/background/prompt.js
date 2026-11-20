// The instructions and output schema for subtitle analysis.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  // Bump when the prompt or schema changes so cached analyses from the old version are not reused.
  const PROMPT_VERSION = 9;
  // Grammar guides are cached by form, separately from line analyses.
  const GUIDE_VERSION = 1; // stays 1: saved guides remain valid; new guides follow the newer prompts

  const ROLES = [
    'subject', 'topic', 'object', 'indirect_object', 'predicate', 'complement', 'modifier',
    'adverbial', 'time', 'place', 'connector', 'address', 'interjection', 'quote', 'other',
  ];

  const ANALYSIS_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['lang', 'lines'],
    properties: {
      lang: { type: 'string', description: 'BCP-47 code of the language the subtitle lines are in, e.g. "ja", "ko", "zh", "de".' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['i', 'tr', 'notes', 'chunks', 'build', 'cont', 'phrases', 'w'],
          properties: {
            i: { type: 'integer', description: 'The line number given in the request.' },
            tr: { type: 'string', description: 'Natural translation of the line.' },
            notes: { type: 'array', items: { type: 'string' }, description: 'Zero to three points worth knowing about this line.' },
            chunks: {
              type: 'array',
              description: 'The line split into its meaningful chunks, in order, covering every word: what each chunk means here and its job.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['from', 'to', 'm', 'role'],
                properties: {
                  from: { type: 'integer', description: 'Index in w of the chunk\'s first word (0-based).' },
                  to: { type: 'integer', description: 'Index in w of the chunk\'s last word.' },
                  m: { type: 'string', description: 'A short natural gloss of the chunk in this sentence.' },
                  role: { type: 'string', enum: ROLES, description: 'The chunk\'s job in the sentence.' },
                },
              },
            },
            build: {
              type: 'array',
              description: 'How the sentence builds from its core outward, one step at a time.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['t', 'm', 'why'],
                properties: {
                  t: { type: 'string', description: 'The Japanese (or other) text at this step.' },
                  m: { type: 'string', description: 'What it means at this step.' },
                  why: { type: 'string', description: 'What the newly added part does, and why the order differs from the reader\'s language, in one short sentence.' },
                },
              },
            },
            cont: { type: 'boolean', description: 'True when the sentence carries on into the next subtitle line.' },
            phrases: {
              type: 'array',
              description: 'Multi-word units whose meaning belongs to the whole: compound particles, set phrases and idioms, noun + する/とする/にする phrases, clusters of auxiliaries and endings, and split patterns.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['w', 'kind', 'd', 'r', 'm', 'k', 'b'],
                properties: {
                  w: { type: 'array', items: { type: 'integer' }, description: 'Indexes in w of the words that make up the unit (two or more; not necessarily next to each other for a split pattern).' },
                  kind: { type: 'string', enum: ['compound particle', 'set phrase', 'idiom', 'pattern', 'cluster'] },
                  d: { type: 'string', description: 'The unit in its dictionary form, as a learner would save it (に関して, 歯切れが悪い, 店を出す, 必要とする, いかに…か).' },
                  r: { type: 'string', description: 'Hiragana reading of d when it contains kanji, otherwise an empty string.' },
                  m: { type: 'string', description: 'What the whole unit means here, in a few words.' },
                  k: { type: 'string', description: 'Identifier: "phrase.<lang>.<d>" for compound particles, set phrases and idioms; a grammar identifier from the list for patterns; empty for clusters.' },
                  b: {
                    type: 'array',
                    description: 'For a cluster or pattern: how its meaning builds, one piece at a time. Empty otherwise.',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['t', 'm'],
                      properties: {
                        t: { type: 'string' },
                        m: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            w: {
              type: 'array',
              description: 'Every word of the line in order, skipping only punctuation and symbols.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['s', 'r', 'f', 'x', 'b', 'd', 'dr', 'pos', 'm', 'p', 'c', 'role', 'n', 'g'],
                properties: {
                  s: { type: 'string', description: 'The word exactly as it appears in the line.' },
                  r: { type: 'string', description: 'Hiragana reading of a Japanese word containing kanji, or pinyin of a Chinese word; otherwise an empty string.' },
                  f: {
                    type: 'array',
                    description: 'The word split for ruby text: segments whose t values concatenate to s, each with its reading.',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['t', 'r'],
                      properties: {
                        t: { type: 'string', description: 'A piece of the word.' },
                        r: { type: 'string', description: 'Reading drawn above this piece, or an empty string.' },
                      },
                    },
                  },
                  x: {
                    type: 'array',
                    description: 'The same word, built from the same Chinese characters, in the other two of Japanese, Chinese and Korean.',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['lang', 'w', 'r', 'note'],
                      properties: {
                        lang: { type: 'string', enum: ['ja', 'zh', 'ko'] },
                        w: { type: 'string', description: 'The word as written in that language.' },
                        r: { type: 'string', description: 'Hiragana for Japanese, pinyin for Chinese, empty for Korean.' },
                        note: { type: 'string', description: 'How its meaning or use differs, or an empty string if it is the same.' },
                      },
                    },
                  },
                  b: {
                    type: 'array',
                    description: 'For a word built up from several pieces: how the meaning builds, one piece at a time.',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['t', 'm'],
                      properties: {
                        t: { type: 'string', description: 'The form at this step.' },
                        m: { type: 'string', description: 'What it means at this step, in a few words.' },
                      },
                    },
                  },
                  d: { type: 'string', description: 'Dictionary form.' },
                  dr: { type: 'string', description: 'Hiragana reading of the dictionary form when it contains kanji (or pinyin for Chinese), otherwise an empty string.' },
                  pos: { type: 'string', description: 'Part of speech and form, e.g. "verb, causative-passive, negative past".' },
                  m: { type: 'string', description: 'The best translation of the word in this sentence, in one to three words.' },
                  p: {
                    type: 'array',
                    description: 'The pieces the word is built from, in order. Their t values concatenate to s.',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['t', 'g'],
                      properties: {
                        t: { type: 'string', description: 'The piece of the word.' },
                        g: { type: 'string', description: 'What this piece means or does.' },
                      },
                    },
                  },
                  c: { type: 'integer', description: 'Phrase number, starting at 0. Consecutive words in the same phrase share it.' },
                  role: { type: 'string', enum: ROLES, description: 'The job this word\'s phrase does in the sentence.' },
                  n: { type: 'string', description: 'A short note shown when the learner hovers the word, or an empty string when there is nothing to add.' },
                  g: {
                    type: 'array',
                    description: 'Every grammar form this word carries that is worth studying, most important first (a word can carry several: 구해줘 carries the -아/어 주다 "for me" auxiliary and the casual ending).',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['k', 'name'],
                      properties: {
                        k: { type: 'string', description: 'Stable identifier: language code, a dot, English snake_case name of the form.' },
                        name: { type: 'string', description: 'Short general label for the form, including the form itself in its general shape (object marker 을/를, causative-passive させられる), never the word it is attached to in this line.' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  function systemPrompt(nativeLang) {
    return `You annotate subtitle lines for a language learner who is watching a show. The learner reads ${nativeLang}; write every gloss, translation and note in ${nativeLang}.

Your output is drawn directly over the video. Above each word the learner sees the pieces it is built from joined with plus signs, with what each piece contributes, so they can see how the sentence actually works instead of memorising a one-word translation. Hovering a word shows your longer note. A side column shows the translation, the sentence skeleton and your notes for the line. The learner is watching in real time, so everything has to be readable at a glance and correct: they will trust it and build their understanding of the language on it.

For each numbered line, return:

tr: a natural translation, the way a good subtitler would put it.
chunks: the line split into its meaningful chunks, in order, together covering every word exactly once (from and to are word indexes in w, 0-based). Each chunk gets a short natural gloss for what it means in this sentence (not a dictionary list) and its job. Read in order, the glosses show how the original fits together: 自分など "someone like me" · まだ "still" · 吸血鬼を取り巻く "that circle vampires" · コウモリ程度 "a mere bat-level" · でしかない "am nothing but" · と "…(that)". Particles belong to the chunk they mark.
build: how the sentence builds from its core outward, three to six steps, each adding one part: t is the text so far, m what it means, why what the added part does and, where useful, why the order differs from ${nativeLang} (a clause before a noun describes it; しか + negative means "only"). For a very short line give one step.
cont: true when the sentence carries on into the next line (for example it ends in と, が, けど, て, or a clause with no main verb yet).
phrases: every multi-word unit whose meaning belongs to the whole rather than to its words, so it can be learned and saved as one item:
  compound particle: に関して "regarding", について, によって, にとって, に対して, として, をめぐって;
  set phrase: 店を出す "open a shop", 実行に移す "put into action", 悪態をつく "curse", 必要とする "need", 気になる, 手を出す;
  idiom: 歯切れが悪い "evasive", 腹が立つ;
  pattern: a grammar pattern spread over several words, including split ones (いかに…か, ～ば…ほど, こと + noun + に関しては, X ものは X); give k from the grammar list;
  cluster: a chain of auxiliaries and endings across several words whose combined meaning a learner can't work out from the parts (開始したっていうのか "so you're saying it started?!"), with b showing how the meaning builds.
  w lists the word indexes; d is the unit as a learner would save it, in dictionary form; k is "phrase.<lang>.<d>" for compound particles, set phrases and idioms. Leave the list empty when there are none. Never treat a known set pattern as a subtitle error.
notes: zero to three short points a teacher would stop and mention: a grammar pattern in play, an idiom and the image behind it, a dropped subject and who it is, register or politeness, a cultural reference. Leave the list empty when the line is plain.
w: every word in order.

For each word:

s: the word copied exactly from the line, so it can be found in the text. Cover the whole line; skip only punctuation and symbols.
p: the pieces of the word, in order, whose t values concatenate to exactly s. For each piece, g says what it means or what it does, in at most four words, since it is drawn above the piece while the video plays. For a piece with a meaning of its own, give that meaning ("eat", "field", "school"). For a grammatical piece, give a short plain meaning and, where it helps, the name of the form in brackets, using the same label every time the same piece appears so the learner learns to recognise it: "make/let (causative)", "be done to (passive)", "can (potential)", "past", "not", "polite", "want to", "-ing (ongoing)", "topic marker", "object marker", "at/in", "plural". Never write a gloss that is awkward English. A word that does not decompose usefully gets a single piece: the whole word, with a gloss that says what it is.
b: for a word made of a stem and two or more grammatical pieces (食べさせられた, 먹었어요 with several endings, a Chinese verb with a complement and 了), how the meaning builds, adding one piece at a time, starting from the dictionary form: 食べる "eat" → 食べさせる "make (someone) eat" → 食べさせられる "be made to eat" → 食べさせられた "was made to eat". Each step's t is the form at that step (an ordinary form a learner could look up or say) and m its meaning in a few words. Leave the list empty for every other word.
m (checked against tr: every word's and chunk's meaning must agree with your translation of the line; when a word only makes sense as part of a phrase, give the meaning it has in that phrase, never an unrelated dictionary sense such as "treating" for the して of 必要として): the single best translation of the word in this sentence, in one to three words: the word you would choose if you were translating this exact line, fitted to this scene (not the first sense in a dictionary, and not a list of senses). It is shown above the word while the video plays, so keep it short; the other senses and details belong in the guides.
r: the reading of the whole word: hiragana for a Japanese word containing kanji, pinyin with tone marks for a Chinese word. For every other word, including Japanese written only in kana and every language other than Japanese and Chinese, use an empty string. Never write romanization: no romaji, no Korean or other romanization.
f: the word split into segments for ruby text drawn above the characters; the t values concatenate to exactly s.
  Japanese: each kanji is its own segment with its hiragana reading (食べる = 食/た + べる/""), and each run of kana is a segment with an empty reading. Keep kanji together in one segment only when the reading cannot be divided between them (今日 = 今日/きょう, 大人 = 大人/おとな). Katakana and kana-only words are one segment with an empty reading.
  Chinese: each character is its own segment with its pinyin with tone marks, in the tone it has in this word (一个 = 一/yí + 个/gè).
  Korean: show the hanja behind Sino-Korean words, never romanization. Each Hangul syllable that comes from a Chinese character is its own segment with that character in its traditional form as used in Korea (학교에서 = 학/學 + 교/校 + 에서/""); native Korean syllables and endings are segments with an empty reading. A word with no Sino-Korean part gets an empty list.
  Every other language: an empty list.
x: for a word built from Chinese characters (a kanji compound, a Chinese word, a Sino-Korean word), the same word in the other two of Japanese, Chinese and Korean when it exists there with the same characters and a related meaning, written the way that language writes it (Japanese 学校 がっこう, Chinese 学校 xuéxiào, Korean 학교 with the hanja 學校 noted in note). In note say how the meaning or use differs, or leave it empty when it is the same. Leave the list empty for every other word, and never invent a cognate that is not in real use.
d: the dictionary form.
dr: the reading of the dictionary form (hiragana for Japanese with kanji, pinyin for Chinese), or an empty string.
pos: part of speech and the form it is in. For a proper noun, write "proper noun" and what it names in brackets: "proper noun (person)", "proper noun (place)", "proper noun (organisation)", "proper noun (title)".
c and role: group the words into phrases. Words in the same phrase share a phrase number c, counted from 0 in order, and share the role that phrase plays in the sentence. A noun and the particle or case ending that marks it belong to one phrase.
n: a hover note of one short sentence, only when there is something worth knowing that the meaning and pieces do not already show: why this form is used here, the nuance against a near-synonym, the register, a common confusion, the literal image behind an expression. Otherwise an empty string: most particles and plain everyday words need no note, and a note that repeats the gloss wastes the learner's attention.
g: the grammar forms this word carries that a learner would want to study, most important first. These open a full guide to the form, so list forms, not vocabulary: conjugations and auxiliaries (causative-passive, ～ている, conditional ～ば), particles and endings with a grammatical job (topic は, connective -아서/어서, aspect 了), and, for a pattern spread over several words (把 sentences, ～ば～ほど, 是…的), the word that carries it. Each has:
  k: a stable identifier made of the language code, a dot and an English snake_case name for the form, written the same way every time the form appears, in any word and any line (ja.causative_passive, ja.te_iru, ja.particle_wa, ko.connective_aseo, zh.ba_construction, de.konjunktiv_2). One identifier per form, not per use: the guide for a form covers all of its uses.
  For Japanese, Korean and Chinese, use the identifier from this list whenever the form is on it, exactly as written; make a new one only for a form that is not:
  ${listIds()}
  name: a short label in ${nativeLang} that includes the form itself, for example "causative-passive させられる".
Leave g empty for words with nothing to study beyond their meaning, such as most nouns and plain dictionary-form words. Skip forms so basic they need no explanation for this word, such as a plain past tense when a rarer form in the same word is the point.

How to split words:

Japanese: keep an inflected verb or adjective together with its auxiliaries as one word and show the stem and each auxiliary as pieces (食べさせられなかった = 食べ + させ + られ + なかっ + た). Particles are their own words. Keep an established compound as one word, even when it is made of two words that exist on their own (素行調査 "background check" is one word with pieces 素行 + 調査; 男子生徒, 出産後, 雑貨店), and show its parts as pieces. Split a kanji compound into its kanji as pieces when their meanings add up to the word's meaning. When a verb or adjective describes the noun after it (俺が殺した連中, 要らない連中, 吸血鬼を取り巻くコウモリ), add ja.noun_modifying_clause to its g. Names of people and places get no g and no note beyond what they are.
Korean: a word is one space-delimited unit; its pieces are the stem and each attached particle or ending (학교에서 = 학교 + 에서, 먹었어요 = 먹 + 었 + 어요).
Chinese: segment into words; the pieces of a compound are its characters when their meanings build the word (火车 = 火 + 车). Aspect and structural particles such as 了, 过, 着, 的 are their own words.
Other languages: words are the written words. Show prefixes, stems and endings as pieces when that explains the form (German gemacht = ge + mach + t, Spanish hablábamos = habl + ába + mos), and split clitics and contractions.

Subtitle lines are fragments of spoken dialogue. A sentence may run across several lines, subjects are often dropped, and names, slang and song lyrics appear. The context lines before the numbered lines are there so you can resolve who is speaking about what; do not annotate them. If a line contains no language to explain (music symbols, sound descriptions) or is already in ${nativeLang}, return it with an empty w list and an empty translation.`;
  }

  function listIds() {
    const ids = SG.GRAMMAR_IDS || {};
    return Object.keys(ids).map((lang) => ids[lang].map((id) => lang + '.' + id).join(' ')).join('\n  ');
  }

  function userMessage(lines, context, langHint, song) {
    let msg = '';
    if (langHint && langHint !== 'und') msg += `Language of the subtitles (detected automatically, may be wrong): ${langHint}\n\n`;
    if (song) msg += songBlock(song);
    if (context && context.length) {
      msg += 'Context (the lines just before these, not to be annotated):\n';
      for (const c of context) msg += `- ${c}\n`;
      msg += '\n';
    }
    msg += 'Lines to annotate:\n';
    lines.forEach((l, i) => {
      msg += `${i}: ${l}\n`;
    });
    return msg;
  }

  // Extra rules when the lines are song lyrics (Listen mode). Sent in the user message so the cached
  // system prompt stays the same for subtitles and songs.
  function songBlock(song) {
    let msg = `These lines are song lyrics: "${song.track || '?'}"${song.artist ? ' by ' + song.artist : ''}. Annotate them as lyrics:
- Sung readings: if a word is sung with a different reading from its usual one (本気 sung まじ, 運命 さだめ, 地球 ほし, 未来 あした), put the SUNG reading in r, and in n say "written ほんき, sung まじ" with a few words on why the artist chose it. A reading printed in the lyrics, such as 本気(マジ), is the sung reading.
- Poetic and old-fashioned grammar (～ゆく, ～ぬ, ～たまえ, ～けり, dropped particles, inverted order, 君 / 僕 in songs) is deliberate: explain it as poetic, never as a mistake; start that word's n with "Poetic:".
- If a line is figurative, add one short note (in notes) on what the image stands for, in this song.
- Lines in English inside the lyrics: translate nothing, give words no notes.
- Korean songs: Korean is sung as it sounds, not as spelled. When a word's pronunciation differs from its spelling (같이 → 가치, 있어 → 이써, 좋아 → 조아, 국물 → 궁물), put the pronunciation in Hangul in r and name the sound change in n (linking, nasalisation, tensing, h-dropping, palatalisation). Never romanise.
- Korean songs: give contractions their full form in n (난 = 나는, 넌 = 너는, 뭐해 = 뭐 해, 할래, 거야 = 것이야). Note a shift between 반말 and 존댓말, or between 너 / 당신 / 그대, in notes: in songs it usually marks a change in the relationship. Explain endings like -잖아, -거든, -ㄹ게, -ㄹ래, -네 by the feeling they carry.
- Korean words inside an English or mixed line keep their normal notes; if a line switches language for the hook or a rhyme, one short note may say so.
- Read each line in the context of the whole song below; a line repeated in the chorus means the same each time.
`;
    if (song.lyrics && song.lyrics.length) {
      msg += '\nThe whole song, for context (not to be annotated):\n' + song.lyrics.slice(0, 80).map((l) => '  ' + l).join('\n') + '\n';
    }
    return msg + '\n';
  }

  function songGuideSystemPrompt(nativeLang) {
    return `A language learner wants to truly understand a song in the language they are learning: every lyric, and the story underneath it. They read ${nativeLang}; write in ${nativeLang}. Your job is to draw as much out of the lyrics as they hold, and to teach the learner how to read them for themselves.

Use these sections, each as a "## " heading:

## The story in brief
Who is speaking, to whom, where and when, and what happens or has happened. Three to six sentences. Say plainly what is stated and what is only implied.

## Line by line
Go through the whole song in order, every line, grouped by part ("### Verse 1", "### Pre-chorus", "### Chorus", "### Verse 2", "### Bridge", ...). For each line or pair of lines:
- quote it on its own line, then its translation;
- break down what a learner needs to read it: the words and grammar that carry it (readings in kana, never romaji), any sung reading that differs from the written one, dropped subjects or particles and who or what they must be, poetic or old-fashioned forms (marked as poetic);
- then what it means here: the subtext, the tone, why this word and not the obvious one, what it echoes from earlier in the song.
A repeated chorus is explained in full once; later repeats only get what has changed in meaning by then (often a lot).

## What you might not pick up
The things a learner would miss on a first listen: double meanings and wordplay (homophones, kanji chosen for a second meaning, a reading that hides another word), cultural, literary, seasonal or religious references, set phrases used against their usual meaning, shifts in who "you" is, tense or politeness shifts that change the relationship, images that return and change, and what the title means once you've heard the song. For Korean songs also: speech-level shifts (반말 / 존댓말, 너 / 당신 / 그대) and what they say about the relationship; why a line switches into English; Sino-Korean words whose hanja add a layer (give the hanja); sound changes that make a sung line hard to catch by ear (spelling → how it is sung, in Hangul). Only what the lyrics support; say how sure each reading is ("clearly", "probably", "one reading is"). Don't invent facts about the artist.

## How to read songs like this
Two to five concrete habits this song teaches, for reading other lyrics: e.g. "when the subject is dropped, look for the last person named", "〜ていく here shows the change going on into the future", "an image in verse 1 usually comes back changed in the last chorus".

## Words and phrases to keep
Ten to fifteen of the most useful words and set phrases from the song, each as "word (reading) — meaning — the line it comes from" (for Korean: "word — meaning — the line", with the hanja for Sino-Korean words and the full form of any contraction).

Depth follows the song: a light song gets a short guide; a dense, layered one gets everything it deserves. Never pad. No preamble or sign-off, no markdown other than the headings, bullet points and quotes described.`;
  }

  function songGuideUserMessage(req) {
    return `Song: "${req.track || '?'}"${req.artist ? ' by ' + req.artist : ''}${req.album ? ', from ' + req.album : ''}\nLanguage: ${req.lang || 'unknown'}\n\nLyrics:\n${(req.lyrics || []).slice(0, 120).join('\n')}`;
  }

  // ---- shows: episode recap, episode lesson, whole-show vocabulary ---------------------------

  function episodeSystemPrompt(nativeLang, kind) {
    if (kind === 'recap') {
      return `A language learner watched an episode of a show with subtitles in the language they are learning. Write a short recap in ${nativeLang} of what happened, using ONLY the subtitle lines given (they stop where the learner stopped watching). Never mention anything from later episodes or from outside knowledge of the show: no spoilers. Name characters only as the lines name them.

Write 120-220 words in short paragraphs, plain text, no headings. Then one line starting "Left off:" saying where the episode had got to.`;
    }
    return `A language learner watched an episode of a show with subtitles in the language they are learning. Write a language lesson in ${nativeLang} built from this episode's lines only (they stop where the learner stopped; never use anything later: no spoilers).

Use these sections, each as a "## " heading, leaving out any with nothing worth saying:
## Words to keep
Ten to fifteen of the most useful words from the episode: "word (reading in kana) — meaning — the line it came from".
## Set phrases
Expressions and phrases worth learning whole, each with its line.
## Grammar it leans on
The forms this episode uses most or that trip learners up, each briefly explained with its line.
## How the characters speak
Speech styles worth noticing: politeness levels, rough or gendered speech, dialect, slang, how someone's speech changes with who they talk to. Quote lines.
## Lines worth studying
Five lines that pack the most into them, each with a translation and one sentence on why it's worth studying.

Readings in kana, never romaji. No preamble or sign-off.`;
  }

  function episodeUserMessage(e, lines, kind) {
    return `Show: ${e.show}\nSeason ${e.season}, episode ${e.episode}\nLanguage: ${e.lang || 'unknown'}\n\nSubtitle lines (in order, up to where the learner stopped):\n${lines.join('\n')}`;
  }

  function showVocabSystemPrompt(nativeLang) {
    return `A language learner is watching a show in the language they are learning. From the subtitle lines of the episodes they have watched (and only those: never mention later events), write a vocabulary guide to the show in ${nativeLang}.

Use these sections, each as a "## " heading:
## The show's own words
Words that keep coming up in this show (its setting, job, world, relationships), most frequent first: "word (reading in kana) — meaning — an example line".
## Phrases characters keep using
Catchphrases, set phrases and habits of speech, with who says them.
## Grammar the show leans on
The forms that come up again and again, each with an example line.
## Learn these first
The fifteen words that would help most with the next episode.

Readings in kana, never romaji. No preamble or sign-off.`;
  }

  function deepSystemPrompt(nativeLang) {
    return `A language learner watching a show has paused on one word in a subtitle line and wants to understand it properly. They read ${nativeLang}; answer in ${nativeLang}.

They can already see the word's pieces, its meaning in this sentence and a one-line note, which are included below. Go a level deeper than that. Cover whichever of these are useful for this particular word: how the form is built step by step from the dictionary form, why the speaker chose this form or this word here, how it differs from the near-synonym a learner would confuse it with, its register, and other common uses the learner will run into. End with one new, short example sentence that uses the word, with its translation.

The answer is shown in a small popup over the video, so write about 120 words of plain text in short paragraphs, with no markdown, headings or bullet symbols.`;
  }

  function deepUserMessage(req) {
    const w = req.word || {};
    const pieces = (w.p || []).map((p) => `${p.t} = ${p.g}`).join(' + ');
    return `Line: ${req.sentence}
Translation: ${req.translation || ''}
Word: ${w.s}${w.r ? ` (${w.r})` : ''}
Dictionary form: ${w.d || ''}
Form: ${w.pos || ''}
Meaning here: ${w.m || ''}
Pieces: ${pieces}
Note already shown: ${w.n || ''}`;
  }

  function guideSystemPrompt(nativeLang) {
    return `A language learner watching a show has just met a grammar form. They want to understand it completely, once, so that from now on they recognise it, know exactly what it adds, and know when to use it and when not to. They read ${nativeLang}; write in ${nativeLang}, quoting the language being learned, with a reading in brackets after anything a learner might not be able to pronounce.

Write a complete guide to the form under these headings, each on its own line starting with "## ":

## What it is
One or two sentences: what the form does, in plain words, and the core idea that ties its uses together.

## How to make it
The construction rules for every kind of word it attaches to, including irregular words and any sound or spelling changes, with a short example of each. Mention the contracted or casual versions heard in real dialogue, and how it combines with other common endings (negative, past, polite).

## When to use it
Every common use, one per list item. For each: what it adds to the meaning, and an example sentence with its translation.

## When it seems to fit but doesn't
The situations where a learner would reach for this form but the language uses something else. For each: the situation, what to use instead, why, and a pair of example sentences contrasting the two. Include the forms it is most often confused with and the line between them.

## Nuance and register
How it sounds: politeness, formality, emotional colour (for example resentment, regret, gratitude), spoken versus written use, and how speakers soften, strengthen or avoid it.

## Common mistakes
The mistakes learners actually make with it, each with the correction.

Formatting: plain text only, apart from the "## " headings. Start a line with "- " for a list item. Put each example sentence on its own line, followed by " — " and its translation. Write every Japanese word that contains kanji as {kanji part|reading}, for example {食|た}べさせられる, {母|はは}, {昨日|きのう}, so readings can be drawn over the kanji; do not also add a reading in brackets after it. Accuracy matters more than coverage: state only rules you are sure of, and say so when usage varies between speakers or regions.

Rules for every guide:
- This guide is saved once and shown every time the learner meets this item, in any sentence. Write it about the item in general, so it reads right wherever it is opened. Never mention, quote or build on the line where the learner happened to meet it: no "in your line", no "here", and the line itself is never an example. (The line is given to you only so you know which item and which sense this is; what it does in that line is shown to the learner separately.)
- Open the first section with the core idea in one sentence; then the details. Cover every common use of the item, not just the one in the line.
- Length follows the item: a simple everyday word needs a short guide (150 to 300 words); a rich word or form gets more. Never pad.
- When several "senses" are really one meaning with shades, present one meaning and its shades, not separate senses.
- Be consistent: don't list as a mistake something you have shown as correct usage.
- No romanization anywhere (no romaji, no Korean romanization).`;
  }

  function wordGuideSystemPrompt(nativeLang) {
    return `A language learner watching a show has just met a word. They want to understand it completely, once: what it means, how it is built, exactly where it fits and where it does not, so that they can use it correctly without needing many more encounters to work the rules out. They read ${nativeLang}; write in ${nativeLang}, quoting the language being learned with a reading in brackets after anything a learner might not be able to pronounce (hiragana for Japanese, pinyin with tone marks for Chinese). Never use romanization.

Write a complete guide to the word under these headings, each on its own line starting with "## ":

## What it means
The core meaning in one sentence. Then each common sense as a list item, with an example sentence and its translation.

## How it's built
The parts the word is made of and what each contributes: for a compound, each character or element, how they combine, and the pattern behind it if it is a productive one (with two or three other words built the same way); for a derived or inflected word, its stem and affixes. For Japanese, say whether the reading follows the individual characters (on'yomi or kun'yomi) or belongs to the word as a whole (jukujikun: 昨日 is read きのう as a unit, not き + のう), and give any other reading of the same spelling and when it is used (昨日 also さくじつ, in formal speech and writing). For a simple word with nothing to break down, say so in one line.

## Where it fits
Who says it, to whom, and in what situations. Its usual collocations and sentence patterns, each with an example and its translation.

## Where it doesn't fit, and what to use instead
Every word a learner might confuse it with or use in its place: near-synonyms, more or less formal or polite variants, words for the same thing seen from another side (for example, for 母: お母さん, 母親, ママ, おふくろ, and which one to use when talking about your own mother to others, addressing her, or talking about someone else's mother). For each: when to use it instead, why, and a pair of example sentences contrasting the two.

## Nuance and register
How it sounds: politeness, formality, age, gender, region, warmth or coldness, spoken versus written.

## Common mistakes
The mistakes learners actually make with it, each with the correction.

Formatting: plain text only, apart from the "## " headings. Start a line with "- " for a list item. Put each example sentence on its own line, followed by " — " and its translation. Write every Japanese word that contains kanji as {kanji part|reading}, for example {食|た}べる, {母|はは}, {昨日|きのう}, so readings can be drawn over the kanji; do not also add a reading in brackets after it. Accuracy matters more than coverage: state only what you are sure of, and say so when usage varies between speakers or regions.

Rules for every guide:
- This guide is saved once and shown every time the learner meets this item, in any sentence. Write it about the item in general, so it reads right wherever it is opened. Never mention, quote or build on the line where the learner happened to meet it: no "in your line", no "here", and the line itself is never an example. (The line is given to you only so you know which item and which sense this is; what it does in that line is shown to the learner separately.)
- Open the first section with the core idea in one sentence; then the details. Cover every common use of the item, not just the one in the line.
- Length follows the item: a simple everyday word needs a short guide (150 to 300 words); a rich word gets more. Never pad. For a simple word with nothing to break down, leave "How it's built" to one line.
- When several "senses" are really one meaning with shades, present one meaning and its shades, not separate senses.
- Mention set phrases the word commonly appears in (with examples), as part of the general picture.
- Be consistent: don't list as a mistake something you have shown as correct usage.
- No romanization anywhere (no romaji, no Korean romanization).`;
  }

  // What the learner has already worked out (from their questions): the guide should build it in.
  function notesBlock(req) {
    const dict = req.dictInfo ? `\n\nThe dictionary entry (use it to get readings and senses right; the guide is still yours to write):\n${req.dictInfo}` : '';
    const notes = (req.notes || []).filter((n) => n && n.text);
    if (!notes.length) return dict;
    return dict + '\n\nThe learner already asked about this; build these points into the guide where they belong:\n' + notes.map((n) => '- ' + n.text + (n.sentence ? ` (line: ${n.sentence})` : '')).join('\n');
  }

  function wordGuideUserMessage(req) {
    if (req.phrase) {
      return `This is a multi-word unit (${req.pos || 'set phrase'}), not a single word. Write the guide about the unit as a whole: what it means as a unit, why its parts add up to that (or don't), and how it is used. Don't write about any one of its words on its own.
Unit: ${req.dict || req.word || ''}
Reading: ${req.reading || ''}
Meaning there: ${req.meaning || ''}
Language: ${req.lang || 'unknown'}
Line where the learner met it (only to identify the unit; don't mention it): ${req.sentence || ''}${notesBlock(req)}`;
    }
    return `Word as it appeared: ${req.word || ''}
Dictionary form: ${req.dict || req.word || ''}
Reading: ${req.reading || ''}
Part of speech: ${req.pos || ''}
Meaning there: ${req.meaning || ''}
Language: ${req.lang || 'unknown'}
Line where the learner met it (only to identify the word and sense; the guide is general and doesn't mention it): ${req.sentence || ''}${notesBlock(req)}`;
  }

  function guideUserMessage(req) {
    const f = req.form || {};
    return `Form: ${f.name || f.k}
Identifier: ${f.k}
Language: ${req.lang || 'unknown'}
Line where the learner met it (only to identify the form; the guide is general and doesn't mention it): ${req.sentence || ''}
Word that carries it there: ${req.word || ''}${notesBlock(req)}`;
  }

  // A cheap check of a freshly written guide for contradictions and claims it can't back up.
  const CHECK_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['problems'],
    properties: {
      problems: {
        type: 'array',
        description: 'Real problems only; an empty list when the guide is consistent.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['quote', 'issue'],
          properties: {
            quote: { type: 'string', description: 'The exact words in the guide that are wrong.' },
            issue: { type: 'string', description: 'What is wrong, in one sentence.' },
          },
        },
      },
    },
  };
  function checkSystemPrompt() {
    return `You proofread a language guide written for a learner. Report only real problems: the guide contradicting itself (for example showing a use as correct and then listing it as a mistake), a statement about the language that is wrong, calling a line a subtitle error when it is a known pattern, or romanization. Don't report style, length or things you merely would have written differently. Most guides have no problems; then return an empty list.`;
  }
  function reviseSystemPrompt(nativeLang) {
    return `You revise a language guide for a learner who reads ${nativeLang}. Fix exactly the problems listed and nothing else. Keep the headings, the formatting, the {kanji|reading} markup and everything that is right. Return the whole corrected guide and nothing else.`;
  }

  // After an answer in Ask: the lesson in it, which guides it belongs in, and whether to write a guide.
  const LESSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['lesson', 'targets', 'guide'],
    properties: {
      lesson: { type: 'string', description: 'What the learner really wanted to learn, in one to three sentences, standing on its own (name the word or form). Empty if the answer teaches nothing reusable.' },
      targets: {
        type: 'array',
        description: 'The words, phrases or grammar forms the lesson is about (at most three), chosen from the lists given when possible.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'd', 'k', 'name'],
          properties: {
            kind: { type: 'string', enum: ['word', 'phrase', 'grammar'] },
            d: { type: 'string', description: 'Dictionary form of the word or phrase, or the form itself for grammar.' },
            k: { type: 'string', description: 'For grammar: the identifier from the list (or a new one in the same style). Otherwise empty.' },
            name: { type: 'string', description: 'Short label.' },
          },
        },
      },
      guide: {
        type: 'object',
        additionalProperties: false,
        required: ['make', 'kind', 'd', 'k', 'name'],
        description: 'Whether to offer a new guide: make is true when the learner asked for a guide, or the answer revealed a set phrase or pattern worth one.',
        properties: {
          make: { type: 'boolean' },
          kind: { type: 'string', enum: ['word', 'phrase', 'grammar', ''] },
          d: { type: 'string' },
          k: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  };
  function lessonSystemPrompt(nativeLang) {
    return `A learner asked a question about a subtitle line and got an answer. Pull out the lesson they will want to keep, in ${nativeLang}, and say which word, phrase or grammar form it belongs to so it can be added to that guide. Multi-word units (に関して, 歯切れが悪い, 店を出す) are phrases; particles, endings and patterns are grammar. If the learner asked for a guide on something ("write a guide on X", "make me a guide for this phrase"), set guide.make with X. No romanization.`;
  }

  // Does a saved guide cover the way the word or form is used in a new line?
  const MATCH_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['covered', 'why', 'other_form'],
    properties: {
      covered: { type: 'boolean', description: 'True unless the item is used in this line in a genuinely different sense or function from everything the guide describes. A use the guide covers in general, even without an example of this exact situation, is covered.' },
      why: { type: 'string', description: 'When not covered: one or two plain sentences on the different sense or function. Empty when covered. Never conclude that the guide covers it after all: then covered is true.' },
      other_form: { type: 'string', description: 'When the line actually uses a different grammar form or word than the guide is about (for example the plain casual ending 해 rather than the request 해 줘), name that form briefly. Empty otherwise.' },
    },
  };
  function matchSystemPrompt(nativeLang) {
    return `A learner opened a saved guide for a word, phrase or grammar form while watching a show, on a line other than the one the guide was written for. Decide whether the guide already explains how it is used in this new line. Answer in ${nativeLang}. The learner is smart: a guide that covers the use in general covers it, even without an example of this exact situation. Say "not covered" only for a genuinely different sense or function. No romanization.`;
  }

  // Single kanji / hanzi entries are cached by character, separately from line analyses.
  const CHAR_VERSION = 1;

  const CHAR_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['char', 'meanings', 'readings', 'parts', 'build', 'words', 'notes', 'here'],
    properties: {
      char: { type: 'string', description: 'The character.' },
      meanings: { type: 'array', items: { type: 'string' }, description: 'Core meanings, most important first.' },
      readings: {
        type: 'array',
        description: 'Readings, most common first.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['r', 'kind', 'use'],
          properties: {
            r: { type: 'string', description: 'The reading: katakana for on\'yomi, hiragana for kun\'yomi (okurigana after a dot), pinyin with tone marks for Chinese.' },
            kind: { type: 'string', enum: ['on', 'kun', 'pinyin'] },
            use: { type: 'string', description: 'When this reading is used, in a few words.' },
          },
        },
      },
      parts: {
        type: 'array',
        description: 'The components the character is built from, in reading order.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['c', 'g'],
          properties: {
            c: { type: 'string', description: 'The component, as a character or the radical form.' },
            g: { type: 'string', description: 'What it means and what it contributes: meaning, sound, or both.' },
          },
        },
      },
      build: { type: 'string', description: 'How the components add up to the character, in one to three sentences.' },
      words: {
        type: 'array',
        description: 'Common words that use the character.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['w', 'r', 'm'],
          properties: {
            w: { type: 'string' },
            r: { type: 'string', description: 'Hiragana for Japanese, pinyin for Chinese.' },
            m: { type: 'string' },
          },
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: 'Zero to three points worth knowing.' },
      here: { type: 'string', description: 'What the character contributes in the word where the learner met it.' },
    },
  };

  function charSystemPrompt(nativeLang) {
    return `You write a dictionary entry for one Chinese character (a kanji in Japanese, a hanzi in Chinese) for a learner who reads ${nativeLang}. Write every explanation in ${nativeLang}. Never use romanization: Japanese readings in kana, Chinese readings in pinyin with tone marks.

The learner wants to understand the character, not just memorise a gloss, so show how it is built. In parts, list its components (the semantic radical and the other components) and say what each contributes, marking a component that only gives the sound as phonetic. In build, explain in one to three sentences how they add up to the meaning. Give the standard analysis; where the origin is disputed or the modern form hides it, say so briefly instead of inventing a story.

meanings: the core meanings, most important first. readings: for Japanese every common on'yomi (katakana) and kun'yomi (hiragana, okurigana after a dot), each with when it is used; for Chinese each pinyin reading in use, with when it is used. words: five to eight common words that use the character, everyday ones first, including the word where the learner met it. notes: zero to three points worth knowing, such as the simplified or traditional form, a different meaning in Japanese and Chinese, or a character it is often confused with. here: what the character contributes in the word where the learner met it.

State only what you are sure of. Accuracy matters more than completeness.`;
  }

  function charUserMessage(req) {
    return `Character: ${req.ch}
Language: ${req.lang === 'zh' ? 'Chinese' : 'Japanese'}
Met in the word: ${req.word || ''}${req.reading ? ` (${req.reading})` : ''}
In the line: ${req.sentence || ''}`;
  }

  // Episode word lists: one call over the whole transcript.
  const WORDS_VERSION = 1;

  const WORDS_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['words'],
    properties: {
      words: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['d', 'r', 'm', 'pos', 'count', 'line'],
          properties: {
            d: { type: 'string', description: 'Dictionary form.' },
            r: { type: 'string', description: 'Hiragana for Japanese words with kanji, pinyin for Chinese, otherwise empty. No romanization.' },
            m: { type: 'string', description: 'Meaning as used in this episode.' },
            pos: { type: 'string', description: 'Part of speech.' },
            count: { type: 'integer', description: 'How many lines use the word, in any form.' },
            line: { type: 'integer', description: 'Number of a line that uses it, the clearest example.' },
          },
        },
      },
    },
  };

  function wordsSystemPrompt(nativeLang) {
    return `You prepare a vocabulary list from an episode's subtitles so a language learner can study the words before watching. The learner reads ${nativeLang}; write meanings in ${nativeLang}.

List the words in the dictionary form, counting every inflected form of a word as the same word. Leave out particles, grammatical endings, interjections, sound effects and people's names; keep place names and other proper nouns only when they need explaining. Order the list by how many lines use the word, most first, and include up to 150 words. For each: d the dictionary form, r its reading (hiragana for Japanese words with kanji, pinyin with tone marks for Chinese, an empty string otherwise; never romanization), m the meaning it has in this episode, pos its part of speech, count the number of lines that use it, line the number of the line that shows it most clearly.`;
  }

  // ---- questions about a line ------------------------------------------------

  function askSystemPrompt(nativeLang) {
    return `You are a language tutor sitting next to a learner while they watch a show. They paused on a line and are asking you about it. They read ${nativeLang}; answer in ${nativeLang}, quoting the language being learned with a reading in brackets where they might not know it (hiragana for Japanese, pinyin with tone marks for Chinese; never romanization).

Answer the question they actually asked, directly, then give the reasoning a good teacher would: the rule behind it, where it applies and where it does not, and a short contrasting example when that makes the difference clear. Use the scene, the surrounding lines and the analysis you are given. If the honest answer is that usage varies or that both options are fine, say so. Keep it conversational and fairly short (under about 200 words unless they ask for more), in plain text without markdown headings.`;
  }

  // req: { sentence, translation, before: [], after: [], show, words: 'word = meaning; ...', history: [{q, a}], question }
  function askMessages(req) {
    let ctx = `The line: ${req.sentence}\n`;
    if (req.translation) ctx += `Translation: ${req.translation}\n`;
    if (req.words) ctx += `Words in it: ${req.words}\n`;
    if (req.before && req.before.length) ctx += `Lines just before: ${req.before.join(' / ')}\n`;
    if (req.after && req.after.length) ctx += `Lines just after: ${req.after.join(' / ')}\n`;
    if (req.show) ctx += `Show: ${req.show}\n`;
    const msgs = [];
    const history = req.history || [];
    history.forEach((turn, i) => {
      msgs.push({ role: 'user', content: (i === 0 ? ctx + '\n' : '') + turn.q });
      msgs.push({ role: 'assistant', content: turn.a });
    });
    msgs.push({ role: 'user', content: (history.length ? '' : ctx + '\n') + req.question });
    // The scene, when the learner allows it: attached to the first question about the line.
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(req.image || '');
    if (m) {
      const first = msgs[0];
      first.content = [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: 'This is the scene on screen when the line was said.\n\n' + first.content }];
    }
    return msgs;
  }

  // ---- grammar review questions ---------------------------------------------

  const CLOZE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['sentence', 'answer', 'translation', 'hint', 'why', 'contrast'],
    properties: {
      sentence: { type: 'string', description: 'A natural sentence with the tested part replaced by ＿＿.' },
      answer: { type: 'string', description: 'What goes in the blank, exactly as written in the full sentence.' },
      translation: { type: 'string', description: 'Translation of the full sentence.' },
      hint: { type: 'string', description: 'A short hint shown with the question, such as the dictionary form to use and the meaning wanted.' },
      why: { type: 'string', description: 'Why this answer is right and the tempting alternative is wrong, in one to three sentences.' },
      contrast: { type: 'boolean', description: 'True when the answer is a different form that is often confused with the one being studied.' },
    },
  };

  function clozeSystemPrompt(nativeLang) {
    return `You write one review question for a learner studying a grammar form. They read ${nativeLang}; write the translation, hint and explanation in ${nativeLang}, and never use romanization.

Write one natural, everyday sentence in the target language with the part that shows the form replaced by ＿＿, as a fill-in-the-blank question. About one time in three, write instead a sentence where a form often confused with the studied one is the right answer (and set contrast to true), so the learner practises where the form does not fit as well as where it does. The hint must make the intended meaning clear without giving the answer away: give the dictionary form of the word to put in the blank and what the sentence should mean. Use vocabulary a learner at this level probably knows, and vary the situation every time.`;
  }

  function clozeUserMessage(req) {
    let msg = `Grammar form: ${req.name || req.k}\nIdentifier: ${req.k}\nLanguage: ${req.lang}\n`;
    if (req.example) msg += `Where the learner first met it: ${req.example}\n`;
    if (req.guide) msg += `\nThe guide the learner read about it:\n${req.guide.slice(0, 6000)}\n`;
    if (req.avoid && req.avoid.length) msg += `\nDo not reuse these sentences: ${req.avoid.join(' / ')}\n`;
    return msg;
  }

  SG.prompt = { episodeSystemPrompt, episodeUserMessage, showVocabSystemPrompt, songBlock, songGuideSystemPrompt, songGuideUserMessage, LESSON_SCHEMA, lessonSystemPrompt, MATCH_SCHEMA, matchSystemPrompt, CHECK_SCHEMA, checkSystemPrompt, reviseSystemPrompt, askSystemPrompt, askMessages, CLOZE_SCHEMA, clozeSystemPrompt, clozeUserMessage, wordGuideSystemPrompt, wordGuideUserMessage, WORDS_VERSION, WORDS_SCHEMA, wordsSystemPrompt, PROMPT_VERSION, GUIDE_VERSION, CHAR_VERSION, CHAR_SCHEMA, charSystemPrompt, charUserMessage, guideSystemPrompt, guideUserMessage, ROLES, ANALYSIS_SCHEMA, systemPrompt, userMessage, deepSystemPrompt, deepUserMessage };
})(typeof globalThis !== 'undefined' ? globalThis : this);
