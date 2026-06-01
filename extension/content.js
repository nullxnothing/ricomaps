/**
 * RicoMaps content script for axiom.trade.
 *
 * Detects the token mint from the URL (the only stable signal — axiom's DOM changes
 * often) and renders the RicoMaps bubble map inline via an iframe to
 * https://ricomaps.fun/embed?address=<MINT>&compact=1.
 *
 * Placement: tries to overlay axiom's on-chart bubble region; if that target can't be
 * found it falls back to a floating, draggable, collapsible panel so the extension
 * never silently fails. Mint is re-detected on SPA route changes.
 */
(() => {
  'use strict';

  const EMBED_ORIGIN = 'https://ricomaps.fun';
  const PANEL_ID = 'ricomaps-panel';
  const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const ROUTE_DEBOUNCE_MS = 300;

  let enabled = true;
  let currentMint = null;
  let routeTimer = null;

  // ── Mint detection ────────────────────────────────────────────────────────
  // axiom token pages are /meme/<MINT> (also tolerate other single-segment routes
  // whose segment is a valid base58 mint, e.g. future /token/<MINT>).
  function detectMint() {
    const segments = location.pathname.split('/').filter(Boolean);
    for (const seg of segments) {
      if (BASE58_MINT.test(seg)) return seg;
    }
    return null;
  }

  // ── Panel build ─────────────────────────────────────────────────────────────
  function buildPanel(mint) {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'rm-panel';

    const header = document.createElement('div');
    header.className = 'rm-header';
    header.innerHTML =
      '<span class="rm-title">RicoMaps</span>' +
      '<span class="rm-actions">' +
      '<button class="rm-btn rm-min" title="Minimize">–</button>' +
      '<button class="rm-btn rm-pop" title="Open in RicoMaps">↗</button>' +
      '<button class="rm-btn rm-close" title="Hide">×</button>' +
      '</span>';

    const body = document.createElement('div');
    body.className = 'rm-body';
    const iframe = document.createElement('iframe');
    iframe.className = 'rm-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    iframe.src = `${EMBED_ORIGIN}/embed?address=${encodeURIComponent(mint)}&compact=1`;
    body.appendChild(iframe);

    const grip = document.createElement('div');
    grip.className = 'rm-resize';
    grip.title = 'Drag to resize';

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(grip);

    // Header actions
    header.querySelector('.rm-min').addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('rm-collapsed');
      chrome.storage?.local.set({ rmCollapsed: panel.classList.contains('rm-collapsed') });
    });
    header.querySelector('.rm-pop').addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(`${EMBED_ORIGIN}/?address=${encodeURIComponent(currentMint)}`, '_blank', 'noopener');
    });
    header.querySelector('.rm-close').addEventListener('click', (e) => {
      e.stopPropagation();
      removePanel();
    });

    return { panel, iframe, header };
  }

  function makeDraggable(panel, handle, iframe) {
    let sx = 0, sy = 0, ox = 0, oy = 0, lx = 0, ly = 0, dragging = false, frame = null;

    const apply = () => {
      frame = null;
      if (!dragging) return;
      panel.style.left = `${Math.max(0, ox + lx - sx)}px`;
      panel.style.top = `${Math.max(0, oy + ly - sy)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.rm-btn')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect();
      ox = r.left; oy = r.top;
      // Shield the iframe so it doesn't swallow mousemove while the cursor crosses it.
      iframe.style.pointerEvents = 'none';
      document.body.style.userSelect = 'none';
      panel.classList.add('rm-dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      lx = e.clientX; ly = e.clientY;
      if (frame === null) frame = requestAnimationFrame(apply);
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      iframe.style.pointerEvents = '';
      document.body.style.userSelect = '';
      panel.classList.remove('rm-dragging');
      chrome.storage?.local.set({ rmPos: { left: panel.style.left, top: panel.style.top } });
    });
  }

  // Custom bottom-right resize grip. Done in JS (not CSS `resize`) so we can disable the
  // iframe's pointer events mid-drag — otherwise the iframe swallows the mouse and the
  // resize stalls. Persists the final size across tokens.
  function makeResizable(panel, grip, iframe) {
    let sx = 0, sy = 0, ow = 0, oh = 0, lx = 0, ly = 0, resizing = false, frame = null;

    const apply = () => {
      frame = null;
      if (!resizing) return;
      panel.style.width = `${Math.max(240, ow + lx - sx)}px`;
      panel.style.height = `${Math.max(200, oh + ly - sy)}px`;
    };

    grip.addEventListener('mousedown', (e) => {
      resizing = true;
      sx = e.clientX; sy = e.clientY;
      ow = panel.offsetWidth; oh = panel.offsetHeight;
      iframe.style.pointerEvents = 'none';
      document.body.style.userSelect = 'none';
      panel.classList.add('rm-resizing');
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      lx = e.clientX; ly = e.clientY;
      if (frame === null) frame = requestAnimationFrame(apply);
    });
    window.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      iframe.style.pointerEvents = '';
      document.body.style.userSelect = '';
      panel.classList.remove('rm-resizing');
      chrome.storage?.local.set({ rmSize: { width: panel.style.width, height: panel.style.height } });
    });
  }

  // ── Mount / update ──────────────────────────────────────────────────────────
  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function mountPanel(mint) {
    if (!enabled) return;

    // Already mounted → just point the iframe at the new mint.
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      const iframe = existing.querySelector('.rm-iframe');
      if (iframe) iframe.src = `${EMBED_ORIGIN}/embed?address=${encodeURIComponent(mint)}&compact=1`;
      return;
    }

    const { panel, header, iframe } = buildPanel(mint);

    // Floating, draggable, resizable panel — does not fight axiom's layout.
    panel.classList.add('rm-floating');
    document.body.appendChild(panel);
    makeDraggable(panel, header, iframe);
    makeResizable(panel, panel.querySelector('.rm-resize'), iframe);

    // Restore saved position + size.
    chrome.storage?.local.get(['rmPos', 'rmSize', 'rmCollapsed'], (s) => {
      if (s.rmPos?.left) {
        panel.style.left = s.rmPos.left;
        panel.style.top = s.rmPos.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
      if (s.rmSize?.width) {
        panel.style.width = s.rmSize.width;
        panel.style.height = s.rmSize.height;
      }
      if (s.rmCollapsed) panel.classList.add('rm-collapsed');
    });
  }

  // ── Route handling ────────────────────────────────────────────────────────
  function sync() {
    if (!enabled) { removePanel(); return; }
    const mint = detectMint();
    if (mint === currentMint) return;
    currentMint = mint;
    if (mint) mountPanel(mint);
    else removePanel(); // left a token page
  }

  function scheduleSync() {
    clearTimeout(routeTimer);
    routeTimer = setTimeout(sync, ROUTE_DEBOUNCE_MS);
  }

  // Patch the History API so SPA navigations trigger a re-detect.
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...args) {
      const r = orig.apply(this, args);
      scheduleSync();
      return r;
    };
  }
  window.addEventListener('popstate', scheduleSync);

  // Backstop: axiom may swap routes without History calls we can see.
  const mo = new MutationObserver(() => {
    if (detectMint() !== currentMint) scheduleSync();
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // React to the popup on/off toggle.
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'rmEnabled' in changes) {
      enabled = changes.rmEnabled.newValue !== false;
      currentMint = null; // force re-mount/remove
      sync();
    }
  });

  // Init
  chrome.storage?.local.get(['rmEnabled'], (s) => {
    enabled = s.rmEnabled !== false; // default ON
    sync();
  });
})();
