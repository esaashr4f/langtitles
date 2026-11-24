// Chrome build only (scripts/build-chrome.mjs adds it after browser-polyfill.js everywhere: the
// background service worker, content scripts and extension pages). Fills the gaps between Firefox's
// WebExtension APIs, which Langtitles is written for, and Chrome's Manifest V3.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});
  SG.isChrome = true;
  const b = root.browser;

  // Same features, different names.
  if (b && !b.menus && b.contextMenus) b.menus = b.contextMenus;
  if (b && !b.browserAction && b.action) b.browserAction = b.action;

  // The background is a service worker in Chrome. It can be stopped when idle, so long timers
  // (backups, sync, batch polling) run on chrome.alarms, which survive that. Each start of the worker
  // registers the same intervals in the same order, so the alarm names line up again.
  const inWorker = typeof ServiceWorkerGlobalScope !== 'undefined' && root instanceof ServiceWorkerGlobalScope;
  if (inWorker && root.chrome && chrome.alarms) {
    const nativeSetInterval = root.setInterval.bind(root);
    const nativeClearInterval = root.clearInterval.bind(root);
    const jobs = new Map();
    let n = 0;
    root.setInterval = function (fn, ms, ...args) {
      if (!(ms >= 60000) || typeof fn !== 'function') return nativeSetInterval(fn, ms, ...args);
      const name = 'lt-every-' + n++;
      const minutes = ms / 60000;
      jobs.set(name, () => fn(...args));
      chrome.alarms.get(name).then((a) => {
        if (!a || a.periodInMinutes !== minutes) chrome.alarms.create(name, { periodInMinutes: minutes, delayInMinutes: minutes });
      });
      return name;
    };
    root.clearInterval = function (id) {
      if (typeof id === 'string' && jobs.has(id)) {
        jobs.delete(id);
        chrome.alarms.clear(id);
      } else nativeClearInterval(id);
    };
    // Must be registered while the worker starts, so a waking alarm finds it.
    chrome.alarms.onAlarm.addListener((a) => {
      const job = jobs.get(a.name);
      if (job) job();
    });
    // Firefox's runtime.onStartup also fires here, but Chrome only runs the listeners added while the
    // worker starts, which Langtitles does. Nothing else to do.
  }

  // Extension pages (library, word bank, review, options…) keep the background awake while they're
  // open, so a long lesson or guide being written isn't cut off.
  if (!inWorker && root.location && root.location.protocol === 'chrome-extension:' && b) {
    setInterval(() => b.runtime.sendMessage({ type: 'ltPing' }).catch(() => {}), 25000);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
