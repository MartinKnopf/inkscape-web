# Spike results (2026-10-27)

Code: `spikes/`. Reference renderer: Inkscape 1.4.4 (Homebrew cask). Upstream
source: `~/dev/inkscape` `master`.

## 1. Render fidelity (`spikes/render-fidelity`)

Method: parse each SVG with `DOMParser`, import it into a Chromium page as
live SVG DOM, screenshot, compare with Inkscape PNGs (pixelmatch, threshold
0.15, % of differing pixels).

Inkscape example files (`share/examples`, 25 files) vs Inkscape 1.4.4:

| Result | Files                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------- |
| < 1 %  | 19 (tiger, car, gallardo, gradient, markers, stars, rope-3D, LPE examples, mesh gradient, ...) |
| 1–5 %  | `l-systems`, `text-on-path`, `turbulence_filters`, `filters`, `i18n`                           |
| > 5 %  | `blend_modes` (7 %), `svgfont` (11 %), `tref` (10 %)                                           |

Tutorials (13 files): 3–9 %, nearly all from text (fonts, layout).

Upstream rendering tests (`testfiles/rendering_tests`, 36 cases):
17 below 1 %. Failures by cause:

- **Inkscape-only or SVG2 features that Chromium does not support:**
  `<solidcolor>` (36 %), SVG2 `refX/refY` on `<symbol>` (28 %), SVG2 flowed text
  (`shape-inside`, the text is not drawn at all), SVG fonts, `<tref>`.
- **LPE without a stored `d`** (powerstroke test, 18 %): only Inkscape can
  calculate the path.
- **Text layout:** Chromium's text layout is different from Inkscape's
  (Pango/HarfBuzz layout): 2–9 % on all text tests.
- **External `<use href="other.svg#id">`:** blocked by Chromium.
- **Filters and blend modes:** small differences with transparent backgrounds.

Performance: most files render in 5–60 ms. **`filters.svg` takes 35 s** in
Chromium (CPU SVG filters).

**Conclusion:** the browser SVG engine draws shapes, paths, gradients,
markers, clipping, masks and most filters correctly. But we cannot simply show
the document XML. We must generate a **display tree** from our object model
(as upstream `SPObject::show()` → `DrawingItem`). The display tree contains
only SVG that Chromium supports: calculated LPE paths, solid colors resolved,
symbols converted, external refs resolved. **Text must be laid out by us**
(port of `libnrtype/Layout-TNG*` with HarfBuzz WASM) and drawn as positioned
glyphs. This is the largest single work item, and we cannot avoid it:
flowed text and Inkscape-compatible text positions need it.

## 2. WASM geometry (`spikes/wasm-geom`)

Built **upstream lib2geom (all sources) + livarot + `path/path-boolop.cpp` +
GSL + double-conversion** with Emscripten 6.0.13. **No upstream file was
changed.** We only needed:

- a 25-line `glib.h` shim (`g_malloc`, `g_free`, `g_assert`, ...),
- a 3-line `glibmm/i18n.h` shim,
- Boost Interval: WASM has no rounding-mode control, so we use the default
  no-op rounding (affects only `geometric-intersection.cpp`).

The build is a 30-line shell script (the upstream CMake does not cross-compile
easily). A rebuild takes 9 s.

| Measure                                                                                        | Result                  |
| ---------------------------------------------------------------------------------------------- | ----------------------- |
| `geom.wasm`                                                                                    | 615 KB, **224 KB gzip** |
| Boolean ops vs Inkscape 1.4.4 CLI (union, intersection, difference, exclusion × 3 shape pairs) | **12/12 same geometry** |
| Boolean op, 400-node star ∪ circle                                                             | 4.6 ms                  |
| Small call (parse path string + `nearestTime`)                                                 | 6.7 µs                  |

Note: `sp_pathvector_boolop(a, b, diff)` gives b \ a. Upstream calls it with
(top, bottom).

**Conclusion:** compiling upstream C++ to WASM works well and keeps results
identical. Use it for heavy, self-contained algorithms (boolean ops, offsets,
simplify, cut/slice, stroke-to-path, potrace, later HarfBuzz). Calls are too
slow for very small, frequent operations (snapping, hit tests during a drag).
Write those in TypeScript. Pass geometry as `Float64Array`, not as path
strings.

## 3. UI shell (`spikes/ui-shell`)

React 19 + dockview 8 + Vite 8. A React-free `core` (XML repr with observers,
undo from an XML event log, `done`/`maybeDone` like upstream) and `editor`
(desktop, display mirror into the SVG DOM in a **shadow root**, overlay
for controls, select tool, rect tool). React panels: XML editor, undo history.

| Measure (headless Chromium, M-series Mac) | tiger (656 nodes) | gallardo (1,988) | car (2,945) |
| ----------------------------------------- | ----------------- | ---------------- | ----------- |
| Parse into repr                           | 3 ms              | 9 ms             | 14 ms       |
| Build display DOM                         | 12 ms             | 25 ms            | 44 ms       |
| Pan/zoom frame (CSS transform)            | 16.7 ms (vsync)   | 16.7 ms          | 16.7 ms     |
| Attribute edit + commit + React update    | 16 ms             | 16 ms            | 29 ms       |

Draw, move, undo and redo all worked. The XML editor updates from the
document. With CSS-transform zoom, the drawing stays sharp at 12×.

**Conclusions:**

- No state library is necessary. The core uses upstream-style observers.
  React subscribes with `useSyncExternalStore`. Large panels must subscribe
  per node, not re-render the whole tree (car: 29 ms comes mostly from
  re-rendering the whole XML tree).
- The shadow DOM isolates document `<style>` rules from the app UI.
- Hidden dockview tabs are not rendered, so they cost nothing.
- The spike parses with `DOMParser`. The real core must not depend on the DOM
  (Node tests, workers). Use a small SAX parser.

## Risks still open

1. **Slow filters** (35 s case). We need what upstream has: display modes
   (normal / no filters / outline), and maybe rendering of filtered
   items off the main thread (OffscreenCanvas) later.
2. **Extreme zoom.** CSS scale makes very large layers. Above approximately
   16×, switch to a transform on the drawing root.
3. **Text engine port.** This is a large amount of work. Start it early as a
   separate track.
