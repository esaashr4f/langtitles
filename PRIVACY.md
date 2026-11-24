# Langtitles privacy policy

Last updated: 24 November 2026

Langtitles is a browser extension for learning languages from the films, TV and music you watch. It has no
server of its own and no account system. **The developer receives none of your data**: there is no
analytics, no tracking, no advertising and no crash reporting. Everything Langtitles saves stays in your
browser, and it only sends data to the services listed below, which it needs for the features you use.

## What is stored on your device

Kept in your browser's extension storage (IndexedDB and `storage.local`), never uploaded by Langtitles:

- your settings, including the API keys and logins you enter (see below);
- subtitle files and lines from the shows you watch, and the breakdowns, guides, lessons and questions
  written for them;
- your word bank, review schedule, starred words and progress;
- the list of shows and episodes you have watched with Langtitles on;
- if "keep a picture of the scene" is on (it is by default), small still images of the scene for saved
  lines, words and questions.

Automatic backups are written as files to your own Downloads folder, and to your own Google Drive if you
connect it. If you set a backup passphrase, they are encrypted with it first. Connecting Google Drive asks
only for access to files Langtitles creates; it can't see anything else in your Drive. Disconnecting revokes
that access. Removing the extension removes its storage; backup files stay where you saved
them.

## What is sent, and to whom

Langtitles only contacts a service when you use a feature that needs it.

| Service | What is sent | When |
|---|---|---|
| **Anthropic** (api.anthropic.com, or the API address you set) | The subtitle or lyric lines being explained, with nearby lines for context; the show or song title; your questions; your API key (to authenticate). If you turn on "send the scene to Claude", the still image of the scene too. | When a line is broken down, a guide, lesson or song guide is written, or you ask a question |
| **Subtitle sites:** OpenSubtitles, SubDL, Jimaku | The show or film title, season and episode number and language; your API key or login for that site | When Langtitles looks for subtitles for the episode you are watching, if you have added a key for that site |
| **Show information:** TVmaze, AniList, Jikan (MyAnimeList), TMDB (only if you add a TMDB key) | The show or film title | To identify the show and its episodes, and get a poster |
| **Lyrics:** LRCLIB, Apple iTunes search | The song title and artist | In Listen mode, to find lyrics and identify the song |
| **jsDelivr CDN** (cdn.jsdelivr.net) | The single character whose stroke order you open; a one-time download of the public pitch-accent list | When you open stroke order, or first use pitch accent |
| **Google Drive** (only if you connect it) | Your backup files, to a *Langtitles backups* folder in your own Drive. Encrypted first if you set a passphrase | When a backup is made, and when you restore from Drive |
| **Firefox Sync** (only if you turn on "Sync between computers") | Your settings (without keys or logins), known words and word bank, through Mozilla's Firefox Sync, which encrypts it end to end so Mozilla can't read it | Every few minutes while something has changed |
| **The streaming site itself** | Langtitles re-downloads the subtitle file the site is already loading, without your cookies | When you watch something with Langtitles on |

Each service handles that data under its own privacy policy. Anthropic's commercial terms say API data is
not used to train its models. Langtitles uses your own API key, so requests are billed to and governed by
your own Anthropic account.

Langtitles reads the page you are on, so it can find the subtitles and the show title, and show its
overlay. It does not read or send anything else from the page, such as your account details or other tabs.

## Keys and passwords

API keys and the OpenSubtitles login are stored only in your browser. They are sent only to the service
they belong to, are never synced, and are left out of backup files unless you choose otherwise. The Google
sign-in token is kept only in your browser and never goes into backups.

## Children

Langtitles is not directed at children under 13 and does not knowingly collect anything from anyone.

## Changes

If this policy changes, the new version will be published with the extension update and in this file, with
a new date at the top.

## Contact

Questions about this policy: open an issue at https://github.com/esaashr4f/langtitles/issues
