// Scene frames on Langtitles' own pages: a small picture of the moment a line, word or question was saved.
(function (root) {
  'use strict';
  const SG = (root.SG = root.SG || {});
  SG.frameImg = function (id, cls) {
    const img = document.createElement('img');
    img.className = cls || 'scene';
    img.alt = 'The scene';
    img.hidden = true;
    img.loading = 'lazy';
    if (id && SG.cache) {
      SG.cache.getMany('frames', [id]).then((m) => {
        const f = m.get(id);
        if (f && f.data) {
          img.src = f.data;
          img.hidden = false;
        }
      }, () => {});
    }
    return img;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
