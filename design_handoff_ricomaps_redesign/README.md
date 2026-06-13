# Handoff: RicoMaps — Bubble-Map Redesign (Token Map + Atlas)

## Overview
RicoMaps is a Solana forensic-intelligence tool. A user pastes a token (or wallet) address and gets a **bubble-map graph** of its holders, the wallets that funded them, and a risk ("rug") verdict. This handoff covers a cleaner redesign of two full-screen app views:

1. **Token Map** — analyze a single token: identity + market data (left rail), an interactive force-directed bubble graph of holders/funders/bundles (center), and a risk verdict + holder analysis (right rail).
2. **Atlas** — a live map of every active "cabal/crew" operating across pump.fun: crew clusters (center), live stats (left HUD), a Most-Wanted leaderboard (right rail), and a live event ticker.

The two views share one top bar with a segmented **Token Map / Atlas** switcher and a search field.

## About the Design Files
The file in this bundle (`RicoMaps.dc.html`) is a **design reference created in HTML/Canvas** — a working prototype showing the intended look, layout, and interaction behavior. **It is not production code to copy directly.** The task is to **recreate this design in the target codebase's existing environment.** The original product is **Next.js + React + Tailwind v4** (CSS custom properties + utility classes), with the graph rendered via a `BubbleMap` React component. Recreate using those established patterns:
- Rails, cards, badges, dock → React components styled with the existing Tailwind tokens (see `globals.css` in the original repo; the token names are reproduced under **Design Tokens** below).
- The graph itself → a `<canvas>` force-directed renderer (the prototype hand-rolls a small force sim; in production you may keep the existing sim or use `d3-force` / the existing `BubbleMap`). The prototype's physics, colors, and interactions below are the spec.

> The prototype uses one `<canvas>` for the graph because DOM nodes don't scale to the physics/zoom/hover needs at ~40–90 nodes. Keep it canvas-based.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, shadows, copy, and interactions are all specified. Recreate the chrome (rails/cards/dock) pixel-accurately with the existing design system; recreate the canvas graph to match the described visual treatment and physics.

---

## Global Layout & Shell
- Full-viewport app: `100vw × 100vh`, `overflow:hidden`, `display:flex; flex-direction:column`. Page background `#050508`.
- **Top bar** (height **58px**, `flex-shrink:0`, bg `#09090e`, bottom border `1px solid #1c1c28`, z-index 30):
  - Left group: back button (36×36, bg `#0d0d14`, border `#1c1c28`, radius 9, icon `#8a8a8a`); brand mark (30×30 rounded-9 radial-green chip with a crosshair SVG in `#00FF41`) + wordmark "RicoMaps" (15px, weight 700, letter-spacing −0.02em).
  - Center: search field, `flex:1; max-width:540px; margin:0 auto`, bg `#0d0d14`, border `#1c1c28`, radius 10, padding `5px 6px 5px 14px`. Contains a search icon, a monospace input (`JetBrains Mono`, 13px, placeholder "Search token or wallet address…"), and a green **Scan** button (gradient `linear-gradient(180deg,#0dff4a,#00d836)`, text `#03100a`, weight 700, radius 7, monospace 12.5px). Scan hover: `filter:brightness(1.08); box-shadow:0 0 18px rgba(0,255,65,0.3)`.
  - Right: segmented control (bg `#0d0d14`, border `#1c1c28`, radius 9, padding 3) with two buttons **Token Map** / **Atlas**. Active tab: `background:rgba(0,255,65,0.12); color:#00FF41`. Inactive: transparent, `color:#8a8a8a`. Plus a 36×36 share icon-button.
- **Body row** below the bar: `flex:1; display:flex` → left rail | center graph | right rail. Rails swap by view.
- The center `<main>` has a faint **technical grid** background: `background-image: linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px); background-size: 58px 58px;` over `#050508`.

---

## Screen 1 — Token Map

### Left rail — Token identity (width **308px**, bg `#09090e`, right border `1px #1c1c28`, padding 16, vertical flex, gap 14, scrollable)
- **Header**: 46×46 rounded-12 avatar (radial green placeholder, monospace "SPCX"), name "SPCX69" (17px/700), symbol "$SPCX69" (12px, monospace, `#8a8a8a`).
- **Authority badges** (flex wrap, gap 6, each radius 5, 10px monospace): `RUG 24` (green: text `#00FF41`, bg `rgba(0,255,65,0.08)`, border `rgba(0,255,65,0.18)`), `No Freeze` (green), `No Mint` (green), `Mutable` (amber: text `#f59e0b`, bg `rgba(245,158,11,0.08)`).
- **Price card** (bg `#0d0d14`, border `#1c1c28`, radius 11, padding 13/14): label "PRICE" (9.5px/700, tracking 0.14em, `#8a8a8a`, monospace); value "$6.09e-4" (21px/700 monospace) + change "+83.7%" (12.5px/700 monospace `#00FF41`).
- **Market grid** (2 columns, gap 8). Each cell: bg `#0d0d14`, border `#1c1c28`, radius 9, padding 10/11; label (9.5px monospace `#8a8a8a`) + value (14px/600 monospace). Cells: MKT CAP `$609.3K`, VOL 24H `$1.47M`, LIQUIDITY `$58.3K`, FDV `$609.3K`.
- **Description**: 11.5px, line-height 1.65, `#8a8a8a`. "$SPCX69 — where Elon's legendary 69 obsession collides with his SpaceX moonshot empire."
- **Contract chip** (button, bg `#0d0d14`, border `#1c1c28`, radius 9, padding 9/11): monospace "SPCXwB…a53N69" + copy icon. Hover: border `#262635`, bg `#14141c`.
- **Socials**: row of four 34×34 icon buttons (website, X, Telegram, chart), bg `#0d0d14`, border `#1c1c28`, radius 8, icon `#8a8a8a`. Hover: bg `#14141c`, icon `#f0f0f0`, border `#262635`.

### Center — Bubble graph (canvas, fills remaining width)
See **Bubble Graph Spec** below. Token-map specifics:
- **Legend** (top-left overlay, glass panel: `bg rgba(9,9,14,0.72)`, `backdrop-filter: blur(14px)`, border `rgba(255,255,255,0.06)`, radius 10, padding 11/13). Rows (9px swatch + 11px `#b8b8b8` label): a 3-dot multi-color swatch → "Bundle · each colour = 1 crew"; green → "Lone holder"; cyan → "Sniper"; gray `#9aa3b2` → "Liquidity pool"; glowing green → "Token". Footnote (9.5px `#5a5a68`): "Bigger node in a clump = the funder wallet".
- **Hint** (top-right, 9.5px uppercase monospace `#5a5a68`): "drag bubbles · scroll to zoom".
- **Node detail panel** (appears on node click; bottom-left, 264px, glass `rgba(9,9,14,0.92)` + blur 20, border `rgba(255,255,255,0.08)`, radius 12, shadow `0 12px 40px rgba(0,0,0,0.55)`, entrance `slideUp 0.2s`): header (colored dot + uppercase type label in the node's color + close ✕); body rows: truncated address (monospace 11px `#8a8a8a`) + "copy"; two stat cells (SUPPLY = node %, FUNDED BY = count); actions "Trace funders" (green outline button: bg `rgba(0,255,65,0.1)`, border `rgba(0,255,65,0.22)`, text `#00FF41`) and "Solscan" (dark button).
- **AI read panel** (toggled from dock; bottom-center, 440px, glass `rgba(9,9,14,0.94)` + blur 22, border `rgba(0,255,65,0.18)`, radius 13): header (sparkle icon + "AI READ OF THIS GRAPH" in `#00FF41`) + 3 paragraphs of plain-language verdict (12.5px, line-height 1.72, `#b8b8b8`, key figures bolded `#f0f0f0`, caveat in `#f59e0b`).
- **Control dock** (bottom-center, single toolbar, glass `rgba(9,9,14,0.86)` + blur 20, border `rgba(255,255,255,0.07)`, radius 13, padding 6, shadow `0 10px 36px rgba(0,0,0,0.5)`, z 18). Buttons left→right, monospace 12px, separated by `1px × 22px` `#1c1c28` dividers:
  - **Go Live** (toggle): dot + label. Inactive: transparent, `#b8b8b8`, dot `#5a5a68`. Active (`isLive`): bg `rgba(0,255,65,0.1)`, border `rgba(0,255,65,0.25)`, text `#00FF41`, dot `#00FF41` glowing + pulsing; label becomes "Live · N".
  - **AI read** (toggles AI panel; sparkle icon).
  - **Heatmap** (toggle render mode), **Clusters** (toggle render mode) — active style same green pill.
  - Zoom −, percentage label (e.g. "31%"), Zoom +, Fit (all 34×34 icon buttons).
  - **PNG**, **CSV** (text buttons; export the canvas image / a holders CSV).
  - All ghost buttons hover: `background:rgba(255,255,255,0.05); color:#f0f0f0`. `white-space:nowrap` on labeled buttons (Go Live / AI read / Heatmap / Clusters) so text never wraps.

### Right rail — Risk (width **336px**, bg `#09090e`, left border `1px #1c1c28`, padding 16, gap 14, scrollable)
- **Risk hero card** (bg `#0d0d14`, border `rgba(0,255,65,0.18)`, radius 14, padding 16, glow `0 0 32px rgba(0,255,65,0.05)`; flex row, gap 16):
  - **Gauge** (104×104): SVG ring, 270° sweep. Track `#1c1c28`, value arc `#00FF41` (filled to score/100, here 24%), `stroke-width 11`, round caps, value arc has `drop-shadow(0 0 6px rgba(0,255,65,0.5))`. Centered: big score "24" (34px/800 monospace `#00FF41`) + "/100" (9px `#8a8a8a`).
  - Verdict text: "LOW RISK" (19px/800 `#00FF41`); "Rug score · low confidence"; "Lower is safer. No critical signals found."
  - *Color logic:* lower score = safer. Green ≤ ~34, amber mid, red high. Verdict word + gauge color follow the band.
- **Signal chips** (3-col grid, gap 8). Each: bg `#0d0d14`, border `#1c1c28`, radius 9, centered; value (16px/700 monospace) + label (8.5px tracking 0.1em `#8a8a8a`): BUNDLED `5.6%`, SNIPED `5.0%`, TOP 10 `6.7%` (all green here since low).
- **Findings** (vertical, gap 9; 7px colored dot + 12px `#b8b8b8` text): green "95% of holders are fresh wallets"; amber "Bundled wallets hold 5.6% of supply"; amber "Snipers hold 5.0% of supply".
- **Medium-risk factor** (button, bg `rgba(245,158,11,0.05)`, border `rgba(245,158,11,0.22)`, radius 10, text `#f59e0b`): warning icon + "MEDIUM RISK" + "1 factor · low supply visibility" + chevron. Hover: bg `rgba(245,158,11,0.1)`.
- **Holder analysis** section (mono section label "HOLDER ANALYSIS" 9.5px tracking 0.14em `#8a8a8a`). Rows (label left in 10.5px monospace `#8a8a8a`, value right 12px/600 monospace), each separated by `1px #15151f`: INSIDERS HOLD `5.6%` (green) · SPREAD `Even (0.07)` (green) · FRESH WALLETS `94.7%` · REAL HOLDERS `19` · SUPPLY COVERED `11.8%` (amber) · HOLDERS `20 / 20` · CLUSTERS `21 (max 2)`.
- **Note card** (bg `#0d0d14`, border `#1c1c28`, radius 9, 10.5px `#8a8a8a`): "Top 19 holders = 11.8% of supply (rest in pool / untracked). Percentages are of total supply held."

---

## Screen 2 — Atlas

### Top bar
Same shell; Atlas tab active.

### Left HUD (width **250px**, bg `#09090e`, right border, padding 16, gap 14)
- Title row: pulsing green dot + "LIVE CABAL MAP" (10px/700 tracking 0.16em `#00FF41`). Subtitle (11.5px `#8a8a8a`): "Every active crew on pump.fun — launches, graduations, coordinated buys, and rugs as they happen."
- **Stat grid** (2-col, gap 8; cards bg `#0d0d14`, border `#1c1c28`, radius 9): ACTIVE CREWS `21`, TOKENS `148`, RUGS TODAY `7` (value `#ef4444`), EXTRACTED `$4.2M` (value `#f59e0b`). Values 20px/700 monospace.
- Hint card (10px monospace `#8a8a8a`): "Crews are fingerprinted across launches by shared funding wallets. Click a crew node to open its dossier."

### Center — Crew graph (canvas)
See **Bubble Graph Spec**; Atlas specifics:
- A faint **noise field** of untracked tokens behind the crews: ~52 static radial-gradient gray circles (`rgba(150,160,180, 0.07–0.18)`), radii 7–45px, scattered on an ellipse (rad 150–710, y-scale 0.82). Decorative; not in physics, drawn behind everything.
- **Crews**: each is a hub node (the crew wallet) + its coordinated token satellites, clumped at a home anchor, all one color. The dense **cabal hub** (red `#ef4444`, 11 satellites) is the visual hero, centered. Other crews: amber `#f59e0b` (5), purple `#a78bfa` (4), cyan `#22d3ee` (4), blue `#60a5fa` (3), green `#34d399` (3). Hub radius 13–21; satellites ~6–10.
- **Live ticker** (bottom-left overlay, 236px, glass `rgba(9,9,14,0.66)` + blur 16, border `rgba(255,255,255,0.06)`, radius 11, max-height 216): header (pulsing dot + "LIVE FEED"); scrolling list (max-height 168) of events, newest on top (cap ~18), each row animates in (`rm-tickin 0.35s`): colored dot + token symbol (monospace 11.5px) + sub-text (10px `#8a8a8a`) + right-aligned uppercase kind tag in the event color. Event kinds & colors: `spawn` blue, `buy` green, `cabal` purple, `grad` amber, `rug` red. New event every ~2.2s.

### Right rail — Most Wanted leaderboard (width **286px**, bg `#09090e`, left border, padding 16, gap 10, scrollable)
- Section label (red `#ef4444`, 9.5px/700 tracking 0.16em + person icon): "MOST WANTED".
- Crew rows (bg `#0d0d14`, border `#1c1c28`, radius 10, padding 11/12; hover border `#262635`, bg `#14141c`): glowing colored dot + crew id (12.5px/700 monospace) + "{tokens} tokens · {supply} held" (10px `#8a8a8a`) + right side: extracted USD (12.5px/700 monospace `#f59e0b`) + "EXTRACTED" (9px `#8a8a8a`). Data:
  - C-7C2A red · 9 tokens · 14.2% · $1.2M
  - C-3F19 amber · 6 · 9.8% · $840K
  - C-B4D0 purple · 5 · 7.1% · $610K
  - C-1E88 cyan · 4 · 5.5% · $430K
  - C-9A2F blue · 3 · 4.0% · $280K
  - C-5C71 green · 3 · 2.6% · $150K

---

## Bubble Graph Spec (shared canvas renderer)

### Node types & rendering
- **Token** (center, Token Map only): radius 30; radial-gradient green fill `rgba(0,255,65,0.55)→0.10`, glow (shadowBlur 14); label "SPCX" in dark `#03100a`.
- **Liquidity pool** (Token Map): radius 46; radial gray fill `rgba(154,163,178,0.30)→0.04`, stroke `rgba(154,163,178,…)`; label "29.9%".
- **Holder**: radius `13 + pct*1.5`; translucent fill in the node color (alpha ~0.14, bold modes ~0.42), stroke at 0.62; white % label when radius > 11.
- **Funder / crew hub / satellite**: solid radial-gradient fill in node color (bright center → 0.78 edge), soft glow (shadowBlur ~6); crew hubs show their id label.
- **Bundled / sniper**: same as holder but colored purple/cyan respectively.

### Color semantics
- **Token Map default mode:** color encodes **bundle identity** (each funded crew = one color: purple/blue/cyan/teal, cabal hub pink `#f472b6`), **size encodes role** (bigger node in a clump = the funder, smaller = funded wallets). Lone (unconnected) holders are green `#00FF41`; snipers cyan `#22d3ee`; pool gray; token green.
- **Heatmap mode:** recolor by risk — bundled red `#ef4444`, sniper/`pct>4.5` amber `#f59e0b`, `pct>3.6` yellow `#facc15`, fresh holders green `#00FF41`, funders blue, pool gray; fills bolder (~0.42 alpha) with glow.
- **Clusters mode:** recolor every node by its connected-component (union-find over funding links) using a rotating palette, and draw a translucent dashed "blob" hull behind each multi-node cluster.

### Connections (animated beams)
- Connections are drawn between a funder and each wallet it funded (Atlas: hub → satellite). Hub-to-token links exist for physics but are **hidden** unless the node is hovered or in cluster mode.
- Each visible link is a **curved beam** (quadratic Bézier, control point offset perpendicular by ±16% of length, sign alternating per link): a brighter base stroke (e.g. `rgba(125,170,235,0.34)` for funder ties, the crew color at ~0.32 alpha for Atlas, green `rgba(0,255,65,0.5)` when an endpoint is hovered) **plus a traveling gradient pulse** (a ~9-segment fading comet that loops along the curve every ~2.6s, with a small glowing head dot) **plus a directional arrowhead** near the target end (filled triangle in the beam color, ~80–90% along the curve).

### Physics (force layout)
- Each node has a **home anchor** = its bundle/crew home position; spread the homes around the field so bundles form separate islands (token at `[0,0]`).
- Per frame: home gravity (`g ≈ 0.022`, token `0.04`) pulls each node to its home; pairwise repulsion (capped at 7; min distance floor 4) — **gentle within a bundle** (same home: factor 22, minD `r+r+8`) and **stronger across bundles** (factor 54, minD `r+r+26`) so islands separate but members stay clumped; link springs (`k=0.02`, rest `r_a + r_b + 16`, crew spokes `+34`); integrate with `0.84` damping and velocity clamped to ±9 (prevents blow-ups on dense hubs). Atlas uses the same physics.
- After build (and 700–900ms after a view switch), auto-`fit`: center on the nodes' bounding box and set zoom to frame them (clamped ≤1.3).

### Interactions
- **Hover** a node → it and every node in its connected group get a glowing accent-green ring (`rgba(0,255,65,0.95)` on the hovered node, `0.6` on connected), their links light up green, and **un-connected nodes dim to 55% opacity** (not lower — readability matters). A small canvas tooltip shows type + truncated address + "% of supply".
- **Click** a node (Token Map) → open the node detail panel. Click empty space → deselect. (A drag is not a click.)
- **Drag a node** → it pins where you drop it (`fixed`, holds its position; the rest of the graph flexes around it). Cursor `grab`/`grabbing`.
- **Drag empty canvas** → pan. **Scroll wheel** → zoom toward the cursor (clamped 0.25–3). Dock has zoom −/＋/fit.
- **Go Live** (Token Map) → spawns periodic expanding pulse rings on random holders and increments the live counter.

---

## Interactions & Behavior Summary
- View switch (Token Map ↔ Atlas): rebuild the graph for that view, reset selection/AI panel, auto-fit, start/stop the Atlas ticker.
- Entrance/loop animations: `slideUp 0.2s` (panels), `rm-tickin 0.35s` (ticker rows), `rm-pulse 2s infinite` (live dots), beam pulse loop ~2.6s.
- Esc (in the production app) closes panels / clears selection.
- Export: PNG = `canvas.toDataURL` download; CSV = holders list download.

## State Management
- `view`: `'token' | 'atlas'`
- `isLive`: boolean (Token Map streaming) + `liveCount`
- `renderMode`: `'default' | 'heatmap' | 'cluster'`
- `selectedNode`: node object | null (drives detail panel)
- `aiOpen`: boolean
- `zoomPct`: number (display)
- `ticker`: array of live events (Atlas)
- Camera (`cam.x/y/scale`) and node positions are imperative (kept off React state; the canvas RAF loop owns them). Only display-affecting values (zoom %, ticker, selection) live in React state.
- Production data fetching: scan endpoint returns token metadata, security, holders, funding edges, rug-score/stats; Atlas polls an `/api/atlas` graph + a live event stream.

## Design Tokens
**Backgrounds:** void `#050508` · base `#09090e` · surface `#0d0d14` · elevated `#111118` · hover `#14141c`
**Borders:** base `#1c1c28` · hover `#262635` · hairline divider `#15151f`
**Text:** primary `#f0f0f0` · secondary `#b8b8b8` · tertiary `#8a8a8a` · faint `#5a5a68`
**Accent green (brand):** `#00FF41` · dim `#00cc33` · ghost `rgba(0,255,65,0.06)` · scan gradient `#0dff4a→#00d836`
**Status / categories:** red `#ef4444` · amber `#f59e0b` · yellow `#facc15` · blue `#60a5fa` · cyan `#22d3ee` · purple `#a78bfa` · teal `#2dd4bf` · pink (cabal) `#f472b6` · pool gray `#9aa3b2` · green-clean `#34d399`
**Radii:** chips/buttons 7–9px · cards 9–11px · panels 12–14px · pills/dots 50%
**Shadows:** card `0 8px 32px rgba(0,0,0,0.5)` · floating dock `0 10px 36px rgba(0,0,0,0.5)` · detail `0 12px 40px rgba(0,0,0,0.55)` · accent glow `0 0 24px rgba(0,255,65,0.12–0.35)`
**Typography:** Sans **Inter** (400–800); Mono **JetBrains Mono** (400–700, used for all numbers, addresses, labels, section headers, status). Section labels: uppercase, tracking 0.14–0.16em. Display/score 800 weight.
**Spacing:** 4/8/12/14/16 base; rails padding 16; card padding 10–16.
**Grid background:** 58px squares, `rgba(255,255,255,0.018)` 1px lines.

## Assets
- Brand mark: an inline SVG crosshair/radar (concentric circle + center dot + 4 ticks) in `#00FF41`. The production app uses `/favicon.png`; substitute the real logo.
- Social glyphs (website/X/Telegram/chart), warning, sparkle, copy, zoom, fit, share, person icons: inline single-color SVG at 1.5–2px stroke, `currentColor`. Use the codebase's existing icon set (or Lucide) for production.
- No raster images required by the design itself.

## Files
- `RicoMaps.dc.html` — the full interactive prototype (top bar, both views, canvas graph, all panels, physics, interactions). Open in a browser to interact: switch views, drag bubbles, hover to highlight crews, toggle Heatmap/Clusters/Go Live, open AI read.
- `support.js` — runtime needed to open the `.dc.html` prototype locally (it is the prototype framework, **not** part of the design to reimplement).

> Original codebase reference files (not included here, for context): `app/page.tsx` (view orchestration), `components/BubbleMap.tsx` (canvas graph), `components/StatsPanel.tsx`, `app/globals.css` (Tailwind tokens). Recreate the redesign within that structure.
