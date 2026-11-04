// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/cairo-ps-out.cpp, src/extension/internal/cairo-ps-out.h
/*
 * A quick hack to use the Cairo renderer to write out a file.  This
 * then makes 'save as...' PS.
 *
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Ulf Erikson <ulferikson@users.sf.net>
 *   Adib Taraben <theAdib@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004-2006 Authors
 */
import { CairoPsLevel, CairoRenderer, ensureCairoBackend, N_, type SPDocument } from '@inkscape-web/core';
import { db } from '../db.ts';
import type { Extension } from '../extension.ts';
import { Implementation } from '../implementation/implementation.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';
import { cairo_renderer_hooks } from './cairo-renderer-pdf-out.ts';

export const SP_MODULE_KEY_PRINT_CAIRO_PS = 'org.inkscape.print.ps.cairo';
export const SP_MODULE_KEY_PRINT_CAIRO_EPS = 'org.inkscape.print.eps.cairo';

/**
 * Render the document to a PS or EPS file (upstream ps_print_document_to_file); the file
 * data, or null if it fails. texttopath draws the glyph outlines (upstream converts text to
 * paths with Object to Path first).
 */
export async function ps_print_document_to_file(
  doc: SPDocument,
  level: number,
  texttopath: boolean,
  omittext: boolean,
  filtertobitmap: boolean,
  resolution: number,
  eps = false,
): Promise<Uint8Array | null> {
  if (!(await ensureCairoBackend())) return null;

  doc.ensureUpToDate();

  const root = doc.getRoot();
  if (!root) return null;

  /* Create renderer and context */
  const renderer = new CairoRenderer(cairo_renderer_hooks.current);
  const ctx = renderer.createContext();
  ctx.setPSLevel(level);
  ctx.setEPS(eps);
  ctx.setTextToPath(texttopath);
  ctx.setOmitText(omittext);
  ctx.setFilterToBitmap(filtertobitmap);
  ctx.setBitmapResolution(resolution);

  try {
    let ret = ctx.setPsTarget();
    if (ret) {
      /* Render document */
      ret = renderer.setupDocument(ctx, doc, root);
      if (ret) {
        /* Render multiple pages */
        ret = await renderer.renderPages(ctx, doc, false);
        ctx.finish();
      }
    }
    return ret ? ctx.getOutput() : null;
  } finally {
    ctx.destroy();
    renderer.dispose();
  }
}

/** The parameters that the PS and EPS outputs share. */
function ps_options(mod: Output) {
  let level = CairoPsLevel.LEVEL_2;
  try {
    if (mod.get_param_optiongroup('PSlevel').toLowerCase() === 'ps3') level = CairoPsLevel.LEVEL_3;
  } catch {}
  let textToPath = false;
  try {
    textToPath = mod.get_param_optiongroup('textToPath') === 'paths';
  } catch {}
  let textToLaTeX = false;
  try {
    textToLaTeX = mod.get_param_optiongroup('textToPath') === 'LaTeX';
  } catch {
    console.warn('Parameter <textToLaTeX> might not exist');
  }
  let blurToBitmap = false;
  try {
    blurToBitmap = mod.get_param_bool('blurToBitmap');
  } catch {}
  let bitmapResolution = 72;
  try {
    bitmapResolution = mod.get_param_int('resolution');
  } catch {}
  return { level, textToPath, textToLaTeX, blurToBitmap, bitmapResolution };
}

/** The definition of the PS and EPS outputs (upstream CairoPsOutput::init and CairoEpsOutput::init). */
function ps_extension_xml(
  name: string,
  id: string,
  ext: string,
  mime: string,
  type: string,
  tip: string,
): string {
  return (
    `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
    `<name>${name}</name>\n` +
    `<id>${id}</id>\n` +
    `<param name="PSlevel" gui-text="${N_('Restrict to PS level:')}" type="optiongroup" appearance="combo" >\n` +
    `<option value='PS3'>${N_('PostScript level 3')}</option>\n` +
    `<option value='PS2'>${N_('PostScript level 2')}</option>\n` +
    '</param>\n' +
    `<param name="textToPath" gui-text="${N_('Text output options:')}" type="optiongroup" appearance="radio">\n` +
    `<option value="embed">${N_('Embed fonts')}</option>\n` +
    `<option value="paths">${N_('Convert text to paths')}</option>\n` +
    `<option value="LaTeX">${N_('Omit text in PDF and create LaTeX file')}</option>\n` +
    '</param>\n' +
    `<param name="blurToBitmap" gui-text="${N_('Rasterize filter effects')}" type="bool">true</param>\n` +
    `<param name="resolution" gui-text="${N_('Resolution for rasterization (dpi):')}" type="int" min="1" max="10000">96</param>\n` +
    '<spacer/>' +
    '<hbox indent="1"><image>info-outline</image><spacer/><vbox><spacer/>' +
    `<label>${N_("When exporting from the Export dialog, you can choose objects to export. 'Save a copy' / 'Save as' will export all pages.")}</label>` +
    '<spacer size="5" />' +
    `<label>${N_('The page bleed can be set with the Page tool.')}</label>` +
    '</vbox></hbox>' +
    '<output>\n' +
    `<extension>${ext}</extension>\n` +
    `<mimetype>${mime}</mimetype>\n` +
    `<filetypename>${type}</filetypename>\n` +
    `<filetypetooltip>${tip}</filetypetooltip>\n` +
    '</output>\n' +
    '</inkscape-extension>'
  );
}

/** The PostScript output (upstream CairoPsOutput). */
export class CairoPsOutput extends Implementation {
  override check(_module: Extension): boolean {
    return db.get(SP_MODULE_KEY_PRINT_CAIRO_PS) !== null;
  }

  /** Save the document as PS; the file data. TODO: the LaTeX file of the LaTeX option. */
  override async save(mod: Output, doc: SPDocument, _filename: string): Promise<Uint8Array | null> {
    if (!db.get(SP_MODULE_KEY_PRINT_CAIRO_PS)) return null;
    const o = ps_options(mod);
    return ps_print_document_to_file(
      doc,
      o.level,
      o.textToPath,
      o.textToLaTeX,
      o.blurToBitmap,
      o.bitmapResolution,
    );
  }

  static init(): void {
    build_from_mem(
      ps_extension_xml(
        N_('PostScript'),
        SP_MODULE_KEY_PRINT_CAIRO_PS,
        '.ps',
        'image/x-postscript',
        N_('PostScript (*.ps)'),
        N_('PostScript File'),
      ),
      new CairoPsOutput(),
    );
  }
}

/** The Encapsulated PostScript output (upstream CairoEpsOutput). */
export class CairoEpsOutput extends Implementation {
  override check(_module: Extension): boolean {
    return db.get(SP_MODULE_KEY_PRINT_CAIRO_EPS) !== null;
  }

  /** Save the document as EPS; the file data. TODO: the LaTeX file of the LaTeX option. */
  override async save(mod: Output, doc: SPDocument, _filename: string): Promise<Uint8Array | null> {
    if (!db.get(SP_MODULE_KEY_PRINT_CAIRO_EPS)) return null;
    const o = ps_options(mod);
    return ps_print_document_to_file(
      doc,
      o.level,
      o.textToPath,
      o.textToLaTeX,
      o.blurToBitmap,
      o.bitmapResolution,
      true,
    );
  }

  static init(): void {
    build_from_mem(
      ps_extension_xml(
        N_('Encapsulated PostScript'),
        SP_MODULE_KEY_PRINT_CAIRO_EPS,
        '.eps',
        'image/x-e-postscript',
        N_('Encapsulated PostScript (*.eps)'),
        N_('Encapsulated PostScript File'),
      ),
      new CairoEpsOutput(),
    );
  }
}
