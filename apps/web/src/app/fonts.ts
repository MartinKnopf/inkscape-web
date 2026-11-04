// SPDX-License-Identifier: GPL-2.0-or-later
// Fonts for text layout: the text module (HarfBuzz) and the bundled DejaVu fonts, loaded before
// the first document is shown; system fonts (Local Font Access API) and font files the user adds
// are registered in the FontFactory too. When faces finish loading, the text of the open
// documents is laid out again.
import {
  FontFactory,
  PangoStretch,
  PangoStyle,
  SP_OBJECT_MODIFIED_FLAG,
  SP_TEXT_LAYOUT_MODIFIED_FLAG,
  SPFlowtext,
  type SPObject,
  SPText,
} from '@inkscape-web/core';
import { BUNDLED_FONTS, loadText } from '@inkscape-web/wasm';
import { getDocuments } from './documents.ts';

/** Load the text module and the bundled fonts; the default face (DejaVu Sans) is loaded when it returns. */
export async function loadFonts(): Promise<void> {
  const factory = FontFactory.get();
  factory.setBackend(await loadText());
  for (const f of BUNDLED_FONTS) {
    factory.addFontSource({
      family: f.family,
      style: f.style as PangoStyle,
      weight: f.weight,
      stretch: PangoStretch.PANGO_STRETCH_NORMAL,
      display_name: f.display_name,
      load: async () => new Uint8Array(await (await fetch(f.url)).arrayBuffer()),
    });
  }
  await factory.preload({
    family: 'sans-serif',
    style: PangoStyle.PANGO_STYLE_NORMAL,
    weight: 400,
    stretch: PangoStretch.PANGO_STRETCH_NORMAL,
    variant: 0,
    variations: '',
  });
  factory.changedSignal.connect(relayoutAllText);
}

/** Lay out the text of all open documents again (after fonts were loaded). */
function relayoutAllText(): void {
  const walk = (o: SPObject) => {
    if (o instanceof SPText || o instanceof SPFlowtext) {
      o.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG);
    }
    for (const child of o.children) walk(child);
  };
  for (const doc of getDocuments()) walk(doc.getRoot());
}
