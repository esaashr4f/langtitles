# Firefox Add-ons (AMO) listing

Everything to paste into https://addons.mozilla.org/developers/ when submitting. Fields are in the order the
submission form asks for them.

## 1. Upload

- **How to distribute:** On this site (listed).
- **Platforms:** tick **Firefox** only. The manifest allows Firefox for Android, but the extension hasn't
  been tried there (right-click menus don't exist on Android), so don't list it until it has been tested.
- **File:** `dist/langtitles-<version>.zip` from `npm run package`.
- **Source code:** **Yes**, it's needed: `extension/vendor/anthropic-sdk.js` is a bundle made by esbuild.
  Upload the zip from:
  ```bash
  git archive --format=zip -o dist/langtitles-source.zip HEAD
  ```
  `BUILD.md` at the top of that zip tells the reviewer how to rebuild it.

## 2. Describe the add-on

**Name:** Langtitles

**Add-on URL:** `langtitles`

**Summary** (250 characters max; this one is 222):

> Learn Japanese, Korean and Chinese from what you watch. Word-by-word subtitle breakdowns with furigana
> and pinyin, plain-English grammar guides, a word bank and review, on any streaming site. Uses Claude with
> your own API key.

**Description:**

```
Langtitles turns the subtitles on any streaming site into a word-by-word lesson, written for that exact line.

<b>Above every word</b>
• Its meaning in this sentence and its reading: furigana for Japanese, pinyin (coloured by tone) for Chinese, hanja for Korean
• A coloured bar under each phrase showing its job in the sentence: topic, object, predicate…
• Hover a word to pause and see how it's built: 食べ eat + させ make (someone) do + られ passive + た past

<b>Grammar guides in plain English</b>
Every form links to a guide: what it is, how to make it, how it feels, and the forms it gets confused with. Over 80 common Japanese, Korean and Chinese forms come built in, and more are written as you meet them and kept for good.

<b>Ask about any line</b>
"Why は and not が here?" "Could I say this to my boss?" Claude answers with the scene in mind, and you can ask follow-ups.

<b>Keep what you learn</b>
• Star words, characters and whole lines into your word bank, with the moment they were said
• Spaced-repetition review with cards made from the lines you actually watched
• Export to Anki
• Kanji and hanzi entries with animated stroke order and components
• Pitch accent for Japanese
• Lessons that walk you through an episode after you've watched it

<b>Subtitles when the site has none</b>
Langtitles can fetch subtitles in the language you're learning from OpenSubtitles, SubDL and Jimaku (with your own free accounts), line them up with the video, and remember your choice for the next episode.

<b>Music too</b>
Listen mode does the same for song lyrics on YouTube Music, Spotify and Apple Music.

<b>Your key, your data</b>
Langtitles has no server and no account. It uses your own Anthropic API key, so you pay Anthropic directly for what you use, and a spending tracker shows what you've spent. Everything you save stays in your browser, with automatic backups to your Downloads folder.

You need an Anthropic API key (console.anthropic.com) to use the breakdowns and guides.
```

**Categories:** Language Support; Photos, Music & Videos

**Tags:** language learning, subtitles, japanese, korean, chinese, furigana, pinyin, anime, kdrama, flashcards

**Support email:** *(your choice: AMO shows it publicly, so use a separate address if you prefer)*

**Support website:** https://github.com/esaashr4f/langtitles/issues

**Homepage:** https://github.com/esaashr4f/langtitles

**Licence:** MIT

**Privacy policy:** **Yes, this add-on has a privacy policy.** Paste the contents of `PRIVACY.md`.

**Requires payment, non-free services or software, or additional hardware:** **tick it.** It needs an
Anthropic API key, which is paid. Leaving this unticked is a common reason for rejection.

## 3. Images

- **Icon:** `extension/icons/icon.svg` (AMO takes the manifest icon automatically).
- **Screenshots** (1280×800, in `docs/store/`, in this order), with captions:
  1. `01-hover.png`: Every word broken into its pieces, with the grammar guide one click away.
  2. `02-panel.png`: The side panel: translation, word-for-word, and a transcript you can click.
  3. `03-word-guide.png`: Plain-English grammar guides for each form.
  4. `04-episode-words.png`: The new words in an episode, most frequent first.
  5. `05-word-bank.png`: Your word bank keeps each word with the line you met it in.
  6. `06-review.png`: Review cards made from the lines you watched.
  7. `07-stroke-order.png`: Stroke order and components for every kanji and hanzi.
  8. `08-korean.png`: Korean with hanja over Sino-Korean words.
  9. `09-library.png`: The library of grammar guides.
  10. `10-tones.png`: Pinyin coloured by tone.

## 4. Notes to the reviewer

Only reviewers see this field.

```
Langtitles needs an Anthropic API key for its main features (Options → Claude). [Either: "A test key with a
small spending limit is: ..." / or: "Please use your own key; without one, the dictionary popups, word bank,
review and stroke order still work."]

How to test:
1. Open any video with subtitles, e.g. a YouTube video with Japanese captions turned on.
2. The breakdown appears above the subtitles; hover a word for details.
3. Press G for the subtitle menu, or click the toolbar icon for the word bank, review and library.

Permissions:
• <all_urls> and content scripts on all sites: the overlay works on any streaming site, which can't be listed
  in advance; it reads only the subtitles and the title.
• webRequest / webRequestBlocking: to see the subtitle files (VTT, TTML, SRT) the video player loads, so they
  can be broken down. Responses are read, never changed or blocked.
• webNavigation: to notice when a single-page player moves to the next episode.
• storage / unlimitedStorage: saved breakdowns, dictionaries and the word bank, kept in IndexedDB.
• menus: right-click items to turn Langtitles on or off, everywhere or for one site.
• downloads: automatic backups and Anki export, saved to the Downloads folder.

Remote requests (data only; no remote code is loaded or run): api.anthropic.com; the OpenSubtitles, SubDL
and Jimaku APIs (only with the user's own keys); TVmaze, AniList, Jikan and TMDB for show names; LRCLIB and
iTunes search for lyrics; cdn.jsdelivr.net for stroke-order data (KanjiVG SVG, hanzi-writer-data JSON) and
the Kanjium pitch-accent text file. Remote SVG is parsed for its path data and redrawn, never inserted as markup.

Third-party code: extension/vendor/anthropic-sdk.js is the official @anthropic-ai/sdk 1.8.0, bundled
unmodified and unminified by esbuild 0.28.2. BUILD.md in the source upload has the exact steps.
Generated data files (dictionaries, grammar JSON) are also described in BUILD.md.
```

## 5. Before the first submission

- **The add-on ID can't change after the first upload.** It's `langtitles@langtitles.local` in the
  manifest. That works, but if you'd like it tied to a domain or email you own, change it before uploading.
- **Data collection** in the manifest declares `websiteContent` (subtitle lines go to Claude) and
  `authenticationInfo` (your API keys and OpenSubtitles login go to their own sites). Firefox shows both
  when someone installs.
- `npm run lint` passes with no errors or warnings.
