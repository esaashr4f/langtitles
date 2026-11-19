# Langtitles build list

Everything asked for since version 0.1.11 that is not built yet, grouped, in the planned build order.
Tick items off as they ship. Notes and guide requests saved from questions are in
docs/pending-notes.md and get loaded in as part of item 5.

## 1. Fixes (first)

- [ ] **Full-screen clicks.** In the player's full screen, clicking subtitle words, the word card or the panel
  does nothing (animepahe's player grabs every click first). Catch clicks on Langtitles' own elements
  before the player, start the content script earlier (document_start) so it registers first, and stop
  the player from also pausing. Test with a fake player that grabs all clicks in full screen.
- [ ] **Panel layout bugs** (seen on animepahe at a narrow panel width):
  - "Langtitles" title overlaps the Subtitles switch; status cut to "213/335…". Let the title shrink,
    make the switch icon-only when narrow.
  - Tabs cut off ("Transcr…"): fit at narrow widths (short labels or scrolling tab row).
  - Track box squashed to a thin line: children of the scrolling tab must not shrink (flex-shrink: 0).
  - Number boxes show the browser's own up/down arrows: style them.
  - The site's own styles leak in (text larger than intended): put the overlay in a Shadow DOM.
  - Test at the panel's narrowest width and on animepahe-like layouts before sending.
- [ ] **Show detection.** Read the show name from the page title ("Monster Ep. 62 :: animepahe" -> Monster,
  episode 62), removing site names, instead of "animepahe_monster".
- [ ] **ID box.** Picking a show in "Find the show" sets its correct ID; typing a new title clears an ID
  that doesn't match; an ID search with no results falls back to the title.

## 2. Shows and subtitles

- [ ] **Saved shows / show presets** (the "Monster preset"): pick "Monster (2004)" once, with its poster;
  save the show, subtitle site, subtitle group and timing. "My shows" appear first in Find subtitles;
  one click loads them. A "Use for every episode" button on each subtitle result. Remember that a
  site's title ("Monster Ep. 62" on animepahe) is this saved show, so later episodes load with no
  searching. Show what is saved; Forget button.
- [ ] **Posters for every kind of show:** AniList for anime (no key), TVmaze for TV series (no key),
  OpenSubtitles' catalogue for films (existing key), optional TMDB key for best quality; fall back to
  a frame from your own viewing; let the poster be swapped.

## 3. Saving and backing up your data

- [ ] **Save Ask questions and answers permanently,** per line, episode and show, restored when you
  come back to an episode. A searchable "Questions" page grouped by show and episode. (High priority:
  answers are currently lost when the page closes.)
- [ ] **Export / Import:** one `.langtitles` file with everything; restore by dropping it in; choose merge
  or replace; show a summary ("312 words, 84 guides…") and confirm before changing anything.
- [ ] **Automatic backups to a folder** (Downloads/Langtitles backups/): check when Firefox starts and
  every few hours, back up if the last one is more than a day old (so long breaks are covered).
  Incremental: small change files after each backup, rolled into a full snapshot weekly, old files
  cleaned up, last few snapshots kept. Status in Options ("Last backup: today 14:02 · 12 changes"),
  "Back up now". Line breakdown cache optional. API keys excluded unless the backup is encrypted
  with a passphrase (optional encryption for everything). Tip in Options: sync that folder with the
  Google Drive desktop app.
- [ ] **Google Drive backups (optional):** a "Langtitles backups" folder, the app can only see its own
  files; step-by-step setup for the Google app ID, including switching it to production so the
  sign-in doesn't expire weekly. Restore from the Drive folder.
- [ ] **Firefox Sync** for settings and known words.
- [ ] **Account system (later, when going public or paid; private to you first):** sign in with email or
  Google, two-way sync of everything across devices (e.g. your dad's laptop), newest edit wins per
  item, review history merged, API key synced encrypted with a passphrase, "Sign out and remove my
  data" for borrowed computers, privacy policy, account and data deletion, UK data protection.

## 4. Line breakdowns

- [ ] **Whole-phrase meanings:** a cluster like 開始したっていうのか gets its own meaning and a step-by-step
  build-up (開始する -> 開始した -> …って -> …っていう -> …の -> …のか), shown as a thin bracket over the
  words (switchable in the Show row) and an "As a whole" section in the word card. Nothing removed.
- [ ] **Compound words kept whole** (素行調査 "background check"), with the parts as pieces; once the
  dictionary is in, join neighbouring words that form a dictionary entry (longest match), locally.
- [ ] **Set phrases kept whole** (必要とする "need", 問題にする, 店を出す, 気になる, 手を出す), their parts glossed
  from the phrase (no "treating" for して).
- [ ] **Split patterns linked** (いかに…のか, ～ば…ほど): one meaning, both ends highlighted together.
- [ ] **"How the sentence works"** replaces "Word for word" and "Structure":
  - always visible, two or three lines: the line in Japanese order, chunk by chunk, each with a short
    natural gloss (自分など someone like me · まだ still · 吸血鬼を取り巻く that circle vampires ·
    コウモリ程度 a mere bat-level · でしかない am nothing but · と …that); role labels on the chunks;
  - "How it fits together ▾" expands the build-up from the core outward, showing why English reverses
    the order; notes when the burned-in English is a looser translation;
  - lines that continue into the next subtitle marked "continues ->".
- [ ] **Particles inside phrases get their meaning** even when particle notes are switched off (まで in までして).
- [ ] **Quality check:** each word's and phrase's meaning must agree with the full-line translation.
- [ ] **Combined particles get their own forms:** では (contrast "at X, at least"), ではない/じゃない ("is not"),
  では "well then", には, とは, からは, までは, でも, にも; their guides explain the combination, how it differs
  from each part and the look-alikes. Built-in guides for では, には and じゃない.
- [ ] **Option: Sonnet for line breakdowns** (better at whole-sentence reasoning, about 3x Haiku's cost).

## 4b. Phrases as real units (high priority)

- [ ] **Phrases are first-class, not their head word.** Japanese meaning often lives in multi-word units:
  compound particles (に関して "regarding", について, によって, として, にとって, に対して), set phrases and idioms
  (歯切れが悪い "evasive, not straight-talking", 店を出す, 気になる, 手を出す), noun + する/とする/にする phrases
  (必要とする), and split patterns (いかに…のか). Each gets:
  - its own identity (e.g. phrase.ja.に関して), separate from the verb 関する, which means something else alone;
  - one meaning shown over the whole span on screen, with the parts still clickable;
  - its own 📖 guide chip in the word card, a phrase guide, and saving / Known? / review **as the phrase**
    (saving に関して saves に関して, not 関する); the word bank shows phrases in their own group;
  - detection by the analysis (phrase spans returned with the line) and checked locally against the
    dictionary's expression entries (JMdict marks these), longest match first.
- [ ] **Phrases already saved as their head verb** (e.g. に関して stored as 関する) are found and offered to be
  converted when the dictionary is in.

## 5. Guides

- [ ] **Model label on every guide** (Library header line, word card, panel, full-screen reader:
  "Written by Opus 5.5", "Built in"); existing guides already store their model.
- [ ] **Model per feature** in Options: Sonnet by default for word guides, kanji entries, Episode words and
  review questions; Opus for new grammar forms.
- [ ] **"Improve with Opus" button** on every guide: rewrites it, replaces it in the Library, label updates,
  Library notes it was rewritten, folds in your question notes.
- [ ] **Advisor experiment:** Sonnet writes, consulting Opus on hard parts; default only if measurably better
  than Sonnet and cheaper than Opus.
- [ ] **Sonnet vs Opus comparison:** about ten guides from each model, side by side, for you to judge
  (under £1; ask before spending).
- [ ] **When a line doesn't match the guide:** "In this line" at the top of a saved guide (free); a cheap
  Haiku check compares the line's meaning with the guide's senses; on a mismatch, "Why it means
  something different here" (another sense, part of a bigger expression, or an error, said plainly);
  new senses added to the guide permanently; "Where you met it" becomes a list of every encounter;
  a "This doesn't match" button. A は guide opened on a では line points to the では guide.
- [ ] **Your questions update guides:** after each Ask answer, pull out the main lesson and suggest
  "Add to X guide" chips (a setting to add automatically); a "From your questions" section with the line
  and date; corrections marked next to the part they fix; notes kept for guides not written yet and built
  in when they are; searchable in the Library with a filter; shown on review cards.
  Load docs/pending-notes.md (取り巻く / noun-modifying clauses; 程度 / でしかない).
- [ ] **Ask can write guides:** "write a guide on 店を出す" creates a vocab or grammar guide (root form),
  saved to the Library; Ask offers "Make a guide for X" when an answer reveals a missing set phrase.
  Write 店を出す first.
- [ ] **"Set phrases and expressions" group** in the Library's Words section; set phrases detected
  automatically get their own 📖 chip in the word card.
- [ ] **Noun-modifying clauses everywhere:** add a fixed form for clauses that describe a noun (殺した連中, 要らない連中,
  吸血鬼を取り巻くコウモリ) and tag the verb or adjective with it as well as its own form (past, negative…), so its
  guide chip appears. A built-in guide for it (plain forms before a noun, が not は inside the clause, no
  "that/which", tense inside the clause). Every built-in verb-form guide (past, negative, ～ている, potential,
  passive, causative, ～たい…) gets a "Before a noun" use with an example; written guides are asked to cover it too.
- [ ] **Guides shaped by what the item is** (the なり guide problem): classify each item as a content word, a
  function word / suffix / particle, or a phrase, and use a matching template. Function words like なり get
  the grammar template (core idea, how it attaches, uses, look-alikes), not the word template ("How it's
  built: nothing to break down"). Every guide leads with the line where you met it and the core idea in
  one sentence; length scales with how much there is to say; senses that are really one meaning are
  presented as one with nuances, not as separate senses.
- [ ] **Consistency check on new guides:** a cheap pass that flags contradictions inside a guide (the なり guide
  says it attaches to adjectives and verbs, then lists that as a mistake) and claims it can't support, and
  fixes them before saving.
- [ ] **Dictionary-grounded guides:** pass the dictionary's readings and meanings into guide prompts.

## 6. Grammar as important as vocab

- [ ] **Study tab** (replacing Words): Words | Grammar side by side. Grammar lists every form in the episode,
  most frequent first, count, example line to jump to, ✓ if its guide was read, ☆ to add to review,
  filter for unstudied forms. Built from the line analyses at no extra cost.
- [ ] **Grammar counts on the Progress page,** a grammar filter in the word bank, an optional underline
  under unstudied forms.

## 7. Saved words

- [ ] **Saved cards lead with the root:** 食べる with its reading and plain meaning (the analysis returns the
  root's reading; later the dictionary). "Met as" lists each conjugated form with its in-context meaning
  and line. Review asks about the root with the met form as the example.

## 8. Scene frames and shows

- [ ] **Scene frames:** keep a small frame when you save a line, ask a question or first meet a word (from the
  video, falling back to a tab screenshot; copy-protected video comes out black). Shown next to "Where
  you met it", on Questions and on review cards. Opt-in "Use the scene" to send the frame to Claude in
  Ask and for guides where the situation matters.
- [ ] **Shows in the Library:** language -> poster grid -> a show's episodes, each with a frame -> an episode
  gives a recap (from that episode's subtitles only, no spoilers) and a language lesson (key vocab, set
  phrases, grammar it leans on, how characters speak, lines worth studying, linked to the scene).
  A whole-show vocabulary guide built only from watched episodes, updated as you go. Batch option at
  half price.

## 9. Costs

- [ ] **Spending tracker:** by feature (line breakdowns, word guides, grammar guides, kanji entries, Ask,
  Episode words, review questions), by show and episode, by day, and the most expensive individual
  requests; in the Progress page and the toolbar popup.

## 10. Redesign

- [ ] **Remove the "AI-generated" look:** proper icon set instead of emoji, a typeface with character, fewer
  tiny all-caps headings, no orange gradient buttons, less generic glass.
- [ ] **Use the requested libraries where they help** (evaluate each, note the decision):
  - Overlay: Vercel web design guidelines and the taste skill as checklists, shadcn's approach, GSAP for small
    motion, components from React Bits, Skiper UI, fancycomponents.dev, Componentry, Awesome Design and
    Kitchen (dqnamo) where they fit; check Animaster.
  - Full pages (Library, Progress, Word bank, Review, Options): shadcn components, Lenis, Shader Gradient /
    Liquid Logo for the fox on Options or a welcome page, Cobe only if meaningful.
  - liquid-glass-js: test in Firefox (expect an imitation).
  - Not over the video: Vanta, React Three Fiber, ThreeUI, Shader Gradient (WebGL hurts playback).
- [ ] Test the redesign at real sizes before sending.

## 11. Dictionary

- [ ] **Japanese:** JMdict (common words, optional full), KANJIDIC2, deinflection (頑張って -> 頑張る); instant
  meanings and readings in the word card before the AI arrives.
- [ ] **Chinese:** CC-CEDICT. **Korean:** later (KRDict needs another approach).

## 12. Publishing

- [ ] **Firefox public listing:** description in terms of legal sites, screenshots, privacy policy page,
  source zip; also gets Firefox for Android.
- [ ] **Chrome version:** Manifest V3 (service worker background), subtitle capture from inside the page,
  contextMenus; one codebase builds both; $5 developer fee.
- [ ] **Money (later):** donation link first; hosted "no key needed" plan with accounts and payments; check
  OpenSubtitles / SubDL / Jimaku terms for commercial use.

## 13. Listen mode (music)

A separate mode of the extension for songs; the full design (UX, UI, technical, how it fits with the
subtitles) is in docs/music-mode.md. Build in this order:

- [ ] **YouTube Music and YouTube music videos:** site adapters, lyrics from the page or LRCLIB (by duration,
  word-level timing when available), search / paste / `.lrc` by hand, choices and timing saved per track,
  Watch | Listen switch (automatic, overridable per site). Lyrics become a normal Langtitles track.
- [ ] **Lyrics sheet** (Strip / Sheet / Focus) on music sites, Listen-mode panel tabs (Line, Lyrics, Study,
  Song, Display); **song-mode analysis:** whole song in context, choruses analysed once, sung readings
  (本気 → マジ) with both shown in the card, poetic and old grammar explained with its own guides, imagery notes.
- [ ] **Spotify web player** (its own synced lyrics and active line; progress bar fallback) and **Apple Music web**.
- [ ] **Song guides, artist pages, Library → Music** (artwork from the page, iTunes Search, Cover Art Archive),
  lyrics coverage ("you know 82%").
- [ ] **Practice:** loop and slow down where possible, Fill the gaps listening quiz, sing-along view,
  shadowing with the microphone, song coverage, review cards with artwork and "play from 1:23".
- [ ] **Anime openings and endings:** "Learn this opening" from an episode (AnimeThemes), songs listed under
  the show and the artist.
- [ ] Tests for lyrics parsing, LRCLIB matching, chorus de-duplication and each site adapter.
