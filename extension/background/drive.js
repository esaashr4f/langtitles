// Google Drive: automatic backups also saved to a "Langtitles backups" folder in your Drive, and restored
// from there on any computer. Signs in with Google through browser.identity (no password passes through
// Langtitles). Asks only for the drive.file scope, so Langtitles can see the files it made itself and
// nothing else in your Drive.
// Google needs an OAuth client ID for the sign-in. DEFAULT_CLIENT_ID is the published extension's; a
// self-built copy can use its own (Options → Backups → Google Drive → Advanced).
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});

  const DEFAULT_CLIENT_ID = '';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER = 'Langtitles backups';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size';

  async function driveState() {
    return (await browser.storage.local.get('driveState')).driveState || {};
  }
  async function setDriveState(patch) {
    const next = Object.assign(await driveState(), patch);
    await browser.storage.local.set({ driveState: next });
    return next;
  }

  async function clientId() {
    const s = await SG.loadSettings();
    return (s.driveClientId || '').trim() || DEFAULT_CLIENT_ID;
  }

  function redirectUrl() {
    return browser.identity.getRedirectURL();
  }

  // interactive: show Google's sign-in and consent window. Otherwise try silently (works while you
  // stay signed in to Google in this browser and haven't removed Langtitles' access).
  async function signIn(interactive) {
    const id = await clientId();
    if (!id) throw new Error('no client id');
    const params = new URLSearchParams({ client_id: id, response_type: 'token', redirect_uri: redirectUrl(), scope: SCOPE });
    const st = await driveState();
    if (!interactive) params.set('prompt', 'none');
    if (st.email) params.set('login_hint', st.email);
    const back = await browser.identity.launchWebAuthFlow({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params, interactive: Boolean(interactive) });
    const got = new URLSearchParams(new URL(back).hash.slice(1));
    if (got.get('error')) throw new Error(got.get('error'));
    const token = got.get('access_token');
    if (!token) throw new Error('Google did not return access.');
    const expires = Date.now() + (Number(got.get('expires_in')) || 3600) * 1000 - 60000;
    await setDriveState({ token, expires, needsSignIn: false });
    return token;
  }

  async function token(interactive) {
    const st = await driveState();
    if (st.token && st.expires > Date.now()) return st.token;
    try {
      return await signIn(interactive);
    } catch (e) {
      if (!interactive) await setDriveState({ needsSignIn: true });
      throw e;
    }
  }

  async function call(url, init, retried) {
    const t = await token(false);
    const res = await fetch(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + t }, (init && init.headers) || {}) }));
    if (res.status === 401 && !retried) {
      await setDriveState({ token: '', expires: 0 });
      return call(url, init, true);
    }
    if (!res.ok) throw new Error(`Google Drive: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  async function folderId() {
    const st = await driveState();
    if (st.folderId) {
      try {
        const f = await (await call(`${API}/files/${st.folderId}?fields=id,trashed`)).json();
        if (!f.trashed) return st.folderId;
      } catch (e) {
        /* gone: make a new one */
      }
    }
    const q = `mimeType='application/vnd.google-apps.folder' and name='${FOLDER}' and trashed=false`;
    const found = await (await call(`${API}/files?` + new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' }))).json();
    let id = found.files && found.files[0] && found.files[0].id;
    if (!id) {
      const made = await (await call(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
      })).json();
      id = made.id;
    }
    await setDriveState({ folderId: id });
    return id;
  }

  async function upload(name, text) {
    const parent = await folderId();
    const boundary = 'lt' + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: [parent], mimeType: 'application/json' }) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    const f = await (await call(UPLOAD, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
    return f.id;
  }

  async function list() {
    const parent = await folderId();
    const q = `'${parent}' in parents and trashed=false`;
    const out = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,createdTime,size)', orderBy: 'createdTime', pageSize: '200' });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await (await call(`${API}/files?` + params)).json();
      out.push(...(r.files || []));
      pageToken = r.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  async function download(id) {
    return (await call(`${API}/files/${id}?alt=media`)).text();
  }

  async function remove(id) {
    try {
      await call(`${API}/files/${id}`, { method: 'DELETE' });
    } catch (e) {
      /* already gone */
    }
  }

  // The newest full snapshot and the change files after it: what a restore needs.
  async function latestSet() {
    const files = (await list()).filter((f) => /\.langtitles$/.test(f.name));
    const fulls = files.filter((f) => /-full\.langtitles$/.test(f.name) || !/-changes\.langtitles$/.test(f.name));
    const base = fulls[fulls.length - 1];
    if (!base) return [];
    const after = files.filter((f) => /-changes\.langtitles$/.test(f.name) && f.createdTime > base.createdTime);
    const out = [];
    for (const f of [base].concat(after)) out.push({ name: f.name, text: await download(f.id) });
    return out;
  }

  async function connect() {
    await signIn(true);
    // Which account, so the next silent sign-in picks it.
    try {
      const about = await (await call(`${API}/about?fields=user(emailAddress)`)).json();
      await setDriveState({ email: (about.user && about.user.emailAddress) || '' });
    } catch (e) {
      /* fine without it */
    }
    await folderId();
    await setDriveState({ connected: true, hasFull: false });
    return status();
  }

  async function disconnect() {
    const st = await driveState();
    if (st.token) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(st.token), { method: 'POST' });
      } catch (e) {
        /* the token runs out within the hour anyway */
      }
    }
    await browser.storage.local.set({ driveState: {} });
    return status();
  }

  async function status() {
    const st = await driveState();
    return {
      connected: Boolean(st.connected),
      email: st.email || '',
      needsSignIn: Boolean(st.needsSignIn),
      hasClientId: Boolean(await clientId()),
      redirect: root.browser && browser.identity ? redirectUrl() : '',
      lastUpload: st.lastUpload || 0,
      error: st.error || '',
    };
  }

  SG.drive = { connect, disconnect, status, upload, remove, latestSet, driveState, setDriveState };
})(typeof globalThis !== 'undefined' ? globalThis : this);
