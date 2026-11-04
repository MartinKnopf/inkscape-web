// SPDX-License-Identifier: GPL-2.0-or-later
// Test helper: load the text module and the geom module of @inkscape-web/wasm, and register the
// bundled DejaVu fonts from their files. Not used in production code.
// biome-ignore lint/correctness/noNodejsModules: test helper, runs in Node
import { readFile } from 'node:fs/promises';
// biome-ignore lint/correctness/noNodejsModules: test helper, runs in Node
import { fileURLToPath } from 'node:url';
import { BUNDLED_FONTS, loadGeom, loadText } from '@inkscape-web/wasm';
import { FontFactory, type PangoStretch } from './font-factory.ts';
import { setTextLayoutBackend } from './Layout-TNG-Scanline-Makers.ts';

/** Set up real text layout (HarfBuzz and livarot) with the bundled fonts, loaded before it returns. */
export async function setupTextLayout(): Promise<void> {
  const [text, geom] = await Promise.all([loadText(), loadGeom()]);
  const factory = FontFactory.get();
  factory.setBackend(text);
  setTextLayoutBackend(geom);
  for (const f of BUNDLED_FONTS) {
    const bytes = new Uint8Array(await readFile(fileURLToPath(f.url)));
    factory.addFontSource({
      family: f.family,
      style: f.style,
      weight: f.weight,
      stretch: 4 as PangoStretch,
      display_name: f.display_name,
      load: async () => bytes,
    });
  }
  for (const f of BUNDLED_FONTS) {
    await factory.preload({
      family: f.family,
      style: f.style,
      weight: f.weight,
      stretch: 4,
      variant: 0,
      variations: '',
    });
  }
  await factory.whenLoaded();
}

/** Back to the layout without fonts (one glyph of half an em per character). */
export function teardownTextLayout(): void {
  FontFactory.get().setBackend(null);
  setTextLayoutBackend(null);
}
