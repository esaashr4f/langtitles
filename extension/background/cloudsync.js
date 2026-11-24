// Firefox Sync: settings, known words and the word bank kept the same on every computer signed in to
// Firefox (with Add-ons ticked in its Sync settings). Uses browser.storage.sync, which Firefox encrypts
// end to end. It holds about 100 KB, so the word bank goes in a compact form (one example line per word),
// gzipped and split into pieces. API keys and logins are never synced.
// Each computer merges what is there with its own data and writes the result back: newer entries win,
// example lines from both are kept, and removals are remembered for 90 days so they reach every computer.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});
  const M = () => SG.syncmerge;

  const META = 'lt-meta';
  const PIECE = 'lt-';
  const PIECE_CHARS = 7000; // under the 8 KB per item limit
  const MAX_PIECES = 13; // 13 × 7 KB stays under the 100 KB total
  const EVERY = 10 * 60 * 1000;

  async function gzip(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function gunzip(b64) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  async function hash(text) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function syncState() {
    return (await browser.storage.local.get('syncState')).syncState || { keys: [], settingsJson: '', remoteAt: 0, last: 0 };
  }

  // What another computer wrote, or null. A half-written copy (pieces don't match) reads as 'partial'.
  async function readRemote() {
    const all = await browser.storage.sync.get(null);
    const meta = all[META];
    if (!meta || !meta.n) return null;
    let b64 = '';
    for (let i = 0; i < meta.n; i++) {
      if (typeof all[PIECE + i] !== 'string') return 'partial';
      b64 += all[PIECE + i];
    }
    if ((await hash(b64)) !== meta.hash) return 'partial';
    const data = JSON.parse(await gunzip(b64));
    return Object.assign(data, { at: meta.at, device: meta.device });
  }

  async function writeRemote(data, device) {
    // Smallest form that fits: with example lines, then without, then without the word bank.
    let level = 0;
    let b64;
    for (;;) {
      const body = Object.assign({}, data, { bank: level >= 2 ? [] : data.bank.map((e) => M().compactEntry(e, level)), bankLeftOut: level >= 2 });
      b64 = await gzip(JSON.stringify(body));
      if (b64.length <= PIECE_CHARS * MAX_PIECES || level >= 2) break;
      level++;
    }
    if (b64.length > PIECE_CHARS * MAX_PIECES) throw new Error('Too much to sync, even without the word bank.');
    const items = {};
    const n = Math.ceil(b64.length / PIECE_CHARS);
    for (let i = 0; i < n; i++) items[PIECE + i] = b64.slice(i * PIECE_CHARS, (i + 1) * PIECE_CHARS);
    const old = (await browser.storage.sync.get(META))[META];
    const stale = [];
    for (let i = n; old && i < old.n; i++) stale.push(PIECE + i);
    if (stale.length) await browser.storage.sync.remove(stale);
    await browser.storage.sync.set(items);
    const at = Date.now();
    await browser.storage.sync.set({ [META]: { n, hash: await hash(b64), at, device, v: 1 } });
    return { level, bytes: b64.length, at };
  }

  async function deviceId() {
    let { syncDevice } = await browser.storage.local.get('syncDevice');
    if (!syncDevice) {
      syncDevice = Math.random().toString(36).slice(2, 10);
      await browser.storage.local.set({ syncDevice });
    }
    return syncDevice;
  }

  async function run() {
    const settings = await SG.loadSettings();
    if (!settings.firefoxSync) return { skipped: 'off' };
    const device = await deviceId();
    const st = await syncState();
    const now = Date.now();
    let remote = await readRemote();
    if (remote === 'partial') return { skipped: 'another computer is writing; trying again soon' };
    // Our own copy needs no merging in, only checking for local changes.
    const fromElsewhere = remote && remote.device !== device && remote.at > (st.remoteAt || 0);

    // Settings
    const mine = M().syncedSettings(settings, SG.backup.SECRETS);
    let settingsOut = mine;
    let settingsAt = st.settingsAt || now;
    const pick = M().pickSettings(mine, fromElsewhere ? remote : null, st.settingsJson, st.remoteSettingsAt);
    if (pick.use === 'remote') {
      const keep = {};
      for (const k of SG.backup.SECRETS.concat(M().LOCAL_ONLY)) if (settings[k] !== undefined) keep[k] = settings[k];
      await browser.storage.local.set({ settings: Object.assign({}, settings, remote.settings, keep) });
      settingsOut = remote.settings;
      settingsAt = remote.settingsAt;
    } else if (pick.use === 'mine' && JSON.stringify(mine) !== st.settingsJson) {
      settingsAt = now;
    }

    // Known words and characters
    const local = await browser.storage.local.get(['knownWords', 'known']);
    const knownWords = M().mergeKnown(local.knownWords, remote && remote.knownWords);
    const known = M().mergeKnown(local.known, remote && remote.known);
    const knownChange = {};
    if (!M().sameKnown(knownWords, local.knownWords || {})) knownChange.knownWords = knownWords;
    if (!M().sameKnown(known, local.known || {})) knownChange.known = known;
    if (Object.keys(knownChange).length) await browser.storage.local.set(knownChange);

    // Word bank
    const bank = new Map(await SG.cache.entries('bank'));
    const remoteBank = remote && !remote.bankLeftOut ? remote : remote ? { removed: remote.removed } : null;
    const merged = M().mergeBank(bank, remoteBank, st.keys, now);
    if (merged.puts.length) await SG.cache.putMany('bank', merged.puts);
    for (const key of merged.removes) await SG.cache.remove('bank', key);
    for (const [k, v] of merged.puts) bank.set(k, v);
    for (const k of merged.removes) bank.delete(k);

    const out = { v: 1, settings: settingsOut, settingsAt, knownWords, known, bank: Array.from(bank.values()), removed: merged.removed };
    const body = JSON.stringify([out.settings, out.settingsAt, out.knownWords, out.known, out.bank.map((e) => [e.key, M().stamp(e)]), out.removed]);
    const bodyHash = await hash(body);
    let wrote = null;
    if (bodyHash !== st.bodyHash || !remote) wrote = await writeRemote(out, device);
    const changedHere = merged.puts.length + merged.removes.length + (pick.use === 'remote' ? 1 : 0) + Object.keys(knownChange).length;
    const next = {
      keys: Array.from(bank.keys()),
      settingsJson: JSON.stringify(pick.use === 'remote' ? M().syncedSettings((await SG.loadSettings()), SG.backup.SECRETS) : mine),
      settingsAt,
      remoteSettingsAt: settingsAt,
      remoteAt: wrote ? wrote.at : remote ? remote.at : st.remoteAt,
      bodyHash,
      last: now,
      level: wrote ? wrote.level : st.level || 0,
      bytes: wrote ? wrote.bytes : st.bytes || 0,
      fromDevice: remote && remote.device !== device ? remote.device : st.fromDevice,
      error: '',
    };
    await browser.storage.local.set({ syncState: next });
    return { done: true, wrote: Boolean(wrote), level: next.level, changedHere, puts: merged.puts.length, removes: merged.removes.length };
  }

  let busy = false;
  let again = false;
  async function check() {
    if (busy) {
      again = true;
      return { skipped: 'busy' };
    }
    busy = true;
    try {
      const r = await run();
      if (r.done && r.changedHere && SG.cloudsync.onSynced) SG.cloudsync.onSynced(r);
      return r;
    } catch (e) {
      console.warn('Langtitles: sync failed', e);
      const st = await syncState();
      await browser.storage.local.set({ syncState: Object.assign(st, { error: e.message, last: Date.now() }) });
      return { error: e.message };
    } finally {
      busy = false;
      if (again) {
        again = false;
        setTimeout(check, 5000);
      }
    }
  }

  async function status() {
    const settings = await SG.loadSettings();
    const st = await syncState();
    return { on: Boolean(settings.firefoxSync), last: st.last, level: st.level || 0, bytes: st.bytes || 0, error: st.error || '' };
  }

  if (root.browser && browser.storage && browser.storage.sync) {
    // Another computer's copy arrived through Firefox Sync.
    browser.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'sync' || !changes[META] || !changes[META].newValue) return;
      if (changes[META].newValue.device === (await deviceId())) return; // our own write
      setTimeout(check, 3000);
    });
    setTimeout(check, 45000);
    setInterval(check, EVERY);
  }

  SG.cloudsync = { check, status, gzip, gunzip };
})(typeof globalThis !== 'undefined' ? globalThis : this);
