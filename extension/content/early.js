// Runs at document_start, before the page's own scripts, so its listeners are the first on the window.
// Some players (in full screen especially) catch every click on the page at the window and stop it
// there, so clicks never reach Langtitles' subtitles, word card or panel. Here, presses and clicks on
// Langtitles' own elements are taken first: the player never sees them, and Langtitles runs its own
// handlers for them directly. Browser defaults (focusing an input, moving a slider, opening a select)
// still happen, since nothing here cancels them.
(function () {
  'use strict';
  const SG = (globalThis.SG = globalThis.SG || {});
  if (SG.uiEvents) return;

  const KEYS = ['keydown', 'keyup', 'keypress'];
  const TYPES = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend'];
  const handlers = new WeakMap(); // element -> { type: [{ fn, capture }] }
  let root = null;

  function on(el, type, fn, opts) {
    let byType = handlers.get(el);
    if (!byType) handlers.set(el, (byType = {}));
    (byType[type] = byType[type] || []).push({ fn, capture: opts === true || Boolean(opts && opts.capture) });
  }

  // Runs the handlers registered on the event's path, as the browser would: capture from the root
  // down, then the target, then bubbling back up. A handler's stopPropagation stops the walk.
  function run(e, path) {
    let halted = false;
    let haltedNow = false;
    const ev = e;
    try {
      Object.defineProperty(ev, 'stopPropagation', { configurable: true, value: () => { halted = true; } });
      Object.defineProperty(ev, 'stopImmediatePropagation', { configurable: true, value: () => { halted = true; haltedNow = true; } });
    } catch (err) {
      /* events are extensible; nothing to do otherwise */
    }
    const inside = path.slice(0, path.indexOf(root) + 1); // target … root
    const call = (node, wantCapture) => {
      const list = (handlers.get(node) || {})[e.type];
      if (!list) return;
      for (const h of list.slice()) {
        if (h.capture !== wantCapture && node !== inside[0]) continue;
        try {
          h.fn.call(node, ev);
        } catch (err) {
          console.error('Langtitles:', err);
        }
        if (haltedNow) return;
      }
    };
    for (let i = inside.length - 1; i >= 0 && !halted; i--) call(inside[i], true);
    for (let i = 0; i < inside.length && !halted; i++) {
      if (i === 0) continue; // the target ran in the capture walk (both phases)
      call(inside[i], false);
    }
  }

  for (const type of TYPES) {
    window.addEventListener(
      type,
      (e) => {
        if (!root || !root.isConnected) return;
        const path = e.composedPath();
        if (!path.includes(root)) return;
        e.stopImmediatePropagation();
        run(e, path);
      },
      { capture: true, passive: false },
    );
  }

  // Typing in Langtitles' own boxes (Ask, search) must not reach the player's keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(
      type,
      (e) => {
        if (!root || !root.isConnected) return;
        const path = e.composedPath();
        const t = path[0];
        if (!path.includes(root) || !t || !(t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.stopImmediatePropagation();
        run(e, path);
      },
      true,
    );
  }

  SG.uiEvents = {
    TYPES: TYPES.concat(KEYS),
    off(el, type, fn) {
      const list = (handlers.get(el) || {})[type];
      if (list) {
        const i = list.findIndex((h) => h.fn === fn);
        if (i >= 0) list.splice(i, 1);
      }
    },
    on,
    setRoot(el) {
      root = el;
    },
  };
})();
