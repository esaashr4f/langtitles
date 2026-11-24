# Langtitles build list

Everything asked for since version 0.1.11 that is not built yet, grouped, in the planned build order.
Tick items off as they ship. Notes and guide requests saved from questions are in
docs/pending-notes.md and get loaded in as part of item 5.

## 1. Fixes (first)

- [x] **Full-screen clicks.** In the player's full screen, clicking subtitle words, the word card or the panel
  does nothing (one anime site's player grabs every click first). Catch clicks on Langtitles' own elements
  before the player, start the content script earlier (document_start) so it registers first, and stop
  the player from also pausing. Test with a fake player that grabs all clicks in full screen.
- [x] **Panel layout bugs** (seen on an anime site at a narrow panel width):
  - "Langtitles" title overlaps the Subtitles switch; status cut to "213/335…". Let the title shrink,
    make the switch icon-only when narrow.
  - Tabs cut off ("Transcr…"): fit at narrow widths (short labels or scrolling tab row).
  - Track box squashed to a thin line: children of the scrolling tab must not shrink (flex-shrink: 0).
  - Number boxes show the browser's own up/down arrows: style them.
  - The site's own styles leak in (text larger than intended): put the overlay in a Shadow DOM.
  - Test at the panel's narrowest width and on layouts like that one before sending.
- [x] **Show detection.** Read the show name from the page title ("Monster Ep. 62 :: SiteName" -> Monster,
  episode 62), removing site names, instead of "sitename_monster".
- [x] **ID box.** Picking a show in "Find the show" sets its correct ID; typing a new title clears an ID
  that doesn't match; an ID search with no results falls back to the title.

## 2. Shows and subtitles

- [x] **Saved shows / show presets** (the "Monster preset"): pick "Monster (2004)" once, with its poster;
  save the show, subtitle site, subtitle group and timing. "My shows" appear first in Find subtitles;
  one click loads them. A "Use for every episode" button on each subtitle result. Remember that a
  site's title ("Monster Ep. 62" on a streaming site) is this saved show, so later episodes load with no
  searching. Show what is saved; Forget button.
- [x] **Posters for every kind of show:** AniList for anime (no key), TVmaze for TV series (no key),
  OpenSubtitles' catalogue for films (existing key), optional TMDB key for best quality; fall back to
  a frame from your own viewing; let the poster be swapped.

## 3. Saving and backing up your data

- [x] **Save Ask questions and answers permanently,** per line, episode and show, restored when you
  come back to an episode. A searchable "Questions" page grouped by show and episode. (High priority:
  answers are currently lost when the page closes.)
- [x] **Export / Import:** one `.langtitles` file with everything; restore by dropping it in; choose merge
  or replace; show a summary ("312 words, 84 guides…") and confirm before changing anything.
- [x] **Automatic backups to a folder** (Downloads/Langtitles backups/): check when Firefox starts and
  every few hours, back up if the last one is more than a day old (so long breaks are covered).
  Incremental: small change files after each backup, rolled into a full snapshot weekly, old files
  cleaned up, last few snapshots kept. Status in Options ("Last backup: today 14:02 · 12 changes"),
  "Back up now". Line breakdown cache optional. API keys excluded unless the backup is encrypted
  with a passphrase (optional encryption for everything). Tip in Options: sync that folder with the
  Google Drive desktop app.
- [x] **Google Drive backups (optional):** a "Langtitles backups" folder, the app can only see its own
  files; step-by-step setup for the Google app ID, including switching it to production so the
  sign-in doesn't expire weekly (docs/google-drive-setup.md). Restore from the Drive folder.
- [x] **Firefox Sync** for settings, known words and the word bank (compact, merged both ways).
- [ ] **Account system (later, when going public or paid; private to you first):** sign in with email or
  Google, two-way sync of everything across devices (e.g. your dad's laptop), newest edit wins per
  item, review history merged, API key synced encrypted with a passphrase, "Sign out and remove my
  data" for borrowed computers, privacy policy, account and data deletion, UK data protection.

## 4. Line breakdowns

- [x] **Whole-phrase meanings:** a cluster like 開始したっていうのか gets its own meaning and a step-by-step
  build-up (開始する -> 開始した -> …って -> …っていう -> …の -> …のか), shown as a thin bracket over the
  words (switchable in the Show row) and an "As a whole" section in the word card. Nothing removed.
- [x] **Compound words kept whole** (素行調査 "background check"), with the parts as pieces; once the
  dictionary is in, join neighbouring words that form a dictionary entry (longest match), locally.
- [x] **Set phrases kept whole** (必要とする "need", 問題にする, 店を出す, 気になる, 手を出す), their parts glossed
  from the phrase (no "treating" for して).
- [x] **Split patterns linked** (いかに…のか, ～ば…ほど): one meaning, both ends highlighted together.
- [x] **"How the sentence works"** replaces "Word for word" and "Structure":
  - always visible, two or three lines: the line in Japanese order, chunk by chunk, each with a short
    natural gloss (自分など someone like me · まだ still · 吸血鬼を取り巻く that circle vampires ·
    コウモリ程度 a mere bat-level · でしかない am nothing but · と …that); role labels on the chunks;
  - "How it fits together ▾" expands the build-up from the core outward, showing why English reverses
    the order; notes when the burned-in English is a looser translation;
  - lines that continue into the next subtitle marked "continues ->".
- [x] **Particles inside phrases get their meaning** even when particle notes are switched off (まで in までして).
- [x] **Quality check:** each word's and phrase's meaning must agree with the full-line translation.
- [x] **Combined particles get their own forms:** では (contrast "at X, at least"), ではない/じゃない ("is not"),
  では "well then", には, とは, からは, までは, でも, にも; their guides explain the combination, how it differs
  from each part and the look-alikes. Built-in guides for では, には and じゃない.
- [x] **Option: Sonnet for line breakdowns** (better at whole-sentence reasoning, about 3x Haiku's cost).

## 4b. Phrases as real units (high priority)

- [x] **Phrases are first-class, not their head word.** Japanese meaning often lives in multi-word units:
  compound particles (に関して "regarding", について, によって, として, にとって, に対して), set phrases and idioms
  (歯切れが悪い "evasive, not straight-talking", 店を出す, 気になる, 手を出す), noun + する/とする/にする phrases
  (必要とする), and split patterns (いかに…のか). Each gets:
  - its own identity (e.g. phrase.ja.に関して), separate from the verb 関する, which means something else alone;
  - one meaning shown over the whole span on screen, with the parts still clickable;
  - its own 📖 guide chip in the word card, a phrase guide, and saving / Known? / review **as the phrase**
    (saving に関して saves に関して, not 関する); the word bank shows phrases in their own group;
  - detection by the analysis (phrase spans returned with the line) and checked locally against the
    dictionary's expression entries (JMdict marks these), longest match first.
- [x] **Phrases already saved as their head verb** (0.5.1: Word bank offers Convert / Convert all) (e.g. に関して stored as 関する) are found and offered to be
  converted when the dictionary is in.

## 5. Guides

- [x] **Model label on every guide** (Library header line, word card, panel, full-screen reader:
  "Written by Opus 5.5", "Built in"); existing guides already store their model.
- [x] **Model per feature** in Options: Sonnet by default for word guides, kanji entries, Episode words and
  review questions; Opus for new grammar forms.
- [x] **"Improve with Opus" button** on every guide: rewrites it, replaces it in the Library, label updates,
  Library notes it was rewritten, folds in your question notes.
- [ ] **Advisor experiment:** Sonnet writes, consulting Opus on hard parts; default only if measurably better
  than Sonnet and cheaper than Opus.
- [ ] **Sonnet vs Opus comparison:** about ten guides from each model, side by side, for you to judge
  (under £1; ask before spending).
- [x] **When a line doesn't match the guide:** "In this line" at the top of a saved guide (free); a cheap
  Haiku check compares the line's meaning with the guide's senses; on a mismatch, "Why it means
  something different here" (another sense, part of a bigger expression, or an error, said plainly);
  new senses added to the guide permanently; "Where you met it" becomes a list of every encounter;
  a "This doesn't match" button. A は guide opened on a では line points to the では guide.
- [x] **Your questions update guides:** after each Ask answer, pull out the main lesson and suggest
  "Add to X guide" chips (a setting to add automatically); a "From your questions" section with the line
  and date; corrections marked next to the part they fix; notes kept for guides not written yet and built
  in when they are; searchable in the Library with a filter; shown on review cards.
  Load docs/pending-notes.md (取り巻く / noun-modifying clauses; 程度 / でしかない).
- [x] **Ask can write guides:** "write a guide on 店を出す" creates a vocab or grammar guide (root form),
  saved to the Library; Ask offers "Make a guide for X" when an answer reveals a missing set phrase.
  Write 店を出す first.
- [x] **"Set phrases and expressions" group** in the Library's Words section; set phrases detected
  automatically get their own 📖 chip in the word card.
- [x] **Noun-modifying clauses everywhere:** add a fixed form for clauses that describe a noun (殺した連中, 要らない連中,
  吸血鬼を取り巻くコウモリ) and tag the verb or adjective with it as well as its own form (past, negative…), so its
  guide chip appears. A built-in guide for it (plain forms before a noun, が not は inside the clause, no
  "that/which", tense inside the clause). Every built-in verb-form guide (past, negative, ～ている, potential,
  passive, causative, ～たい…) gets a "Before a noun" use with an example; written guides are asked to cover it too.
- [x] **Guides shaped by what the item is** (the なり guide problem): classify each item as a content word, a
  function word / suffix / particle, or a phrase, and use a matching template. Function words like なり get
  the grammar template (core idea, how it attaches, uses, look-alikes), not the word template ("How it's
  built: nothing to break down"). Every guide leads with the line where you met it and the core idea in
  one sentence; length scales with how much there is to say; senses that are really one meaning are
  presented as one with nuances, not as separate senses.
- [x] **Apply the library fixes** (scripts/guides/library-fixes-ja.txt, written from docs/guide-audit.md): on
  update, add the 17 rewritten / new guides, retire the 16 replaced ones (kept for undo, notes and
  encounters moved over), patch the こと and もの sections, relink 殺害に関しては from the に guide, strip romaji
  from 6 old guides, turn the 4 name guides into one-line entries. Once only, with a summary in the Library.
- [x] **Prevent every problem found in the audit from happening again** (each gets a regression test built from
  the real lines in docs/guide-audit.md):
  - phrases filed under one word (関する for に関して, 歯切れ for 歯切れが悪い, 店 for 店を出す…) → phrases as real units
    (section 4b), detected by the analysis and the dictionary; guides and saving use the phrase;
  - grammar written up as a word (なり, とおり, 的, では, と) → items classified as word / grammar / phrase, matching
    template; function words and suffixes always get grammar guides;
  - wrong analysis of a set pattern (こと + noun + に関しては called "garbled") → the analysis is told set patterns
    exist before guessing at errors; guides that say "probably garbled / can't say" are flagged for a second look
    by the stronger model;
  - wrong guide attached to a compound (に guide on に関しては) → compound particles have their own forms;
  - duplicates under different names (copula_da / copula_da_desu…) → fixed form identifiers plus aliases (done in
    0.1.8), and the check-up merges any that slip through;
  - romaji and missing furigana → romaji is stripped automatically from any guide text, furigana checked before
    saving (and filled from the dictionary);
  - full guides on names → names never get guides, only a one-line entry (also for names the analysis tags
    loosely, checked against katakana-only names and the "proper noun" part of speech);
  - over-long guides on basic words → length scales with the item; basic words get a short guide;
  - self-contradictions (なり) → the consistency check;
  - missing uses that the line needs (past ～た before a noun) → the "doesn't match this line" check adds them.
- [x] **Guide check-up for guides already saved:** a "Check my guides" button in the Library that scans every
  saved guide and lists the ones that need rewriting, each with the reason:
  - a word guide for something that is grammar (particle, suffix, auxiliary: なり, では);
  - a word guide for the head word of a phrase (関する where the line had に関して; 歯切れ alone);
  - missing or empty sections, or sections that don't match the item's kind;
  - contradictions found by the consistency check;
  - a built-in guide now exists for it (replace for free);
  - written with an older guide version.
  Shows the estimated cost, rewrites the ones you tick (batch processing at half price, or straight away),
  keeps the old version so a rewrite can be undone, keeps your question notes, and updates the model label.
- [x] **Consistency check on new guides:** a cheap pass that flags contradictions inside a guide (the なり guide
  says it attaches to adjectives and verbs, then lists that as a mistake) and claims it can't support, and
  fixes them before saving.
- [x] **Dictionary-grounded guides:** pass the dictionary's readings and meanings into guide prompts.

## 6. Grammar as important as vocab

- [x] **Study tab** (replacing Words): Words | Grammar side by side. Grammar lists every form in the episode,
  most frequent first, count, example line to jump to, ✓ if its guide was read, ☆ to add to review,
  filter for unstudied forms. Built from the line analyses at no extra cost.
- [x] **Grammar counts on the Progress page,** a grammar filter in the word bank, an optional underline
  under unstudied forms.

## 7. Saved words

- [x] **Saved cards lead with the root:** 食べる with its reading and plain meaning (the analysis returns the
  root's reading; later the dictionary). "Met as" lists each conjugated form with its in-context meaning
  and line. Review asks about the root with the met form as the example.

## 8. Scene frames and shows

- [x] **Scene frames** (0.5.0; kept when you save a line or word and with your first question on a line, not on
  every first meeting, which would be hundreds a night): keep a small frame when you save a line, ask a question or first meet a word (from the
  video, falling back to a tab screenshot; copy-protected video comes out black). Shown next to "Where
  you met it", on Questions and on review cards. Opt-in "Use the scene" to send the frame to Claude in
  Ask and for guides where the situation matters.
- [x] **Shows in the Library** (0.5.0; posters from AniList / TVmaze / TMDB; batch at half price not done): language -> poster grid -> a show's episodes, each with a frame -> an episode
  gives a recap (from that episode's subtitles only, no spoilers) and a language lesson (key vocab, set
  phrases, grammar it leans on, how characters speak, lines worth studying, linked to the scene).
  A whole-show vocabulary guide built only from watched episodes, updated as you go. Batch option at
  half price.

## 9. Costs

- [x] **Spending tracker:** by feature (line breakdowns, word guides, grammar guides, kanji entries, Ask,
  Episode words, review questions), by show and episode, by day, and the most expensive individual
  requests; in the Progress page and the toolbar popup.

## 10. Redesign

- [x] **Remove the "AI-generated" look** (0.3.0–0.3.1): Lucide icons instead of emoji, Geist for the interface,
  sentence-case labels, one flat accent instead of orange gradients, less blur; then a spacing and declutter
  pass on the panel and word card (one primary thing per view, rows instead of boxes, quiet secondary actions,
  a slim pinned playback bar, language-specific switches only for that language).
- [x] **Libraries, the decision for each** (the overlay is plain DOM inside a shadow root on other people's
  video pages, so anything heavy costs playback smoothness and page compatibility):
  - Used: **Lucide** icons (via the icon set), **Geist** (Vercel's typeface), the **Vercel web interface
    guidelines**, **Impeccable**'s rules (≤4 actions per view, tight groups with generous gaps, no cards in
    cards, no coloured side borders, no emoji as icons) and **Emil Kowalski**'s motion rules (under 200 ms,
    ease-out, never from scale 0, exits faster, reduced-motion respected) as checklists.
  - Taken as ideas, not code: **shadcn** (segmented controls, quiet ghost buttons, tokens), **React Bits / Skiper
    UI / fancycomponents.dev / Componentry / Kitchen / Awesome Design** (they are React components; the overlay
    has no React, so the patterns were rebuilt in a few lines of CSS: segmented tabs, sticky toolbars, row lists).
  - **taste-skill**: aimed at marketing websites (photography, hero sections); only its spacing ideas apply.
  - Not used: **GSAP** and **Animaster** (CSS transitions cover every animation here, without 70 KB of script on
    every page), **Lenis** (smooth scrolling fights the panel's own scroll areas and reduced-motion users),
    **liquid-glass-js** (needs SVG filters Firefox renders slowly over video), **Vanta, React Three Fiber,
    ThreeUI, Shader Gradient, Liquid Logo, Cobe** (WebGL: costs video playback; nowhere meaningful to put a
    globe). Focus mode's blurred artwork gives the one "rich" background, in plain CSS.
- [x] Tested at 1280×720 (panel, word card, every tab, lyrics sheet sizes) and the narrow panel; pages in light and dark.

## 11. Dictionary

- [x] **Japanese:** JMdict (common words, optional full), KANJIDIC2, deinflection (頑張って -> 頑張る); instant
  meanings and readings in the word card before the AI arrives.
- [x] **Chinese:** CC-CEDICT. **Korean:** Wiktionary via kaikki.org (built).

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

- [x] **YouTube Music and YouTube music videos:** site adapters, lyrics from LRCLIB (by duration), search /
  paste / `.lrc` by hand, choices and timing saved per track, Watch | Listen switch (automatic on music sites,
  overridable per site; a one-time offer on YouTube songs). Lyrics become a normal Langtitles track. (0.4.0)
- [ ] Lyrics already on the page (YouTube Music's lyrics tab; Spotify's and Apple's synced views) as a source;
  word-by-word karaoke highlight from enhanced LRC (parsed already, not drawn yet); Tap to sync unsynced lyrics.
- [x] **Lyrics sheet** (Strip / Sheet / Focus) on music sites; Song tab; **song-mode analysis:** whole song in
  context, sung readings, poetic grammar, imagery notes; choruses cost nothing after the first time (cached). (0.4.0)
- [~] **Spotify web player** and **Apple Music web:** what's playing via Media Session / the now-playing bar;
  untested on the real sites; Spotify's progress-bar clock not wired in yet.
- [x] **Song guides** (every lyric line by line, then what you might miss and how to read the story; Opus,
  streamed), **Library → Music** by artist, artwork (page, then iTunes Search), song coverage. (0.4.0)
- [ ] Artist pages (recurring words and themes across an artist's songs).
- [x] **Practice:** loop and slow down (existing controls), Fill the gaps (unknown words blanked until hovered),
  sing-along view, song coverage with the five words to learn first. (0.4.0)
- [ ] Shadowing with the microphone; review cards with artwork and "play from 1:23".
- [x] **Anime openings and endings:** "Songs in this show" from MyAnimeList (Jikan; AnimeThemes was
  unreachable), each with a song guide written from its LRCLIB lyrics and a YouTube Music link. (0.4.1)
- [x] **K-pop / Korean songs:** sung pronunciation in Hangul with the sound change named, contractions given in
  full, 반말 / 존댓말 and 너 / 당신 shifts, feeling-endings (-잖아, -거든, -ㄹ게), why a line switches to English,
  hanja for Sino-Korean words in the song guide. (0.4.1)
- [x] YouTube Music's own (licensed) lyrics tab as a fallback when LRCLIB has nothing (much K-pop), and Tap to
  sync for lyrics without timings. (0.4.2; the page reading is untested on the live site)
- [ ] K-pop, if wanted: concept and era notes in song guides. Not possible: per-member line colours (no reliable free data).
- [x] Tests for LRC / enhanced LRC parsing, LRCLIB matching, chorus counts, video titles, MAL theme lines.
- [ ] Adapter tests against saved page snapshots.

## 14. Requested after 0.5.1: built in 0.6.0

Done in 0.6.0 (everything in this section except where noted):
- Guides: written in general; "In this line" built free from the line breakdown (in the hover card only what the
  card doesn't already show); no paid check or automatic additions on reopen (a check only on request, at the
  bottom of the guide); plain-English openings; one guide per form (Korean name matching, word guides by the
  dictionary headword, duplicates merged once); 25 built-in Korean grammar guides (Korean guides written from one
  line swapped for them, notes kept); Check my guides tidies per-line notes for free and flags guides written
  around one line; guide reuse counts in Progress. Note: the guide version was already fixed at 1, so updates
  never made guides look missing; the real causes were the per-line checks and the name variations.
- Subtitles: every saved breakdown loads at once (nothing is requested until they're in); saved breakdowns are
  reused across versions and line models, marked older, with a Redo button; the subtitle file chosen for an
  episode loads as soon as the page does.
- Phrases: only fixed expressions or words that mean something different together; Korean spacing respected;
  dictionary phrases must match the line's reading; no brackets over the subtitle by default (a switch in Look).
- My shows: remove from the panel and from Library → Shows. YouTube: the overlay fits the visible player; songs
  get a Listen offer.
- Lessons: one teacher-style lesson per episode (best lessons first, then a walk through the whole episode,
  links to every guide, frames taken about once a minute while watching); "I've finished this show" / "this
  season" (same subtitle source, at most 20 downloads a minute, lessons at half price through the Batch API,
  cost shown first); a long show companion once the lessons are written. The show vocabulary guide stays.
- Song guides: a dissection with the best lessons first, links, and K-pop concept notes.
- Listen extras: lyrics from Spotify's / Apple Music's own lyrics view as a fallback (untested on the live
  sites), karaoke highlight from word timings, shadowing (M), song review cards with artwork and Play from,
  an artist overview in the Library.
- Not done: Chinese name matching and built-in Chinese guides (left for later, as asked).


### Don't pay twice for the same subtitles
- [~] Already there: every line breakdown is saved in the browser (IndexedDB), keyed by the line and the line
  before it, so re-watching an episode reuses them for free; downloaded subtitle files are saved too.
- [ ] **The gap to close:** saved breakdowns are only reused while the line-breakdown version, the line model
  and your native language stay the same, so an update that improves the breakdowns (or switching the line
  model) makes old episodes get bought again. Change this to: always reuse what's saved, whatever version
  wrote it; show "made with an older version" on the line, with a per-episode "Redo this episode with the new
  version" button (and its cost) instead of redoing it silently.
- [ ] Per-episode breakdown store: keep each episode's full set of lines with its breakdowns together (not
  only line by line), so a finished episode loads instantly and can be backed up / counted.

### "I've finished this show" (spoilers allowed)
- [ ] A **Finished this show** button (Library → Shows, and the panel): fetch subtitles for every episode of
  every season from the subtitle sites (OpenSubtitles / SubDL / Jimaku), even episodes never watched with
  Langtitles; show what was found and what's missing per season, with a cost estimate before anything is paid.
- [ ] Then write a **whole-show guide** with spoilers allowed: a walk back through the show from the first
  episode to the last, re-telling it while teaching the language, in the same blog-style lesson format as
  below (one chapter per episode or arc, as long as it takes). Use the Batch API (half price) for the long run.
- [ ] Frames for episodes never watched with Langtitles: not possible without playing them, so those chapters
  use frames only where they exist; say so in the guide rather than leave gaps.

### Episode lessons: one real lesson, not a word list
- [ ] Merge **Recap** and **Lesson** into one **Lesson**: it walks through the episode from the beginning to
  the end, as long as it takes, telling what happens while teaching the language, written like a Tae Kim-style
  blog lesson (explaining, connecting, building up), never a list of words. Spoiler-free when the show isn't
  marked finished (only lines up to where you've watched).
- [ ] **Every word, phrase and grammar form in a lesson is a link** that opens its guide (writing it then if
  it doesn't exist yet, from the line in the lesson).
- [ ] **Frames inside the lesson, at least 3 per episode:** while watching, keep a small frame every minute or
  so (with its time and the line on screen), so the lesson can place the frame where a line or word is taught
  and explain around it ("here, as he turns away, he says …"). The model is told which frames exist (time and
  line) and chooses where they go; optionally the frames are sent to Claude so it can describe the scene (costs
  more; a setting).
- [ ] Same rules for the **whole-show guide** above.

### Song guides: a dissection, not a translation
- [ ] Rewrite the song guide format: explore the song with the reader like a blog post / lesson (why this word,
  what this image is doing, how this line turns the meaning of the last one, what the listener feels and why),
  not quote → translation → bullet notes. Translations only where needed, inside the explanation.
- [ ] Make both song guides and episode lessons **engaging**: a voice, questions to the reader, build-ups and
  pay-offs, short sections, frames / artwork where they help.
- [ ] Same links on every word, phrase and form in song guides.

### Guides: general first, your line second
- [ ] Word and grammar guides start with the **general** meaning and use, never with the line you met it in
  (e.g. 내게's guide must not open with 내게 말해). The line you met it in goes in its own section
  ("Where you met it" / "In this line") further down. Undo the earlier "lead with the line" rule; re-check saved
  guides that open with their line (Check my guides) and offer to fix them.
- [ ] **"Why it means something different here"** only when the meaning or use in the line is genuinely
  different from what the guide covers (another sense, another function). Not when the guide simply has no
  example of this exact situation, and never an answer that ends up saying "the guide already covers it":
  that should be "no difference", shown as nothing. Keep it short and assume the reader is smart.

### Guides are written for one line, then reused everywhere (the root cause, seen in Korean)
Found in the code: both guide prompts (grammar forms and words) contain the rule "Open the first section with
the core idea in one sentence, **tied to the line where the learner met it**", the word guide also says "Say
which sense is used where the learner met the word" in its first section, and phrases are told to "explain
the line through the phrase". So the general part of every guide is written around the first line it met. A
guide is saved once per form (all 을/를 lines share the 을/를 guide), so the next line shows a guide that
opens with a different line (the 을/를 guide opening with 뭐라도 나를 나를 구해줘 while you're on
내 웃음을 돌려놔줘). This affects every language, not just Korean.
- [ ] Rewrite the guide rules: every section except one is about the form or word **in general**, written so it
  reads right in any line. Nothing from the first line in What it is / How to make it / When to use it /
  examples (examples are fresh sentences, never the line itself).
- [ ] The line-specific part lives **outside the saved guide**: the "In this line" box, written per line (short
  and cheap: Haiku or the line breakdown's own note) and stored per line, so each encounter gets its own
  explanation and the guide itself never changes with the line. The "Where you met it" section becomes the
  list of every line you've met it in, each with its own one-line note, not text written into the guide.
- [ ] "In this line" for a grammar form explains **what the form is doing in this line** (을 marks 웃음 as the
  thing being given back), not the word's gloss ("웃음을: smile", as it shows now).
- [ ] **Guide labels are line-specific too:** the line breakdown names each form "including the form itself", so
  the chip reads "object marker 을 웃음을" (with the word). Use the guide's own general name for the chip
  ("object marker 을/를"), not the per-line label, and tell the breakdown to name the form, never the word.
- [ ] **Fix the guides already saved:** Check my guides finds guides whose general sections quote or describe
  the line they were written for, and rewrites just those sections to be general (cheap: only the affected
  sections, Sonnet), keeping their line as an encounter. Your own question notes stay.
- [ ] Same rule for song guides' and lessons' links: clicking a word opens the general guide, with "In this
  line" for the line in the lesson.

### One form's guide written as another form (원해 shown the 줘 guide), then "fixed" with an appendix
Seen on 나를 원해: the chip "casual speech" opens the guide for 해 / 반말, but that guide explains 해 only
inside the -아/어 줘 request pattern (해 줘 = "do it for me"), so the check says it would mislead, and then
**adds "Other uses you've met" to that guide automatically**.
- Cause 1, same as above: the 반말 guide (ko.casual_banmal) was written around the first line that used it, a
  줘 request (구해줘 / 잊어 줘), so a guide that should cover casual speech in general became a 줘 guide.
- Cause 2: 구해줘 carries two forms (보조 동사 -아/어 주다 "do for me" + the 반말 ending) and the breakdown
  can name just one; the request meaning then lands in the 반말 guide.
- Cause 3: the automatic note is a patch, not a fix. "Other uses you've met" grows an appendix on a guide
  whose main sections are too narrow, and the next line shows the same warning again.
- [ ] Section-14 fix (general guides) first; then **rewrite guides whose own sections are too narrow** when the
  check finds a use of the same form they don't cover (rewrite the general sections once, cheap, keeping your
  notes), instead of appending "Other uses you've met".
- [ ] When the check finds the line actually uses a **different form** than the guide (해 ending vs 해 줘
  request), it should say "this line uses X" and open / write X's guide, never add to the wrong guide.
- [ ] Korean form identifiers: ask the breakdown to list **every** form in a word (구해줘 = ko.aux_a_juda +
  ko.casual_banmal; 원해 = ko.casual_banmal only); add Korean name matching like Japanese has (none yet), and
  split 반말 into its endings where they behave differently (-아/어, -지, -냐/-니, -자) with one overview.
- [ ] Remove automatic "Other uses you've met" notes already added to guides where they belong to another form
  (part of Check my guides).
- [ ] Core Korean grammar (particles, 반말 / 해요 / 합니다, -아/어 주다, connectives) as **built-in guides** like
  the 43 Japanese ones, so these are never written from a single line (also part of section 15).

### Guide clean-up: stop paying again for guides you already have (causes found in the code)
- **Cause 1: a check on every new line.** Each time a saved guide opens in a line it hasn't seen (the word card
  opens the guide by itself after a moment), Langtitles pays Claude (Haiku) to check whether the guide fits the
  line, and may add "Other uses you've met" to it. That's a paid call per new line per guide, even though the
  guide itself isn't rewritten. Shows as "guide checks" in Spending.
- **Cause 2: the same guide under different names.** A guide is saved under the form's identifier. Japanese
  has a fixed list plus name matching; **Korean and Chinese have none**, so the same form named slightly
  differently by the line breakdown (casual_banmal / banmal_casual / casual_speech) gets a new guide each
  time. Word guides are saved under the dictionary form the breakdown gives, which can vary (彼 vs 彼の,
  원해 vs 원하다), with the same effect.
- **Cause 3: updates that change the guide version** (GUIDE_VERSION) make every saved guide look missing.
- [ ] Opening a saved guide **never costs anything**. The line-specific part goes in the "In this line" box at the
  top: taken from the line breakdown (already paid for: the word's meaning, role and note in this line), written
  in a fixed form, free. A paid, short, cheap note only when you ask for one (a button), or when the breakdown
  says the use is unusual.
- [ ] No automatic additions to guides; no automatic per-line checks. "Why it means something different here"
  only on request or when the breakdown flags it, and only for a genuinely different sense or function.
- [ ] One guide per form: fixed identifier lists and name matching for Korean and Chinese like Japanese; word
  guides saved under the dictionary's headword (from the built-in dictionaries), not whatever form the
  breakdown wrote; existing duplicates merged (notes and lines you've met kept), with a count of what was merged.
- [ ] Guides are never invalidated by an update: old guides keep working; improved versions are offered per
  guide (or in bulk, with a cost) instead of being rebought silently.
- [ ] A spending check in Progress: guides written vs. guides opened from saved, and guide-check spend, so it's
  visible that nothing is rebought.

### Subtitles and breakdowns after a reload
- Found: breakdowns ARE saved and re-used for free (keyed by the line and the line before it), but after a
  reload the panel shows "57/335 lines ready" and fills up gradually, because it asks for saved lines in small
  batches, 10 minutes ahead of where you are, exactly as if it were paying for them. It looks like starting
  again even when it costs nothing. Real re-buying does happen when: the subtitle file changes (a different
  Jimaku / OpenSubtitles file, or the site's own subtitles instead: different text, different lines), the line
  model is switched, or an update changes the breakdown version (section 14).
- [ ] On loading an episode, fetch every saved breakdown for the whole track at once (local, free) and show
  "335/335 saved" straight away; mark lines "saved" vs "new" in Script; only lines never seen are sent.
- [ ] Remember the subtitle file chosen for each episode and load it automatically on return (downloaded file
  kept locally), so a reload uses the same file and therefore the same saved breakdowns.
- [ ] Per-episode store of lines + breakdowns (also in section 14), so an episode reopens instantly.

### My shows
- [ ] **Delete a show from My shows** (the background has a remove function; nothing in the panel or Library
  calls it): a remove button on each show in the panel's My shows row and in Library → Shows.

### Phrases: rethink (bad false positives, and the display doesn't work)
- Found: 彼の was shown as a phrase meaning "that" because the dictionary has 彼の read **あの / かの** ("that");
  the dictionary check matches the spelling and ignores the reading (here かれの, "his"), and it also accepts
  pre-noun adjectives. The bracket label also collides with the word meanings above the line (今日いっぱい:
  "through the end of today" over "through").
- [ ] Dictionary phrase check: the entry's reading must match the line's reading; only expression entries
  (not pre-noun adjectives); never when the parts simply add up.
- [ ] Display: no brackets stacked over the word meanings. Options to choose from at build time: (a) a phrase
  replaces its words' meanings with one meaning spanning them (no second row), (b) phrases only in the word
  card ("Part of …") and the Line tab, nothing over the subtitle, (c) off by default. Recommendation: (b), plus
  (a) only for true idioms.

### Phrases: only real phrases
- [ ] A phrase is marked (bracket, phrase card, saved as a phrase) only when it's a **set phrase** or when the
  words **mean something different together** than apart. A word plus a verb that simply means the sum of its
  parts (내게 말해 = "tell me") is not a phrase; check the phrase list against this, and the dictionary check too
  (Korean has no expression dictionary yet, so Korean phrases need the stricter rule most).
- [ ] Korean: respect the spacing (띄어쓰기). Words separated by a space are separate words unless they form a
  set phrase; a particle belongs to the word it's attached to. Check the 내게서 case: written together it's
  나에게서 "from me" (에게서 is one particle); if the lyric has 내게 서… the 서 belongs to the next word.
- [ ] Particle forms like 내게서 / 내게 can still have their own form guides (에게서, 에게), but a guide for 내게
  is about 내게.

### YouTube
- [ ] **The overlay sits too high on YouTube:** the panel and subtitles follow the video element, which on
  YouTube can be taller than the visible player (cropped by the player box). Fit to the visible player instead
  (the video rect clipped by its player container / any clipping ancestor), and keep the panel below the site's
  top bar.
- [ ] On a YouTube video that's clearly a song, the "Turn on subtitles in the player" hint shows before Listen
  mode is offered; show the Listen offer in the panel instead of that hint.

## 15. Built-in guide library from a large corpus (when you're on a higher plan; not built yet)

- [ ] When you ask: a list of shows and songs per language that together cover most everyday vocabulary;
  later files mostly confirm what's covered and record new forms ("met as"), with fewer new guides.

Idea: instead of the API writing a guide the first time you meet anything (even the most basic words), write
general guides in advance for almost everything you'll meet, so the API only handles context.
- [ ] **Input from you:** subtitle files for 100+ Chinese shows, K-dramas, anime and Japanese shows, plus K-pop
  and J-pop lyrics; one folder per language, grouped by show / artist; any format (srt, ass, vtt, lrc, txt).
  Shared privately (uploaded to a session or a private repository), never a public one.
- [ ] **Scope you described:** every season of the ~100 most popular anime, K-dramas, C-dramas, live-action Japanese
  shows, and other Korean / Chinese shows (several million lines). Processed locally by scripts, not line by line
  by Claude: Japanese via the dictionary + deinflection, Korean by splitting particles / endings from stems,
  Chinese by dictionary word segmentation. Variety of genres matters more than count; the frequency curve shows
  where new vocabulary stops paying off.
- [ ] **Getting the files:** supplied by you (upload / private repository), or downloaded through the subtitle
  APIs with your own keys set in the environment (never pasted in chat), within their download limits.
- [ ] **What it saves:** guide spending mostly (line breakdowns stay per line, since they depend on context).
  Optional, for shows you plan to watch: pre-made breakdowns for specific subtitle files, so watching those
  exact files costs nothing.
- [ ] Do section 14's guide fixes first (general format, one name per form, no paid checks on reopen).
- [ ] **Frequency first:** count every word and grammar form across the corpus, merged by dictionary form
  (食べさせられた → 食べる, 먹었어요 → 먹다, using the built-in dictionaries and deinflection); write from the most
  frequent down, so ~90% of what you hear is covered with the fewest guides. The counts show where to stop
  per language.
- [ ] **What gets a guide:** words; grammar forms (particles, endings, conjugations, which matter most in
  Korean); set phrases and idioms that recur (only real ones, per the phrase rule in section 14).
  Homographs get one guide per word (行く / 行う, 了 le / liǎo, Korean words that differ in hanja).
- [ ] **Format:** the general guide format from section 14 ("written for one line" fixed first, or the library
  would copy the problem 20,000 times). Fresh example sentences, never lines from the corpus, so nothing
  copyrighted ships; the corpus is only used to choose and rank what to write.
- [ ] **Who writes them:** Claude in sessions on your plan (not per-guide API cost), language by language,
  with a checking pass (the guide-audit problems: grammar written up as words, romanisation, names,
  contradictions) before shipping.
- [ ] **Shipping:** roughly 20–40 MB of text for ~20,000 guides; each language an optional download on first
  use (or bundled, like the dictionaries), versioned so improvements can be shipped; your own guides (with
  your question notes) always override the built-in ones.
- [ ] **After this the API only writes:** the short per-line "In this line" note (Haiku), answers to your
  questions, and guides for words outside the library (which can be added to it as they come up).

## 16. Phones: iOS and Android apps (after Chrome and Firefox are finished and polished; not built yet)

Goal: standalone, paid (subscription) apps that do what Language Reactor does on desktop, which nothing offers
on phones today: the streaming services the user already subscribes to, their own websites, and songs.
- Found (tested on your iPhone): Netflix, Disney+ and the big services don't play inside another app; they send
  users to their own apps. Some smaller sites do play. The phone app's video side is therefore: YouTube and the
  sites that work, the user's own videos and files, and songs (Spotify / Apple Music, below). Rethink pending.
- [ ] **A learning app, not just a browser:** the user opens the streaming services they subscribe to (Netflix,
  Disney+ and others) or their own sites in the app's built-in WebKit view (the same as any third-party browser
  on the App Store), with the Langtitles subtitles and panel on top; plus everything the Library offers: lessons,
  word and grammar guides, song guides, word bank, review, progress. Prototype playback first (iOS, then Android,
  where the web view's DRM needs testing).
- [ ] **Store listing:** a language-learning app; not presented as a tool for any one streaming service.
- [ ] **No scene frames in the app** (copyright). Option for later: frames kept only on the user's own phone,
  like their own screenshots, never uploaded or shared.
- [ ] **Songs:** the Spotify iOS / Android SDK (the user logs into their own Spotify; the app gets the track and
  playback position from the Spotify app) feeding our own lyrics screen (LRCLIB, Listen mode, song guides), and
  Apple Music via MusicKit. Smoother than wrapping Spotify's website, and within their terms.
- [ ] **Subscriptions:** in-app purchases through Apple / Google (15% under their small-business programmes,
  30% above $1M a year; payment rules differ by region now), so subscribers never need an API key.
- [ ] **Backend (needed for subscriptions):** accounts, the app calling Claude through our server with
  per-user usage limits, sync of word bank / guides / known words across devices. The built-in guide library
  (section 15) keeps the cost per subscriber low, which is what makes a subscription price work.
- [ ] Shared core: line breakdowns, guides, word bank, review and backups moved into one module used by the
  extensions and the apps (likely a cross-platform app: React Native or similar, with a native web view).

## 17. More languages (future; not now)

Ranked by how much good media there is to learn from (film, TV, music, and how easy subtitles are to find):

1. **Russian:** a huge film and TV catalogue, plenty of subtitles, big music scene.
2. **Arabic (regional varieties):** Egyptian first (the largest film / TV / music output; Ramadan series), then
   Levantine (Syrian / Lebanese drama), Gulf (Khaleeji TV), Maghrebi (Moroccan / Algerian / Tunisian).
   Catch: subtitles are usually in Modern Standard Arabic while people speak dialect; right-to-left layout.
3. **Thai:** lakorn dramas, very popular series (including BL), T-pop; good subtitle supply.
   Catch: no spaces between words (needs word splitting), tones.
4. **Cantonese:** Hong Kong cinema and TVB drama, Cantopop. Catch: subtitles are often written in standard
   Chinese rather than spoken Cantonese; readings in jyutping.
5. **Indonesian:** sinetron, a growing film industry, streaming originals, music.
6. **Tagalog / Filipino:** teleserye dramas, films, OPM; lots of Taglish (code-switching with English).
7. **Vietnamese:** films, V-pop, growing streaming output. Catch: tones and many short words.
8. **Kazakh:** smaller output, some film and Q-pop; much media is in Russian. Cyrillic, moving to Latin script.
9. **Uzbek:** Uzbekfilm and music; fewer subtitles. Latin and Cyrillic both in use.
10. **Mongolian:** small output, some film and music. Cyrillic.
11. **Khmer:** small output, limited subtitles. Catch: no spaces between words.

Each needs: a dictionary (Wiktionary extracts from kaikki.org cover most of these), word splitting where there
are no spaces (Thai, Khmer), right-to-left support (Arabic), readings / romanisation choices per language.
