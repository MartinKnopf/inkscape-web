// SPDX-License-Identifier: GPL-2.0-or-later
// revenge-module.wasm: librevenge with libcdr, libvisio and libwpg (and libwpd, ICU, libxml2) for
// the CorelDRAW, Visio and WordPerfect Graphics import (see build.sh, bindings/revenge.cpp).
// It is a separate module: the app loads it only when the user opens such a file.

/** The parsers. Each returns the SVG text of the pages, or null if the data is not supported. */
export interface RevengeModule {
  cdrParse(bytes: Uint8Array): string[] | null;
  vsdParse(bytes: Uint8Array): string[] | null;
  wpgParse(bytes: Uint8Array): string[] | null;
}

let module: Promise<RevengeModule> | undefined;

/**
 * Load the module once (the JavaScript and the WASM file are fetched on the first call). After a
 * failed load (for example a failed download), the next call tries again.
 */
export function loadRevenge(options?: { locateFile: (path: string) => string }): Promise<RevengeModule> {
  module ??= import('../dist/revenge-module.mjs')
    .then((m) => m.default(options) as Promise<RevengeModule>)
    .catch((e: unknown) => {
      module = undefined;
      throw e;
    });
  return module;
}
