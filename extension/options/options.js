(async function () {
  'use strict';
  const SG = globalThis.SG;
  const $ = (id) => document.getElementById(id);
  let settings = await SG.loadSettings();

  const CHECKS = ['hideKnownGlosses', 'toneColors', 'hanja', 'pitchAccent', 'addGrammarToReview', 'highlightNew', 'pauseOnePlus', 'slowReplay', 'autoKnownFromReview', 'autoFind', 'enabled', 'showMeaning', 'showParts', 'furigana', 'pinyin', 'hideKnownPinyin', 'showRoles', 'showTranslation', 'hideNative', 'hoverPause', 'resumeOnLeave', 'autoDeep', 'autoBackup', 'backupCaches', 'backupKeys'];
  const TEXTS = ['apiKey', 'baseURL', 'nativeLang', 'osApiKey', 'osUser', 'osPass', 'subdlKey', 'jimakuKey', 'backupPassphrase', 'tmdbKey'];

  const modelSel = $('model');
  for (const m of SG.MODELS) modelSel.append(new Option(m.name, m.id));
  const lineSel = $('lineModel');
  for (const m of SG.MODELS) lineSel.append(new Option(`${m.name} · $${m.outPrice} per million output tokens`, m.id));
  lineSel.addEventListener('change', () => save({ lineModel: lineSel.value }));

  function fill() {
    for (const id of CHECKS) $(id).checked = Boolean(settings[id]);
    for (const id of TEXTS) $(id).value = settings[id] || '';
    modelSel.value = settings.model;
    lineSel.value = settings.lineModel || settings.model;
    $('effort').value = settings.effort;
    $('learning').value = (settings.learning || []).join(', ');
    $('fontScale').value = settings.fontScale;
    $('fontScaleValue').textContent = Math.round(settings.fontScale * 100) + '%';
    $('lookaheadMin').value = String(settings.lookaheadMin);
    $('chunkSize').value = settings.chunkSize;
    $('slowRate').value = String(settings.slowRate);
    $('jlptFrom').value = String(settings.jlptFrom || 5);
    $('newPerDay').value = settings.newPerDay;
    $('monthlyCap').value = settings.monthlyCap || 0;
    $('concurrency').value = settings.concurrency;
    $('backupEveryHours').value = String(settings.backupEveryHours || 24);
    $('backupKeep').value = String(settings.backupKeep || 4);
    $('backupKeys').disabled = !settings.backupPassphrase;
    const m = SG.MODELS.find((x) => x.id === settings.model);
    $('modelNote').textContent = m ? `${m.note} $${m.inPrice} / $${m.outPrice} per million input / output tokens.` : '';
    renderHosts();
    const fm = $('featureModels');
    fm.textContent = '';
    for (const f of SG.FEATURES) {
      const row = document.createElement('label');
      row.className = 'feature-row';
      const name = document.createElement('span');
      name.textContent = f.label;
      const sel = document.createElement('select');
      sel.append(new Option('Main model', ''));
      for (const m of SG.MODELS) sel.append(new Option(m.name, m.id));
      sel.value = (settings.featureModels || {})[f.key] || '';
      sel.addEventListener('change', () => save({ featureModels: Object.assign({}, settings.featureModels, { [f.key]: sel.value }) }));
      row.append(name, sel);
      fm.append(row);
    }
    const gc = $('glossClasses');
    gc.textContent = '';
    const on = new Set(settings.glossClasses || []);
    for (const k of SG.WORD_CLASSES) {
      const label = document.createElement('label');
      label.className = 'check';
      label.title = k.title;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = on.has(k.key);
      box.addEventListener('change', () => {
        if (box.checked) on.add(k.key);
        else on.delete(k.key);
        save({ glossClasses: SG.WORD_CLASSES.map((x) => x.key).filter((x) => on.has(x)) });
      });
      label.append(box, document.createTextNode(' ' + k.label));
      gc.append(label);
    }
  }

  let savedTimer = null;
  async function save(patch) {
    settings = await SG.saveSettings(patch);
    fill();
    $('saved').classList.add('show');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1200);
  }

  for (const id of CHECKS) $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
  const typing = {};
  for (const id of TEXTS) {
    $(id).addEventListener('change', (e) => save({ [id]: e.target.value.trim() }));
    // Pasting a key and closing the tab must not lose it.
    $(id).addEventListener('input', (e) => {
      clearTimeout(typing[id]);
      typing[id] = setTimeout(() => SG.saveSettings({ [id]: e.target.value.trim() }).then((s) => {
        settings = s;
      }), 400);
    });
  }
  modelSel.addEventListener('change', () => save({ model: modelSel.value }));
  $('effort').addEventListener('change', (e) => save({ effort: e.target.value }));
  $('lookaheadMin').addEventListener('change', (e) => save({ lookaheadMin: Number(e.target.value) }));
  $('learning').addEventListener('change', (e) => {
    const list = e.target.value.split(/[\s,]+/).map((v) => SG.lang ? SG.lang.langCode(v) : v.toLowerCase()).filter(Boolean);
    save({ learning: list });
  });
  $('fontScale').addEventListener('input', (e) => {
    $('fontScaleValue').textContent = Math.round(Number(e.target.value) * 100) + '%';
  });
  $('fontScale').addEventListener('change', (e) => save({ fontScale: Number(e.target.value) }));
  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  $('jlptFrom').addEventListener('change', (e) => save({ jlptFrom: Number(e.target.value) }));
  $('slowRate').addEventListener('change', (e) => save({ slowRate: Number(e.target.value) }));
  $('monthlyCap').addEventListener('change', (e) => save({ monthlyCap: Math.max(0, Number(e.target.value) || 0) }));
  browser.runtime.sendMessage({ type: 'spend' }).then((r) => {
    if (r) $('spentNow').textContent = `About $${r.spent.toFixed(2)} spent so far this month.`;
  });
  $('newPerDay').addEventListener('change', (e) => save({ newPerDay: clampInt(e.target.value, 0, 200, 20) }));
  $('chunkSize').addEventListener('change', (e) => save({ chunkSize: clampInt(e.target.value, 2, 25, 8) }));
  $('concurrency').addEventListener('change', (e) => save({ concurrency: clampInt(e.target.value, 1, 8, 3) }));

  // ---- backups
  $('backupEveryHours').addEventListener('change', (e) => save({ backupEveryHours: Number(e.target.value) }));
  $('backupKeep').addEventListener('change', (e) => save({ backupKeep: Number(e.target.value) }));
  const ago = (t) => {
    if (!t) return 'never';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  async function backupStatus() {
    const st = await browser.runtime.sendMessage({ type: 'backupStatus' });
    const last = st && st.files && st.files[st.files.length - 1];
    $('backupResult').textContent = `Last backup: ${ago(st && st.last)}` + (last ? ` (${last.kind === 'full' ? 'full snapshot' : `${last.changes} changes`})` : '');
  }
  backupStatus();
  $('backupNow').addEventListener('click', async () => {
    $('backupResult').textContent = 'Backing up…';
    const r = await browser.runtime.sendMessage({ type: 'backupNow' });
    if (r && r.error) $('backupResult').textContent = 'Backup failed: ' + r.error;
    else if (r && r.skipped === 'nothing changed') $('backupResult').textContent = 'Nothing has changed since the last backup.';
    else backupStatus();
  });
  $('downloadBackup').addEventListener('click', async () => {
    $('backupResult').textContent = 'Preparing…';
    const pass = settings.backupPassphrase || '';
    const data = await SG.backup.collect({ includeCaches: settings.backupCaches, includeKeys: Boolean(pass && settings.backupKeys) });
    data.kind = 'full';
    const text = await SG.backup.serialize(data, pass);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = SG.backup.fileName();
    document.body.append(a);
    a.click();
    a.remove();
    $('backupResult').textContent = 'Saved: ' + SG.backup.describe(SG.backup.summary(data)) + (pass ? ' (encrypted)' : '');
  });
  let restoreFiles = [];
  async function readRestore() {
    const pass = $('restorePass').value;
    const parsed = [];
    for (const f of restoreFiles) {
      try {
        parsed.push(await SG.backup.parse(await f.text(), pass));
      } catch (e) {
        if (e.message === 'passphrase') {
          $('restorePassRow').hidden = false;
          $('restoreSummary').textContent = pass ? 'Wrong passphrase.' : 'These backups are encrypted. Enter the passphrase.';
          return null;
        }
        $('restoreSummary').textContent = `${f.name}: ${e.message}`;
        return null;
      }
    }
    // Full snapshots first (oldest first), then change files in time order.
    parsed.sort((a, b) => (a.kind === 'changes') - (b.kind === 'changes') || a.created - b.created);
    return parsed;
  }
  async function showRestore() {
    $('restoreBox').hidden = false;
    const parsed = await readRestore();
    if (!parsed) return;
    const total = { words: 0, characters: 0, lines: 0, grammar: 0, guides: 0, questions: 0, knownWords: 0 };
    for (const d of parsed) {
      const s = SG.backup.summary(d);
      for (const k of Object.keys(total)) total[k] += d.kind === 'changes' && k === 'knownWords' ? 0 : s[k];
    }
    const newest = new Date(Math.max(...parsed.map((d) => d.created))).toLocaleString();
    $('restoreSummary').textContent = `${parsed.length} file${parsed.length === 1 ? '' : 's'}, newest ${newest}: ${SG.backup.describe(total)}. Nothing changes until you choose below.`;
  }
  $('restoreFiles').addEventListener('change', (e) => {
    restoreFiles = Array.from(e.target.files || []);
    if (restoreFiles.length) showRestore();
  });
  $('restorePass').addEventListener('change', showRestore);
  async function doRestore(mode) {
    const parsed = await readRestore();
    if (!parsed) return;
    if (mode === 'replace' && !confirm('Replace everything in Langtitles with this backup? (Your API keys are kept if the backup has none.)')) return;
    for (let i = 0; i < parsed.length; i++) await SG.backup.restore(parsed[i], i === 0 ? mode : 'merge');
    await browser.runtime.sendMessage({ type: 'restored' });
    settings = await SG.loadSettings();
    fill();
    $('restoreSummary').textContent = 'Restored. Reload any open video tabs to see it there.';
  }
  $('restoreMerge').addEventListener('click', () => doRestore('merge'));
  $('restoreReplace').addEventListener('click', () => doRestore('replace'));

  function renderHosts() {
    const ul = $('disabledHosts');
    ul.textContent = '';
    const hosts = settings.disabledHosts || [];
    if (!hosts.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'None';
      ul.append(li);
    }
    for (const host of hosts) {
      const li = document.createElement('li');
      li.textContent = host;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Turn on';
      btn.addEventListener('click', () => save({ disabledHosts: hosts.filter((x) => x !== host) }));
      li.append(btn);
      ul.append(li);
    }
  }

  $('testKey').addEventListener('click', async () => {
    const out = $('testResult');
    // Save first so the test uses what is in the box.
    await save({ apiKey: $('apiKey').value.trim(), baseURL: $('baseURL').value.trim(), model: modelSel.value });
    out.className = 'note';
    out.textContent = 'Testing…';
    const res = await browser.runtime.sendMessage({ type: 'testKey' });
    out.className = 'note ' + (res.ok ? 'ok' : 'bad');
    out.textContent = res.ok ? `Works (${res.model}).` : res.error;
  });

  async function renderUsage() {
    const status = await browser.runtime.sendMessage({ type: 'status', tabId: -1 });
    const usage = status.usage || {};
    const box = $('usage');
    box.textContent = '';
    const ids = Object.keys(usage);
    if (!ids.length) {
      box.textContent = 'No requests yet.';
      return;
    }
    const table = document.createElement('table');
    table.innerHTML = '<tr><th>Model</th><th>Requests</th><th>Input tokens</th><th>Output tokens</th><th>Estimate</th></tr>';
    let total = 0;
    for (const id of ids) {
      const u = usage[id];
      const m = SG.MODELS.find((x) => id.startsWith(x.id)) || { name: id, inPrice: 0, outPrice: 0 };
      const cost = (u.input * m.inPrice + u.cacheRead * m.inPrice * 0.1 + u.output * m.outPrice) / 1e6;
      total += cost;
      const tr = document.createElement('tr');
      for (const v of [m.name, u.requests, (u.input + u.cacheRead).toLocaleString(), u.output.toLocaleString(), '$' + cost.toFixed(2)]) {
        const td = document.createElement('td');
        td.textContent = String(v);
        tr.append(td);
      }
      table.append(tr);
    }
    box.append(table);
    const p = document.createElement('p');
    p.textContent = `Estimated total: $${total.toFixed(2)}`;
    box.append(p);
  }

  $('resetUsage').addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'resetUsage' });
    renderUsage();
  });
  $('clearCache').addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'clearCache' });
    $('cacheResult').textContent = 'Cleared.';
  });

  fill();
  renderUsage();
})();
