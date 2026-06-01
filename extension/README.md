# RicoMaps — Axiom Extension

Chrome (MV3) extension that detects the token mint on `axiom.trade` chart pages and renders the
RicoMaps holder/cabal bubble map inline, via an iframe to `https://ricomaps.fun/embed`.

It's a thin shell: the mint is read from the URL (`/meme/<MINT>`), and the live `/embed` page does
all the rendering (no graph code, no API keys in the extension).

## Install (dev, load unpacked)
1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Open a token page, e.g. `https://axiom.trade/meme/<MINT>?chain=sol`. A floating RicoMaps panel
   appears (top-right by default). Drag it by the header; resize from the bottom-right grip;
   minimize/close from the header. Position + size persist across tokens.
4. Toggle on/off via the extension popup.

## How it works
- `content.js` — reads the mint from `location.pathname`; watches SPA route changes
  (History API patch + MutationObserver) and updates the iframe `src` on navigation. Renders a
  floating, draggable, resizable panel (doesn't touch axiom's layout). State saved in
  `chrome.storage.local` (`rmPos`, `rmSize`, `rmCollapsed`, `rmEnabled`).
- `panel.css` — all classes prefixed `rm-` and scoped to `#ricomaps-panel` (no style bleed).
- `popup.html/js` — on/off switch (`rmEnabled`, default ON).
- `background.js` — sets the default enabled flag on install.

## Packaging for the Web Store (later)
- Replace `icons/*` with properly sized 16/48/128 PNGs (currently the favicon copied to each).
- Zip the `extension/` folder contents and submit. No build step required.
