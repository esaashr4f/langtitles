# Building Langtitles from source

These steps reproduce the add-on package from this source. Most of the extension is plain, unminified
JavaScript, CSS and HTML in `extension/`, used exactly as written. Three kinds of files in `extension/` are
generated, and each is described below with the script that makes it.

## Requirements

- Node.js 22.2 or newer (tested with 22.23.4) and npm 10 (tested with 10.9.9)
- Any operating system (Linux, macOS or Windows)

## Steps

```bash
npm ci                 # installs the exact versions in package-lock.json
npm run build:vendor   # rebuilds extension/vendor/anthropic-sdk.js
npm run package        # builds the grammar data, then the package: dist/langtitles-<version>.zip
```

`npm test` runs the test suite, and `npm run lint` runs `web-ext lint`.

## Generated files

### 1. `extension/vendor/anthropic-sdk.js`

This is the official Anthropic SDK (`@anthropic-ai/sdk` 1.8.0 from npm), bundled **unmodified** into one plain
script by esbuild 0.28.2 (`scripts/build-vendor.mjs`, run by `npm run build:vendor`). It is not minified.
The extension's background page uses it to call the Anthropic API with the user's own API key.

### 2. `extension/data/grammar/*.json` and `extension/data/library-fixes-ja.json`

These are built from the plain-text sources in `scripts/grammar/` and `scripts/guides/` by
`scripts/build-grammar.mjs` and `scripts/build-library-fixes.mjs`. Both run as part of `npm run package`
(via `npm run build:data`).

### 3. Dictionary data: `extension/data/dict/*.json` and `extension/data/jlpt.json`

These are built from public dictionary releases. The releases are large downloads, so they are not in this
repository, but the files built from them are, so `npm run package` does not need them. To rebuild them
from the original releases:

| Output | Source | Command |
|---|---|---|
| `ja-words-*.json`, `ja-words.json`, `ja-kanji.json` | JMdict (`JMdict_e`) and KANJIDIC2 (`kanjidic2.xml`) from the EDRDG, https://www.edrdg.org/ (CC BY-SA 4.0) | `node scripts/build-dict.mjs JMdict_e kanjidic2.xml` |
| `ko-words-*.json`, `ko-words.json`, `ko-hanja.json` | the Korean Wiktionary extract from kaikki.org, https://kaikki.org/dictionary/Korean/ (CC BY-SA 4.0 / GFDL) | `node scripts/build-kodict.mjs kaikki.org-dictionary-Korean.jsonl` |
| `zh-words-*.json`, `zh-words.json` | CC-CEDICT, https://cc-cedict.org/ (CC BY-SA 4.0) | `node scripts/build-zhdict.mjs cedict_1_0_ts_utf-8_mdbg.txt` |
| `jlpt.json` | Jonathan Waller's JLPT lists (CC BY) | `node scripts/build-jlpt.mjs` |

The output depends on the dictionary release you download, so a newer release gives slightly different
files.

## The Chrome version

`npm run package:chrome` runs `scripts/build-chrome.mjs`, which copies `extension/` to `dist/chrome/` and turns
it into a Manifest V3 extension without changing any source file:

- `manifest.json` is rewritten for Manifest V3 (service worker background, `action`, `host_permissions`,
  `contextMenus` and `alarms` in place of `menus`, PNG icons from `chrome/icons/`).
- `sw.js` loads the same background scripts as the Firefox manifest, in the same order.
- `vendor/browser-polyfill.js` is Mozilla's `webextension-polyfill` 0.12.0, copied unmodified from npm, so
  Chrome has the `browser` API. `chrome/chrome-compat.js` adds the rest (menus and action names, alarms
  for long timers).
- `chrome/netcapture.js` (in the page) and `chrome/netbridge.js` pass subtitle files to the background,
  since Chrome can't read response bodies.
- A few sentences in the Options page that name Firefox are reworded for Chrome.

The output is the same on every run (fixed file dates in the zip).

## Other contents

- The fonts in `extension/fonts/` are M PLUS Rounded 1c and Geist, both under the SIL Open Font License
  (OFL.txt files alongside them).
- The icons in `extension/shared/icons.js` are path data from Lucide (ISC licence), generated once from the
  `lucide-static` package and committed as plain data.
