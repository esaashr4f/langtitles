// Builds the Chrome (Manifest V3) version from the same source as the Firefox one.
//   node scripts/build-chrome.mjs        -> dist/chrome/ (load unpacked) and dist/langtitles-chrome-<version>.zip
// What changes for Chrome:
//   - manifest: MV3 (service worker background, action, host_permissions, new web_accessible_resources);
//   - the background scripts are loaded by one service worker (sw.js) with importScripts;
//   - Mozilla's webextension-polyfill gives Chrome the `browser` API Langtitles is written for, and
//     chrome/chrome-compat.js fills the remaining gaps (menus, alarms for long timers);
//   - Chrome can't read response bodies, so chrome/netcapture.js (in the page) and chrome/netbridge.js
//     pass subtitle files on instead (see background/sniffer.js);
//   - PNG icons (Chrome doesn't take SVG), and absolute font URLs in content-script CSS.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'extension');
const out = join(root, 'dist', 'chrome');
const fx = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
rmSync(join(out, 'manifest.json'));

// Chrome-only files.
mkdirSync(join(out, 'chrome'), { recursive: true });
cpSync(join(root, 'chrome', 'icons'), join(out, 'icons'), { recursive: true });
for (const f of ['chrome-compat.js', 'netcapture.js', 'netbridge.js']) cpSync(join(root, 'chrome', f), join(out, 'chrome', f));
cpSync(join(root, 'node_modules', 'webextension-polyfill', 'dist', 'browser-polyfill.js'), join(out, 'vendor', 'browser-polyfill.js'));
const COMPAT = ['vendor/browser-polyfill.js', 'chrome/chrome-compat.js'];

// The background: one service worker loading the same scripts, in the same order.
const bg = COMPAT.concat(fx.background.scripts);
writeFileSync(join(out, 'sw.js'), [
  '// Chrome service worker: loads the background scripts listed in the Firefox manifest (built by scripts/build-chrome.mjs).',
  'importScripts(',
  bg.map((s) => `  '${s}',`).join('\n'),
  ');',
  '',
].join('\n'));

// Extension pages: the polyfill and compat script before their own scripts.
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
  let html = readFileSync(file, 'utf8');
  if (!/<script\b/.test(html)) continue;
  const up = relative(dirname(file), out) || '.';
  const tags = COMPAT.map((s) => `<script src="${up}/${s}"></script>`).join('\n  ');
  html = html.replace(/<script\b/, `${tags}\n  <script`);
  writeFileSync(file, html);
}

// Wording that names Firefox. Each must still be found, so a changed sentence fails the build.
const WORDING = {
  'options/options.html': [
    ['stored only in this Firefox profile', 'stored only in this Chrome profile'],
    ['on every computer signed in to Firefox', 'on every computer signed in to Chrome'],
    ['Uses Firefox Sync, which encrypts everything end to end. It needs Firefox Sync turned on with <b>Add-ons</b> ticked (Firefox Settings → Sync), on each computer.',
      'Uses Chrome sync. It needs you signed in to Chrome with sync on and <b>Extensions</b> included (Chrome Settings → You and Google → Sync), on each computer.'],
    ['Firefox Sync has room for about 100 KB', 'Chrome sync has room for about 100 KB'],
    ['Checked when Firefox starts and every hour while it\'s open, so a long break is covered the moment you open Firefox again.',
      'Checked when Chrome starts and every hour while it\'s open, so a long break is covered the moment you open Chrome again.'],
    ['about:addons → ⚙ → Manage Extension Shortcuts', 'chrome://extensions/shortcuts'],
  ],
  'options/options.js': [["too big for Firefox Sync now", "too big for Chrome sync now"]],
};
for (const [file, pairs] of Object.entries(WORDING)) {
  const p = join(out, file);
  let text = readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`build-chrome: wording not found in ${file}: ${from}`);
    text = text.split(from).join(to);
  }
  writeFileSync(p, text);
}

// Fonts used by content-script CSS: relative URLs resolve against the web page in Chrome.
for (const css of ['fonts/rounded/rounded.css', 'fonts/geist/geist.css']) {
  const p = join(out, css);
  const dir = dirname(css);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/url\((['"]?)(?!data:|https?:|chrome-extension:)([^)'"]+)\1\)/g,
    (_m, _q, f) => `url('chrome-extension://__MSG_@@extension_id__/${dir}/${f}')`));
}

const icons = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };
const mv3 = {
  manifest_version: 3,
  name: fx.name,
  version: fx.version,
  description: fx.description,
  icons,
  minimum_chrome_version: '116',
  permissions: fx.permissions.filter((p) => !/^<all_urls>$|^webRequestBlocking$|^menus$/.test(p)).concat(['contextMenus', 'alarms']),
  host_permissions: ['<all_urls>'],
  background: { service_worker: 'sw.js' },
  content_scripts: [
    { matches: ['<all_urls>'], all_frames: true, match_about_blank: true, run_at: 'document_start', world: 'MAIN', js: ['chrome/netcapture.js'] },
    ...fx.content_scripts.map((cs, i) => Object.assign({}, cs, {
      js: COMPAT.concat(i === 0 ? ['chrome/netbridge.js'] : [], cs.js),
    })),
  ],
  action: { default_title: fx.browser_action.default_title, default_icon: icons, default_popup: fx.browser_action.default_popup },
  options_ui: fx.options_ui,
  web_accessible_resources: [{ resources: fx.web_accessible_resources.concat(['icons/*.png']), matches: ['<all_urls>'] }],
  commands: fx.commands,
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(mv3, null, 2) + '\n');

// Zip (deflate), without extra dependencies.
function zip(dir, target) {
  const files = walk(dir).sort();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(relative(dir, f).split('\\').join('/'));
    const data = readFileSync(f);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0x00210000, 10); // a fixed date (1980-01-01) so builds are reproducible
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    parts.push(head, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0x00210000, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(target, Buffer.concat([...parts, cd, end]));
  return files.length;
}
const target = join(root, 'dist', `langtitles-chrome-${fx.version}.zip`);
const n = zip(out, target);
console.log(`dist/chrome/ and ${relative(root, target)} (${n} files)`);
