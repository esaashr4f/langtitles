'use strict';
// Google Drive backups against a stand-in for Google's sign-in and the Drive API.
const test = require('node:test');
const assert = require('node:assert');

const local = {};
const area = {
  async get(keys) {
    if (keys == null) return JSON.parse(JSON.stringify(local));
    const out = {};
    for (const k of [].concat(keys)) if (k in local) out[k] = JSON.parse(JSON.stringify(local[k]));
    return out;
  },
  async set(obj) {
    Object.assign(local, JSON.parse(JSON.stringify(obj)));
  },
};
const authUrls = [];
let signedIn = true;
globalThis.browser = {
  storage: { local: area },
  identity: {
    getRedirectURL: () => 'https://abc.extensions.allizom.org/',
    async launchWebAuthFlow({ url, interactive }) {
      authUrls.push({ url, interactive });
      if (!interactive && !signedIn) throw new Error('User interaction required.');
      return 'https://abc.extensions.allizom.org/#access_token=tok' + authUrls.length + '&expires_in=3599&token_type=Bearer';
    },
  },
  downloads: { async download() { return 1; } },
};

// Drive: files by id.
const files = new Map();
let nextId = 1;
let clock = 1000;
globalThis.fetch = async (url, init) => {
  init = init || {};
  const u = new URL(url);
  const auth = (init.headers || {}).Authorization || '';
  if (u.hostname === 'oauth2.googleapis.com') return new Response('{}');
  if (!auth.startsWith('Bearer tok')) return new Response('no', { status: 401 });
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'me@example.com' } });
  if (u.pathname === '/upload/drive/v3/files') {
    const body = init.body;
    const meta = JSON.parse(body.split('\r\n\r\n')[1].split('\r\n--')[0]);
    const content = body.split('\r\n\r\n')[2].replace(/\r\n--[^\r\n]+--$/, '');
    const id = 'f' + nextId++;
    files.set(id, Object.assign({ id, createdTime: new Date(clock++).toISOString(), content }, meta));
    return json({ id });
  }
  const m = /^\/drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname);
  if (m && !m[1] && (init.method || 'GET') === 'POST') {
    const meta = JSON.parse(init.body);
    const id = 'd' + nextId++;
    files.set(id, Object.assign({ id, createdTime: new Date(clock++).toISOString() }, meta));
    return json({ id });
  }
  if (m && !m[1]) {
    const q = u.searchParams.get('q');
    let list = Array.from(files.values()).filter((f) => !f.trashed);
    const parent = /'([^']+)' in parents/.exec(q);
    if (parent) list = list.filter((f) => (f.parents || []).includes(parent[1]));
    if (/mimeType='application\/vnd.google-apps.folder'/.test(q)) list = list.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
    return json({ files: list.map(({ id, name, createdTime }) => ({ id, name, createdTime })) });
  }
  if (m && m[1]) {
    const f = files.get(m[1]);
    if (init.method === 'DELETE') {
      files.delete(m[1]);
      return new Response('', { status: 204 });
    }
    if (!f) return new Response('nf', { status: 404 });
    if (u.searchParams.get('alt') === 'media') return new Response(f.content);
    return json({ id: f.id, trashed: false });
  }
  return new Response('?', { status: 400 });
};

require('../extension/shared/settings.js');
const SG = globalThis.SG;
const bank = new Map();
SG.cache = {
  async entries(name) {
    return name === 'bank' ? Array.from(bank.entries()) : [];
  },
};
require('../extension/shared/backup.js');
require('../extension/background/drive.js');
require('../extension/background/autobackup.js');

test('connect, back up to Drive only, then restore the newest set', async () => {
  local.settings = { driveBackup: true, autoBackup: false, driveClientId: 'client.apps.googleusercontent.com' };
  const st = await SG.drive.connect();
  assert.ok(st.connected);
  assert.equal(st.email, 'me@example.com');
  assert.ok(authUrls[0].interactive);
  assert.match(authUrls[0].url, /scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file/);
  assert.match(authUrls[0].url, /redirect_uri=https%3A%2F%2Fabc.extensions.allizom.org%2F/);

  bank.set('word|ja|猫', { key: 'word|ja|猫', kind: 'word', savedAt: 1, updatedAt: 1 });
  let r = await SG.autobackup.check(true);
  assert.equal(r.done, 'full');
  // Next run: only the change.
  bank.set('word|ja|犬', { key: 'word|ja|犬', kind: 'word', savedAt: Date.now() + 5, updatedAt: Date.now() + 5 });
  r = await SG.autobackup.check(true);
  assert.equal(r.done, 'changes');
  const names = Array.from(files.values()).filter((f) => f.name.endsWith('.langtitles')).map((f) => f.name);
  assert.equal(names.length, 2);
  assert.ok(!(await browser.storage.local.get('backupState')).backupState.files.some((f) => f.id != null), 'nothing written to Downloads');

  const set = await SG.drive.latestSet();
  assert.equal(set.length, 2);
  const parsed = await Promise.all(set.map((f) => SG.backup.parse(f.text)));
  assert.equal(parsed[0].kind, 'full');
  assert.deepEqual(parsed[1].stores.bank.map((e) => e[0]), ['word|ja|犬']);
  // The sign-in token never ends up in a backup.
  assert.ok(!set.some((f) => f.text.includes('tok')));
});

test('an expired sign-in is renewed silently, or flagged when Google wants you back', async () => {
  local.driveState.expires = 0;
  bank.set('word|ja|鳥', { key: 'word|ja|鳥', kind: 'word', savedAt: Date.now() + 10, updatedAt: Date.now() + 10 });
  let r = await SG.autobackup.check(true);
  assert.equal(r.done, 'changes');
  assert.equal(authUrls[authUrls.length - 1].interactive, false);
  assert.match(authUrls[authUrls.length - 1].url, /prompt=none/);

  signedIn = false;
  local.driveState.expires = 0;
  bank.set('word|ja|魚', { key: 'word|ja|魚', kind: 'word', savedAt: Date.now() + 20, updatedAt: Date.now() + 20 });
  r = await SG.autobackup.check(true);
  assert.ok(r.error);
  const st = await SG.drive.status();
  assert.ok(st.needsSignIn);
  // After signing in again, the next Drive backup is a full snapshot (no gap).
  signedIn = true;
  await SG.drive.connect();
  r = await SG.autobackup.check(true);
  assert.equal(r.done, 'full');
});
