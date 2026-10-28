# Inkscape Web: high-level plan

Goal: a vector drawing web app that matches Inkscape as closely as
technically possible. We skip a feature only when the browser platform cannot
reproduce it (see section 7). The C++ source at `~/dev/inkscape` (branch
`master`, upstream `gitlab.com/inkscape/inkscape`) is the reference. We keep the port in sync with upstream for years. Every
decision below is made for **maintainability** and **ease of syncing upstream
changes**.

## 1. Guiding rules

1. **Mirror upstream structure.** Our modules and file names follow upstream
   (`src/object/sp-rect.cpp` → `packages/core/src/object/sp-rect.ts`). When
   an upstream commit changes a file, the matching TS file is easy to find.
2. **Mirror upstream concepts, not GTK.** Port the model, the tools and the
   actions with the same names and the same behavior. Write the UI new, for the web.
3. **Reuse upstream data directly.** Icons, keyboard maps (`share/keys`),
   palettes, markers, symbols, filters, templates, preference keys and
   translations (`po/`) come from the upstream checkout at build time. We do
   not copy them by hand.
4. **Keep the same identifiers.** Use the same action ids (`app.*`, `win.*`,
   `doc.*`), preference paths (`/tools/shapes/rect/...`) and translatable
   strings (msgids). Then upstream shortcuts and translations work without
   changes.
5. **Keep the core headless.** The document model runs in Node, without a
   DOM or React. All core tests run fast in Vitest.
6. **Use WASM only for heavy algorithms that are hard to port.** Compile them
   from upstream C++ with Emscripten (livarot booleans and offsets, potrace).
   A rebuild then gets upstream fixes for free.
7. **Parity by default.** Every upstream tool, action, dialog, LPE, filter
   preset, extension and file format is in scope. A feature is skipped only
   when it is listed in `docs/SKIPPED.md` with a technical reason.
8. **Rendering stays in the browser engines.** We draw with SVG, CSS,
   Canvas 2D and WebGL/WebGPU. We do not ship our own screen rasterizer
   (for example Cairo in WASM). Where Chromium's SVG output differs from
   Inkscape in a visible way, we first convert to SVG that Chromium renders
   correctly. If that is not possible, we draw the feature with Canvas/WebGL.
   Small anti-aliasing differences are accepted.

## 2. Tech stack (decided after spikes, see `SPIKES.md`)

| Concern                   | Choice                                                                                                                       | Reason                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language                  | TypeScript, `strict`                                                                                                         | Type safety for a large codebase                                                                                                                    |
| Package manager           | pnpm workspaces                                                                                                              | Package boundaries enforce layering                                                                                                                 |
| Build/dev                 | Vite                                                                                                                         | Standard, fast, simple config                                                                                                                       |
| UI framework              | React 19                                                                                                                     | Largest ecosystem, long-term stability, many contributors know it                                                                                   |
| Docking panels            | dockview                                                                                                                     | Inkscape-style dockable dialogs, no other dependencies                                                                                              |
| UI primitives             | Radix UI (headless) + CSS modules                                                                                            | Accessible menus/popovers/sliders; we own the styling                                                                                               |
| UI state                  | Upstream-style observers in the core + `useSyncExternalStore`                                                                | No state library; no 2nd source of truth beside the document                                                                                        |
| Drawing render            | Browser SVG DOM in a shadow root, built from a **display tree** that our object layer generates (not a copy of the file XML) | Chromium draws shapes, gradients, markers, clips and filters correctly. Inkscape-only/SVG2 features and LPE output get converted to plain SVG first |
| Controls overlay          | Separate SVG/Canvas layer (port of `src/display/control/*`)                                                                  | Handles, rubberband, guides and grids stay out of the document                                                                                      |
| Geometry                  | TS port of the used 2geom subset (Point, Affine, Rect, Path, Bezier)                                                         | Small, hot code; no WASM call cost for each operation                                                                                               |
| Heavy geometry            | Upstream lib2geom + livarot + `path/*` → WASM (Emscripten, pinned emsdk), unchanged sources + small shims                    | Spike: 12/12 boolean ops identical to Inkscape, 224 KB gzip                                                                                         |
| Tracing                   | potrace → WASM                                                                                                               | Same reason                                                                                                                                         |
| Text layout               | Port of `libnrtype/Layout-TNG*` on HarfBuzz (WASM); output is positioned glyphs                                              | Chromium text layout differs from Inkscape and has no SVG2 flowed text                                                                              |
| Python extensions (later) | Pyodide                                                                                                                      | Runs `share/extensions` without changes                                                                                                             |
| i18n                      | Small `_()` / `C_()` / `N_()` helpers on upstream `.po` files                                                                | Same msgids as upstream; translations come free                                                                                                     |
| Files                     | File System Access API, download fallback; IndexedDB autosave                                                                | Mirrors `file.cpp` / `auto-save.cpp`                                                                                                                |
| Unit tests                | Vitest                                                                                                                       | Fast, Vite-native                                                                                                                                   |
| E2E + visual              | Playwright                                                                                                                   | Compare our renders with `testfiles/rendering_tests/expected_rendering`                                                                             |
| XML parsing               | Small SAX parser (e.g. `saxes`)                                                                                              | The core must run without a DOM (Node tests, workers)                                                                                               |
| Lint/format               | Biome                                                                                                                        | One fast tool, little config                                                                                                                        |
| Offline                   | PWA (vite-plugin-pwa), later                                                                                                 | Desktop-like use                                                                                                                                    |

Browser target: current Chromium only.

## 3. Project structure

```
inkscape-web/
├─ packages/
│  ├─ geom/        TS port of the needed lib2geom subset. No dependencies.
│  ├─ core/        Headless. Mirrors upstream: xml/, object/, svg/, path/,
│  │               colors/, style, document, document-undo, selection model,
│  │               preferences. No DOM, no React.
│  ├─ editor/      Desktop + canvas. Mirrors upstream: desktop, display/
│  │               (canvas items, drawing ↔ SVG DOM), ui/tools/ (tool logic),
│  │               knots/knotholders, snapping, actions/. Uses the DOM, no React.
│  ├─ wasm/        Emscripten builds of upstream lib2geom, livarot, path ops,
│  │               potrace, HarfBuzz (+ typed TS wrappers). Built from the
│  │               upstream checkout at the commit in upstream/sync.json.
│  ├─ text/        Port of libnrtype (Layout-TNG): text and flowed-text layout.
│  └─ assets/      Build step: pulls icons, keys, palettes, markers, po, ...
│                  from the upstream checkout.
├─ apps/
│  └─ web/         React app: menus, toolbars (ui/toolbar), docked dialogs
│                  (ui/dialog), widgets (ui/widget), status bar.
├─ upstream/
│  ├─ sync.json    Last synced upstream commit + path mapping.
│  └─ scripts/     Sync tools (see section 4).
└─ docs/
```

Dependency direction: `geom ← core ← editor ← web`. `wasm` is used by `core` or
`editor`. Lower packages never import higher ones.

## 4. Upstream sync process

- `upstream/sync.json` records the last upstream commit we have reviewed.
- Each ported file starts with a header that names its sources:
  `// Upstream: src/object/sp-rect.cpp, src/object/sp-rect.h`.
- `pnpm upstream:diff` reads these headers and lists the upstream commits
  since the recorded commit that touch ported files, grouped by our file.
  This list is the work queue for each sync.
- Commits that touch only unported files go to a "not ported yet" list, so we
  see which features are missing.
- Asset and translation changes come in automatically when the assets build
  runs again.
- WASM modules are rebuilt from the same upstream commit.

## 5. Phases

0. **Foundation (done 2026-10-27).** Monorepo, CI, assets pipeline, i18n, upstream sync script,
   parity inventory (`upstream:inventory`). Spikes are done (`SPIKES.md`).
1. **Document core.** XML repr tree with observers, SVG parse/serialize that
   keeps all data (including `sodipodi:`/`inkscape:` namespaces), undo/redo
   at repr level (as `DocumentUndo`), SPObject subset (root, group, layer, rect,
   ellipse, path, use), style cascade.
2. **Canvas and selection.** Render, zoom and pan, selector tool, transforms,
   rubberband, open/save, undo. First usable version.
3. **Drawing tools and basic dialogs.** Rect, ellipse, star, spiral,
   pen/bezier, pencil, node tool. Fill & Stroke, XML Editor, Layers & Objects,
   Document Properties. Keyboard shortcuts from `share/keys/inkscape.xml`.
4. **Path and layout.** Boolean ops and offsets (WASM), align and distribute,
   snapping, guides, grids, clipboard.
5. **Advanced features.** Text tools and dialogs, gradients, mesh gradients,
   patterns, hatches, markers, filters, live path effects, trace bitmap.
6. **Formats and extensions.** PNG/PDF/PS/EPS export, PDF/EMF/WMF/CDR/VSD
   import, Python extensions (Pyodide).
7. **Parity completion.** Close the remaining gaps from the inventory until
   only `SKIPPED.md` items are left.

Separate track from phase 1: **text layout engine** (`packages/text`).

Until that port exists, text uses an interim layout in the core:
`Layout` (`libnrtype/Layout-TNG.ts`) has the upstream interface (input,
iterators, cursor and selection shapes, bounds), but its `calculateFlow()`
(`Layout-TNG-Compute.ts`) is a simple line layout. It places one glyph per
code point, measured by an injected `TextMeasurer` (Canvas 2D in the
browser, fixed width in tests), and breaks lines only at line tspans,
preserved newlines and frame widths. There is no shaping, bidi or vertical
text. The editor draws each span as `svg:text` with the layout's positions.
The HarfBuzz port replaces `calculateFlow()` and the measurer; the objects,
the tool and the dialogs keep using the `Layout` interface.

## 6. Decisions

- Upstream: track `master`.
- Browsers: Chromium only.
- No real-time collaboration. Undo uses the upstream model (XML event log).
- Spike results and open risks: see `SPIKES.md`.

## 7. Parity scope

Size of upstream (master, 2026-10-27): 26 tools, 61 dialogs, about 400 action
ids, 59 LPEs, 213 filter presets, 35 internal import/export modules, plus the
Python extensions (`share/extensions`).

`pnpm upstream:inventory` generates this list from the upstream source
(tools, dialogs, action ids, LPE enum, filter presets, `.inx` files) and
compares it with what we have ported. Its output is the parity dashboard.

How we reproduce non-rendering features in the browser:

| Upstream feature              | Browser approach                                                                |
| ----------------------------- | ------------------------------------------------------------------------------- |
| System fonts                  | Local Font Access API (Chromium)                                                |
| Python extensions             | Pyodide, with upstream `share/extensions` unchanged                             |
| PDF/PS/EPS export             | Upstream Cairo renderer code + Cairo compiled to WASM (file output, not screen) |
| PDF import                    | Poppler compiled to WASM, or pdf.js                                             |
| EMF/WMF, CDR, VSD, WPG import | libUEMF, libcdr, libvisio, libwpg compiled to WASM                              |
| PNG export                    | Our renderer → `OffscreenCanvas`; DPI, antialias and bit depth options in JS    |
| Trace bitmap                  | potrace + libdepixelize → WASM                                                  |
| CMYK / ICC colors             | lcms2 → WASM for conversion; display as sRGB                                    |
| Open/save, autosave           | File System Access API, IndexedDB                                               |
| Clipboard                     | Async Clipboard API (SVG, PNG, text)                                            |
| Multiple windows              | `window.open` with one shared document per tab                                  |

Candidates for `SKIPPED.md` (decide one by one when we get there):

- Extensions that start external programs (LaTeX, Ghostscript, ...), unless a
  WASM build of that program exists.
- Native desktop integration: GTK themes, D-Bus, system print dialog options
  beyond `window.print()`, the `inkscape` command line (a Node CLI on top of
  `core` is possible later).
- Display color management with the monitor's ICC profile (the browser
  controls this).
- Pixel-identical Cairo antialiasing and dithering on screen.
