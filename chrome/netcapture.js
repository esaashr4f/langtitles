// Chrome build only. Runs in the page itself (content script world MAIN, at document_start), because
// Chrome doesn't let extensions read response bodies. When the page's video player fetches something
// that looks like a subtitle file or an HLS playlist, a copy of the text is posted to Langtitles'
// content script (chrome/netbridge.js), which passes it to the background. The page's own requests and
// responses are not changed.
(function () {
  'use strict';
  if (window.__langtitlesNet) return;
  window.__langtitlesNet = true;

  const MAX = 6 * 1024 * 1024;
  const SUB_EXT = /\.(vtt|webvtt|srt|ass|ssa|ttml|ttml2|dfxp|sbv|m3u8)$/i;
  const SUB_TYPE = /text\/vtt|x-subrip|ttml|x-ssa|x-ass|text\/srt|mpegurl/i;
  const SUB_WORD = /subtitle|caption|timedtext|\/subs?\//i;

  function looksLikeSubs(url, type) {
    try {
      const u = new URL(url, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      return SUB_EXT.test(u.pathname) || SUB_TYPE.test(type || '') || SUB_WORD.test(u.pathname + u.search);
    } catch (e) {
      return false;
    }
  }

  function pass(url, type, text) {
    if (typeof text !== 'string' || !text || text.length > MAX) return;
    window.postMessage({ langtitlesNet: 1, url: String(url), contentType: type || '', text }, '*');
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    const wrapped = function () {
      const p = nativeFetch.apply(this, arguments);
      p.then((res) => {
        try {
          if (!res || !res.ok) return;
          const type = res.headers.get('content-type') || '';
          if (!looksLikeSubs(res.url, type)) return;
          if (Number(res.headers.get('content-length')) > MAX) return;
          res.clone().text().then((t) => pass(res.url, type, t), () => {});
        } catch (e) {
          /* never disturb the page */
        }
      }, () => {});
      return p;
    };
    try {
      Object.defineProperty(wrapped, 'name', { value: 'fetch' });
      wrapped.toString = () => nativeFetch.toString();
    } catch (e) {
      /* cosmetic */
    }
    window.fetch = wrapped;
  }

  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const nativeSend = XHR.send;
    XHR.send = function () {
      try {
        this.addEventListener('load', function () {
          try {
            if (this.status !== 200) return;
            const url = this.responseURL;
            const type = this.getResponseHeader('content-type') || '';
            if (!looksLikeSubs(url, type)) return;
            const r = this.responseType;
            if (r === '' || r === 'text') pass(url, type, this.responseText);
            else if (r === 'arraybuffer' && this.response && this.response.byteLength <= MAX) pass(url, type, new TextDecoder().decode(this.response));
            else if (r === 'json' && this.response != null) pass(url, type, JSON.stringify(this.response));
            else if (r === 'blob' && this.response && this.response.size <= MAX) this.response.text().then((t) => pass(url, type, t), () => {});
          } catch (e) {
            /* never disturb the page */
          }
        });
      } catch (e) {
        /* never disturb the page */
      }
      return nativeSend.apply(this, arguments);
    };
  }
})();
