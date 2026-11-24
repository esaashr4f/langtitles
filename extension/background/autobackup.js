// Automatic backups to Downloads/Langtitles backups/, and/or Google Drive (background/drive.js). Checked when Firefox starts and every hour while
// it runs; a backup is made when the last one is older than the chosen interval (a day by default),
// so a long break is covered as soon as Firefox is opened again.
// Each run writes a small "changes" file with what changed since the last run; once a week (or when
// there is no snapshot yet) it writes a full snapshot instead. Old files are removed, keeping the last
// few snapshots and the change files that follow them. Restoring: drop the newest snapshot and the
// change files after it into Options → Restore (or just the newest snapshot).
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});
  const FOLDER = 'Langtitles backups';
  const WEEK = 7 * 24 * 3600 * 1000;
  const stamp = (v) => (v && (v.updatedAt || v.savedAt || v.created || 0)) || 0;

  async function state() {
    return (await browser.storage.local.get('backupState')).backupState || { last: 0, lastFull: 0, files: [], seen: {} };
  }

  async function write(name, text) {
    // Chrome's background (a service worker) has no object URLs; a data: URL does the same job there.
    const blobUrl = typeof URL.createObjectURL === 'function';
    const url = blobUrl
      ? URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      : 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(text)));
    try {
      const id = await browser.downloads.download({ url, filename: `${FOLDER}/${name}`, saveAs: false, conflictAction: 'uniquify' });
      return id;
    } finally {
      if (blobUrl) setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  async function run(force) {
    const settings = await SG.loadSettings();
    const drive = settings.driveBackup && SG.drive ? await SG.drive.driveState() : {};
    const toDrive = Boolean(settings.driveBackup && drive.connected);
    const toDownloads = Boolean(settings.autoBackup || (force && !toDrive));
    if (!toDownloads && !toDrive) return { skipped: 'off' };
    const st = await state();
    const now = Date.now();
    const every = Math.max(1, Number(settings.backupEveryHours) || 24) * 3600 * 1000;
    if (!force && now - st.last < every) return { skipped: 'not due' };
    const pass = settings.backupPassphrase || '';
    const opts = { includeCaches: settings.backupCaches, includeKeys: Boolean(pass && settings.backupKeys) };
    const data = await SG.backup.collect(opts);
    // Drive starts with a full snapshot too, so its files can be restored on their own.
    const full = !st.lastFull || now - st.lastFull > WEEK || (toDrive && !drive.hasFull);
    let kind = 'full';
    let changes = 0;
    if (!full) {
      // Keep only what changed since the last run: newer records, and records not seen before.
      kind = 'changes';
      for (const [name, entries] of Object.entries(data.stores)) {
        const seen = new Set(st.seen[name] || []);
        data.stores[name] = entries.filter(([k, v]) => stamp(v) > st.last || !seen.has(String(k)));
        changes += data.stores[name].length;
      }
      data.kind = 'changes';
      data.since = st.last;
      if (!changes && st.last) {
        st.last = now;
        await browser.storage.local.set({ backupState: st });
        return { skipped: 'nothing changed' };
      }
    } else {
      data.kind = 'full';
      changes = Object.values(data.stores).reduce((a, l) => a + l.length, 0);
    }
    const name = SG.backup.fileName(now).replace('.langtitles', kind === 'full' ? '-full.langtitles' : '-changes.langtitles');
    const text = await SG.backup.serialize(data, pass);
    const id = toDownloads ? await write(name, text) : null;
    let driveId = null;
    if (toDrive) {
      try {
        driveId = await SG.drive.upload(name, text);
        await SG.drive.setDriveState({ lastUpload: now, error: '', hasFull: drive.hasFull || kind === 'full' });
      } catch (e) {
        // A missed change file would leave a gap, so the next Drive backup is a full snapshot.
        await SG.drive.setDriveState({ error: e.message, hasFull: false });
        if (!toDownloads) throw e;
      }
    }
    // Remember every key now held, so the next changes file can include new unstamped records.
    const all = await SG.backup.collect(opts);
    st.seen = {};
    for (const [n, entries] of Object.entries(all.stores)) st.seen[n] = entries.map(([k]) => String(k));
    st.files.push({ id, driveId, name, kind, at: now, changes });
    st.last = now;
    if (kind === 'full') st.lastFull = now;
    // Clean up: keep the last N full snapshots and every change file after the oldest kept one.
    const fulls = st.files.filter((f) => f.kind === 'full');
    const keep = Math.max(1, Number(settings.backupKeep) || 4);
    if (fulls.length > keep) {
      const cutoff = fulls[fulls.length - keep].at;
      for (const f of st.files.filter((x) => x.at < cutoff)) {
        if (f.id != null) {
          try {
            await browser.downloads.removeFile(f.id);
            await browser.downloads.erase({ id: f.id });
          } catch (e) {
            /* already moved or deleted by hand */
          }
        }
        if (f.driveId && SG.drive) await SG.drive.remove(f.driveId);
      }
      st.files = st.files.filter((x) => x.at >= cutoff);
    }
    await browser.storage.local.set({ backupState: st });
    return { done: kind, changes, name };
  }

  let busy = false;
  async function check(force) {
    if (busy) return { skipped: 'busy' };
    busy = true;
    try {
      return await run(force);
    } catch (e) {
      console.warn('Langtitles: backup failed', e);
      return { error: e.message };
    } finally {
      busy = false;
    }
  }

  async function status() {
    const st = await state();
    return { last: st.last, lastFull: st.lastFull, files: st.files.slice(-6) };
  }

  if (root.browser && browser.runtime && browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(() => setTimeout(() => check(false), 30000));
    setTimeout(() => check(false), 60000);
    setInterval(() => check(false), 3600 * 1000);
  }

  SG.autobackup = { check, status };
})(typeof globalThis !== 'undefined' ? globalThis : this);
