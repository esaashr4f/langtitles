// Chrome build only. Content script (Langtitles' own world) at document_start: takes the subtitle files
// chrome/netcapture.js saw in the page and hands them to the background (background/sniffer.js ingest).
(function () {
  'use strict';
  if (globalThis.__langtitlesBridge) return;
  globalThis.__langtitlesBridge = true;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.langtitlesNet !== 1 || typeof d.text !== 'string') return;
    browser.runtime.sendMessage({ type: 'netSub', url: d.url, contentType: d.contentType, text: d.text }).catch(() => {});
  });
})();
