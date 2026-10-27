# Project conventions

Port of Inkscape to the web. Read `docs/PLAN.md` first.

- **Upstream reference:** `../inkscape` (or `$INKSCAPE_SRC`) at the commit in
  `upstream/sync.json`. Read the upstream code before you port a feature, and
  copy its behavior, names and structure.
- **License header:** the first line of every source file is
  `SPDX-License-Identifier: GPL-2.0-or-later` (in the comment style of the
  file). When you port an upstream file, use its SPDX identifier and keep its
  authors and copyright lines. See `COPYING`.
- **Upstream header:** every file that ports or builds upstream code names its
  sources in the first lines: `// Upstream: src/object/sp-rect.cpp, src/object/sp-rect.h`.
  A path that ends with `/` stands for a folder. `pnpm upstream:diff` and
  `pnpm upstream:inventory` depend on these headers.
- **File names:** mirror upstream (`src/ui/tools/rect-tool.cpp` →
  `packages/editor/src/ui/tools/rect-tool.ts`).
- **Same identifiers as upstream:** action ids (`app.*`, `win.*`, `doc.*`),
  dialog keys, LPE keys, preference paths, and msgids for translated strings
  (use `_()`, `C_()`, `N_()`, `ngettext()` from `@inkscape-web/core`).
- **Layers:** `geom ← core ← editor ← apps/web`. `core` has no DOM; `editor`
  has no React. Never import upward.
- **WASM:** compile upstream C++ unchanged. Put needed replacements in
  `packages/wasm/shim/`, never patch upstream files.
- **Skipped features:** only when the browser cannot reproduce them. Add them
  to `docs/SKIPPED.md` with the reason.
- After `pnpm upstream:inventory --write`, commit `docs/PARITY.md` with the change.
