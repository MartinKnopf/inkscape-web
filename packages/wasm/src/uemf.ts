// SPDX-License-Identifier: GPL-2.0-or-later
// uemf-module.wasm: libuemf with the upstream EMF and WMF import, and the libuemf functions of
// the EMF and WMF output (see build.sh and bindings/uemf.cpp). It is a separate module: the app
// loads it only when the user opens, imports or saves an EMF or WMF file. The module matches
// UemfBackend of @inkscape-web/editor (extension/internal/metafile-inout.ts).
import type { MainModule } from '../dist/uemf-module.mjs';
import { BUNDLED_FONTS } from './text.ts';

export type UemfModule = MainModule;

/** fontconfig weight of a CSS weight (FC_WEIGHT_REGULAR, FC_WEIGHT_BOLD). */
const fc_weight = (weight: number) => (weight >= 700 ? 200 : 80);
/** fontconfig slant of a PangoStyle (FC_SLANT_ROMAN, FC_SLANT_OBLIQUE, FC_SLANT_ITALIC). */
const fc_slant = (style: number) => [0, 110, 100][style] ?? 0;

let module: Promise<UemfModule> | undefined;

/**
 * Load the module once, with the bundled DejaVu fonts for the text of the import (the text
 * keeps the font names of the file; the fonts give the metrics). readFont reads a font file
 * (default: fetch).
 */
export function loadUemf(options?: {
  locateFile?: (path: string) => string;
  readFont?: (url: URL) => Promise<Uint8Array>;
}): Promise<UemfModule> {
  const read =
    options?.readFont ?? (async (url: URL) => new Uint8Array(await (await fetch(url)).arrayBuffer()));
  module ??= import('../dist/uemf-module.mjs').then(async (m) => {
    const uemf = await m.default(options?.locateFile ? { locateFile: options.locateFile } : undefined);
    const fonts = await Promise.all(BUNDLED_FONTS.map((f) => read(f.url)));
    BUNDLED_FONTS.forEach((f, i) => {
      const name = f.url.pathname.split('/').pop()!;
      uemf.addFont(name, fonts[i]!, f.family, f.display_name, fc_weight(f.weight), fc_slant(f.style));
    });
    return uemf;
  });
  return module;
}
