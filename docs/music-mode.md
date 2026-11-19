# Listen mode: Langtitles for music

A second mode of the same extension. **Watch mode** (today's Langtitles) annotates subtitles on video.
**Listen mode** annotates synced lyrics on music sites and music videos. Both modes share one engine:
line analysis, the word card, guides, the word bank, review, the Library, settings, backups and the
spending tracker. Only the surface (where the text appears), the sources (where the text comes from) and
a few practice tools differ.

## 1. Where it runs

| Site | How Langtitles knows what's playing | Where it gets the position | Lyrics source | Loop / slow down |
|---|---|---|---|---|
| YouTube Music (music.youtube.com) | player bar title / artist / duration, Media Session metadata | the page's `<video>` element (exact) | LRCLIB, else the site's lyrics tab | yes / yes |
| YouTube music videos (youtube.com) | video title parsed ("Artist - Song (Official MV)"), channel | `<video>` (exact) | LRCLIB, else the video's own subtitles | yes / yes |
| Spotify web player (open.spotify.com) | now-playing bar, Media Session metadata | Spotify's own synced lyrics view (which line it highlights) when open; otherwise the progress bar | Spotify's lyrics view when open, else LRCLIB | Spotify's own controls only (no slow-down) |
| Apple Music web (music.apple.com) | now-playing bar, Media Session metadata | the page's media element | Apple's synced lyrics view, else LRCLIB | yes / limited |
| Any page with audio or video | the page title, or typed by hand | the media element | LRCLIB search, paste lyrics, or a `.lrc` file | where the page allows |

Each site gets a small **adapter** that answers the same questions: what is playing (title, artist,
album, duration, artwork), where playback is up to, whether it is playing, and (where possible) seek to a
time and set the speed. The rest of Listen mode only talks to adapters, so adding a site means writing
one adapter.

## 2. Getting the lyrics

In order, stopping at the first that works:

1. **Lyrics already on the page** (Spotify's or Apple Music's synced lyrics view, YouTube Music's
   lyrics tab): read them, including which line is active, so timing matches the site exactly.
2. **LRCLIB** (free, no key, allows calls from the browser): `GET /api/get` with track, artist, album
   and duration (it only matches within ±2 seconds, which avoids wrong versions); if nothing, `GET
   /api/search` and pick the closest by duration. Identify the client with the `Lrclib-Client` header
   ("Langtitles x.y (project page)"), send requests one at a time, honour `Retry-After` on 429.
   Use word-level timings when the record has them (`hasWordSync`, in the `lyricsfile` document);
   otherwise line timings (`syncedLyrics`, LRC); otherwise plain lyrics.
3. **By hand:** search box with results (track, artist, album, length, "synced" / "word-synced"
   badges), paste lyrics, or load a `.lrc` file.

The chosen lyrics are remembered per track (like subtitle choices per episode), so the song loads
instantly next time. Timing can be nudged with the same Earlier / Later controls; the shift is saved per
track.

**Unsynced lyrics:** shown as a scrollable sheet. A "Tap to sync" mode lets you tap each line as it's
sung once; the timings are saved for that track.

Lyrics become an ordinary Langtitles track (source "lyrics"), so line analysis, the Study tab, saving,
context lines and review work unchanged.

## 3. What you see

### On music sites (no video to draw on)

A **lyrics sheet**, docked to the right of the page, in the same design as the panel:

- the current line large in the middle, one line above (dimmed) and two below (fading), scrolling
  smoothly as the song plays (karaoke style);
- above each word its meaning and furigana, exactly as on video subtitles, using the same Show / For /
  JLPT settings; with word-level timing, each word lights up as it's sung;
- tap or click a word for the usual word card (guides, ☆, kanji, Known?);
- three sizes: **Strip** (one line along the bottom of the page, for listening while doing other things),
  **Sheet** (the default) and **Focus** (fills the page: big lyrics, artwork blurred behind them);
- it never covers the site's own play controls.

### On music videos (YouTube)

Exactly Watch mode: the annotated lyrics sit on the video like subtitles, with the same look, position,
burned-in-subtitle following and full-screen behaviour. The only differences are the lyrics source and the
Song tab.

### The panel in Listen mode

Same panel, tabs swapped where the content differs:

| Watch mode | Listen mode |
|---|---|
| Line | Line (with "How the sentence works", sung readings and poetic notes) |
| Transcript | Lyrics (the whole song; repeated parts marked "Chorus ×3") |
| Study (Words / Grammar) | Study (Words / Grammar), for the song |
| Subtitles | Song (lyrics source, timing, song guide, artist) |
| Display | Display (shared, with lyrics-sheet size and Strip / Sheet / Focus) |

A small **Watch | Listen** switch in the panel header shows the mode. Langtitles picks the mode itself
(music sites and videos that are clearly songs: Listen; everything else: Watch); the switch overrides it,
remembered per site. On a YouTube video that is a song, a one-time prompt asks "This looks like a song.
Show lyrics instead of subtitles?"

## 4. What's different about analysing songs

The line analysis gets a **song mode** (a flag in the request, a few extra rules in the prompt, extra
optional fields in the schema):

- **The whole song is analysed together** in one request (songs are short), so each line is read in the
  context of the song's story. Repeated lines (choruses) are analysed once and cost nothing after.
- **Sung readings:** lyrics often print a different reading over a word (本気 sung マジ, 運命 さだめ, 地球
  ほし, 未来 あした). Furigana show the sung reading; the word card shows both ("written ほんき, sung マジ")
  and why the artist chose it. Readings given in the source, such as 本気(マジ), are kept.
- **Poetic and old-fashioned grammar** (～ゆく, ～ぬ, ～たまえ, ～けり, 君 / 僕 in songs, dropped particles,
  inverted order) is explained, not treated as a mistake; such forms get a small "poetic" badge and
  their own grammar guides ("～ゆく in songs").
- **Imagery and metaphor:** a short note on lines whose meaning is figurative ("the cherry blossoms
  here stand for…").
- **English lines** inside Japanese lyrics are left plain.

## 5. Song guides, artists and the Library

- **Song guide** (Song tab, and the Library): what the song is about, its story or situation,
  imagery and metaphors, cultural references, the sung readings, the grammar it leans on, and its key
  vocabulary and set phrases. Written once per track (guide model; Sonnet by default), cached.
- **Artist page:** across every song you've listened to by an artist, their recurring words, themes
  and style. Updated as you listen.
- **Library → Music**, next to Shows: language → artists (artwork) → songs (artwork, lyrics coverage:
  "you know 82% of the words"). Artwork comes from the page's own media metadata, then the iTunes Search
  API (free, no key), then MusicBrainz / Cover Art Archive.
- Words and grammar saved from songs land in the same word bank with the song as their source; review
  cards show the artwork and the line, with a "play from 1:23" link (and the audio clip where the source
  allows, e.g. YouTube).

## 6. Practice made for songs

- **Loop a line** and **slow it down** (YouTube, YouTube Music, Apple Music; Spotify can't be slowed).
- **Fill the gaps:** a listening quiz that blanks out words you don't know yet; type or pick them as
  they're sung; the song pauses at the end of the line until you answer (optional).
- **Sing-along view:** lyrics with furigana only, bigger, for singing.
- **Shadowing:** record yourself singing or saying a line (microphone, kept on your computer) and play
  it back straight after the original.
- **Song coverage:** before you start, how many of the song's words you already know, and the five
  words that would help most.

## 7. Anime openings and endings (where the two modes meet)

- When an episode has an opening or ending song (♪ lines in the subtitles, or known from the free
  AnimeThemes API by show and episode), Watch mode offers **"Learn this opening"**: the song's title and
  artist, its lyrics in Listen mode, and its song guide.
- Songs learned this way appear both under the show (Shows → Monster → Songs) and under the artist in
  Music.

## 8. Costs and limits

- A whole song analysed once with Haiku costs a fraction of a penny; a song guide with Sonnet a few
  pence. Both are cached, so replays are free. Everything appears in the spending tracker under "Music".
- Spotify gives no way to slow down or clip audio; line drilling works best on YouTube.
- **Lyrics are copyrighted.** Using them for yourself is fine; LRCLIB is community data. A public or
  paid version would need a licensed lyrics provider (Musixmatch, LyricFind) for display, and lyric
  translations raise the same issue. Backups keep the lyrics for your own use.
- No Picture-in-Picture lyrics window in Firefox (only Chrome has that API); the Strip size covers that
  need instead.

## 9. Build order

1. Adapters and lyrics pipeline for **YouTube Music and YouTube music videos** (a real media element,
   exact timing, loop and speed): LRCLIB, by-hand search / paste / `.lrc`, saved choices, Watch | Listen
   switch. Lyrics run through the existing overlay and panel.
2. **Lyrics sheet** (Strip / Sheet / Focus) and the Listen-mode panel tabs; song-mode analysis (sung
   readings, poetic grammar, imagery, whole-song context, chorus caching).
3. **Spotify** adapter (page lyrics with active line, progress-bar fallback), then **Apple Music**.
4. **Song guides, artist pages, Library → Music,** artwork, lyrics coverage.
5. **Practice:** Fill the gaps, sing-along view, shadowing, song coverage; review cards from lyrics.
6. **Anime openings and endings** (AnimeThemes), linked from Shows.
7. Tests: LRC / enhanced LRC / lyricsfile parsing, LRCLIB matching by duration, chorus de-duplication,
   each adapter against saved page snapshots.
