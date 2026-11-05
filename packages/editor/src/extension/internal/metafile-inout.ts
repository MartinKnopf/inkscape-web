// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/metafile-inout.cpp, src/extension/internal/metafile-inout.h
/*
 * Metafile input - common routines
 *
 * Authors:
 *   David Mathog
 *
 * Copyright (C) 2013 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { FontFactory, PangoStyle, pango_font_description_new, SPDocument } from '@inkscape-web/core';
import { Implementation } from '../implementation/implementation.ts';
import { ensureUemfBackend, type UemfBackend } from './uemf-backend.ts';

/**
 * The base class of the EMF and WMF input and output (upstream Metafile). The image
 * conversion (toPNG) and the other helpers of the import run in uemf-module.wasm with the
 * upstream import; here is the part that turns its SVG text into a document.
 */
export class Metafile extends Implementation {
  /** The families that were looked up for the module already (their files are in it). */
  static readonly #fonts_sent = new Set<string>();

  /**
   * Run the import of the WASM module and build the document from its SVG text; null on error.
   * The text of the import is placed with the metrics of its fonts (upstream: fontconfig finds
   * them). When the file asks for families that the editor has font files for, they go to the
   * module and the import runs again.
   */
  static async import_svg(run: (uemf: UemfBackend) => string): Promise<SPDocument | null> {
    const uemf = await ensureUemfBackend();
    if (!uemf) return null;
    let svg = run(uemf);
    if (!svg) return null;
    const families = uemf
      .requestedFontFamilies()
      .split('\n')
      .filter((f) => f && !Metafile.#fonts_sent.has(f.toLowerCase()));
    if (families.length && (await Metafile.send_fonts(uemf, families))) svg = run(uemf);
    return SPDocument.createNewDocFromMem(svg);
  }

  /**
   * Give the module the font files of the families that the editor has (FontFactory: system
   * fonts, font files that the user added); whether a file was added. Only the first face of
   * a font collection can be used (the import opens face 0).
   */
  static async send_fonts(uemf: UemfBackend, families: readonly string[]): Promise<boolean> {
    const factory = FontFactory.get();
    const styles = [
      { weight: 400, style: PangoStyle.PANGO_STYLE_NORMAL, fc_weight: 80, fc_slant: 0, name: 'Regular' },
      { weight: 700, style: PangoStyle.PANGO_STYLE_NORMAL, fc_weight: 200, fc_slant: 0, name: 'Bold' },
      { weight: 400, style: PangoStyle.PANGO_STYLE_ITALIC, fc_weight: 80, fc_slant: 100, name: 'Italic' },
      {
        weight: 700,
        style: PangoStyle.PANGO_STYLE_ITALIC,
        fc_weight: 200,
        fc_slant: 100,
        name: 'Bold Italic',
      },
    ];
    let added = false;
    for (const family of families) {
      Metafile.#fonts_sent.add(family.toLowerCase());
      if (!factory.backend || !factory.hasFontFamily(family)) continue;
      const descrs = styles.map((s) => ({
        ...pango_font_description_new(family),
        weight: s.weight,
        style: s.style,
      }));
      for (const d of descrs) factory.Face(d); // start loading
      await factory.whenLoaded();
      const sent = new Set<Uint8Array>();
      descrs.forEach((d, i) => {
        const file = factory.Face(d).face?.fontData?.();
        if (file?.index !== 0 || sent.has(file.data)) return;
        sent.add(file.data);
        const s = styles[i]!;
        uemf.addFont(`${family}-${s.name}.font`, file.data, family, s.name, s.fc_weight, s.fc_slant);
        added = true;
      });
    }
    return added;
  }
}
