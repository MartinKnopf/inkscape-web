// SPDX-License-Identifier: GPL-2.0-or-later
// cairo-module.wasm: cairo, pixman, FreeType, libpng and zlib for PDF, PS and EPS export (see
// build.sh and bindings/cairo.cpp). It is a separate module from geom-module.wasm: the app
// loads it only when the user exports. The module matches CairoBackend of @inkscape-web/core.
import type { MainModule } from '../dist/cairo-module.mjs';

export type CairoModule = MainModule;

let module: Promise<CairoModule> | undefined;

/** Load the module once (the JavaScript and the WASM file are fetched on the first call). */
export function loadCairo(options?: { locateFile: (path: string) => string }): Promise<CairoModule> {
  module ??= import('../dist/cairo-module.mjs').then((m) => m.default(options));
  return module;
}
