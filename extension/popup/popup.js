(async function () {
  'use strict';
  const SG = globalThis.SG;
  const $ = (id) => document.getElementById(id);
  let tab = { id: -1, url: '' };
  try {
    tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0] || tab;
  } catch (e) {
    /* still show the switches */
  }
  let host = '';
  try {
    host = new URL(tab.url).hostname;
  } catch (e) {
    /* about: pages */
  }
  let settings = await SG.loadSettings();

  const modelSel = $('model');
  for (const m of SG.MODELS) modelSel.append(new Option(m.name, m.id));
  const lineSel = $('lineModel');
  for (const m of SG.MODELS) lineSel.append(new Option(m.name, m.id));
  lineSel.addEventListener('change', () => save({ lineModel: lineSel.value }));

  function fillAnnotations() {
    const box = $('annotations');
    box.textContent = '';
    for (const a of SG.ANNOTATIONS) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.title = a.title + ' (click to switch on or off)';
      b.className = settings[a.key] ? 'on' : '';
      b.addEventListener('click', () => save({ [a.key]: !settings[a.key] }));
      box.append(b);
    }
  }

  function fillClasses() {
    const box = $('classes');
    box.textContent = '';
    const on = new Set(settings.glossClasses || []);
    for (const k of SG.WORD_CLASSES) {
      const b = document.createElement('button');
      b.textContent = k.label;
      b.title = k.title + ' (click to switch on or off)';
      b.className = on.has(k.key) ? 'on' : '';
      b.addEventListener('click', () => {
        if (on.has(k.key)) on.delete(k.key);
        else on.add(k.key);
        save({ glossClasses: SG.WORD_CLASSES.map((x) => x.key).filter((x) => on.has(x)) });
      });
      box.append(b);
    }
  }

  function fillJlpt() {
    const box = $('jlpt');
    box.textContent = '';
    for (const c of SG.JLPT_CHOICES) {
      const b = document.createElement('button');
      b.textContent = c.label;
      b.title = c.title;
      b.className = 'radio' + ((settings.jlptFrom || 5) === c.value ? ' on' : '');
      b.addEventListener('click', () => save({ jlptFrom: c.value }));
      box.append(b);
    }
  }

  function fill() {
    fillAnnotations();
    fillClasses();
    fillJlpt();
    $('enabled').checked = settings.enabled;
    $('host').textContent = host || 'This page';
    $('siteEnabled').checked = !(settings.disabledHosts || []).includes(host);
    $('siteEnabled').disabled = !host || !settings.enabled;
    modelSel.value = settings.model;
    lineSel.value = settings.lineModel || settings.model;
  }

  async function save(patch) {
    settings = await SG.saveSettings(patch);
    fill();
  }

  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
  $('siteEnabled').addEventListener('change', (e) => {
    const list = (settings.disabledHosts || []).filter((x) => x !== host);
    if (!e.target.checked) list.push(host);
    save({ disabledHosts: list });
  });
  modelSel.addEventListener('change', () => save({ model: modelSel.value }));
  for (const id of ['openOptions', 'openOptions2']) {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      browser.runtime.openOptionsPage();
      window.close();
    });
  }

  $('openProgress').addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.create({ url: browser.runtime.getURL('progress/progress.html') });
    window.close();
  });
  browser.runtime.sendMessage({ type: 'seasonJobs' }).then((r) => {
    const live = (r && r.jobs ? r.jobs : []).find((j) => j.status === 'processing' || j.status === 'downloading');
    if (live) $('season').textContent = `Preparing ${live.show}, episodes ${live.from}–${live.to}: ${live.status}`;
  });

  $('openReview').addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.create({ url: browser.runtime.getURL('review/review.html') });
    window.close();
  });
  (async () => {
    const items = await Promise.race([SG.cache.getAll('bank'), new Promise((r) => setTimeout(() => r([]), 1500))]);
    const log = (await browser.storage.local.get('reviewLog')).reviewLog || {};
    const newDone = log.day === SG.srs.dayKey(Date.now()) ? log.newDone || 0 : 0;
    const c = SG.srs.counts(items, Date.now(), (settings.newPerDay || 20) - newDone);
    if (c.total) $('openReview').textContent = `Review (${c.total})`;
  })();

  $('openBank').addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.create({ url: browser.runtime.getURL('bank/bank.html') });
    window.close();
  });

  $('openLibrary').addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.create({ url: browser.runtime.getURL('grammar/grammar.html') });
    window.close();
  });

  $('openQuestions').addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.create({ url: browser.runtime.getURL('questions/questions.html') });
    window.close();
  });

  async function refresh() {
    try {
      await refreshInner();
    } catch (e) {
      $('state').textContent = 'Could not read this tab’s status. The switches above still work.';
    }
  }

  async function refreshInner() {
    const s = await browser.runtime.sendMessage({ type: 'status', tabId: tab.id });
    $('keyWarning').hidden = s.hasKey;
    const st = s.state;
    const ul = $('tracks');
    ul.textContent = '';
    if (st && st.track) {
      const t = st.track;
      const pct = t.lines ? Math.round((t.ready / t.lines) * 100) : 0;
      $('state').textContent = `${SG.lang.langName(t.lang)}: ${t.ready} of ${t.lines} lines ready (${pct}%).`;
    } else if (s.tracks.length) {
      $('state').textContent = 'Subtitles found, none in a language you are learning yet.';
    } else {
      $('state').textContent = 'No subtitles found yet. Turn them on in the player.';
    }
    for (const t of s.tracks) {
      const li = document.createElement('li');
      li.textContent = `${SG.lang.langName(t.lang)} · ${t.lines} lines`;
      li.title = t.url;
      ul.append(li);
    }
    if (st && st.cost != null) $('state').textContent += ` This episode: about $${Number(st.cost).toFixed(2)}.`;
    if (st && (st.episode || st.subSearch)) {
      const line = [st.episode ? `Episode: ${st.episode}` : '', st.subSearch ? `Subtitle sites: ${st.subSearch}` : ''].filter(Boolean).join(' · ');
      $('state').textContent += ' ' + line;
    }
    const err = (st && st.error) || s.lastError;
    $('error').hidden = !err;
    $('error').textContent = err ? err.message : '';
    let total = 0;
    for (const [id, u] of Object.entries(s.usage || {})) {
      const m = SG.MODELS.find((x) => id.startsWith(x.id));
      if (m) total += (u.input * m.inPrice + u.cacheRead * m.inPrice * 0.1 + u.output * m.outPrice) / 1e6;
    }
    const month = await browser.runtime.sendMessage({ type: 'spend' });
    const cap = Number(settings.monthlyCap) || 0;
    $('spend').textContent = `This month: about $${(month ? month.spent : 0).toFixed(2)}${cap ? ` of your $${cap} cap` : ''} · all time: $${total.toFixed(2)}`;
  }

  fill();
  refresh();
  setInterval(refresh, 1500);
})();
