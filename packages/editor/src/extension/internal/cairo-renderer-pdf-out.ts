// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/cairo-renderer-pdf-out.cpp, src/extension/internal/cairo-renderer-pdf-out.h
/*
 * A quick hack to use the Cairo renderer to write out a file.  This
 * then makes 'save as...' PDF.
 *
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Ulf Erikson <ulferikson@users.sf.net>
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004-2010 Authors
 */
import {
  CairoRenderer,
  type CairoRendererHooks,
  ensureCairoBackend,
  N_,
  type SPDocument,
} from '@inkscape-web/core';
import { db } from '../db.ts';
import type { Extension } from '../extension.ts';
import { Implementation } from '../implementation/implementation.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';

/** The options of the PDF output (upstream PDFOptions). */
export interface PDFOptions {
  text_to_path: boolean;
  text_to_latex: boolean;
  rasterize_filters: boolean;
  stretch_to_fit: boolean;
}

/**
 * The platform services of the renderer (fonts, image decoding, rasterization). The editor
 * sets them for the browser (see cairo-renderer-hooks.ts); tests set their own.
 */
export const cairo_renderer_hooks: { current: CairoRendererHooks } = { current: {} };

/**
 * Render the document to a PDF file (upstream pdf_render_document_to_file); the file data, or
 * null if it fails. Upstream converts text to paths with Object to Path first when
 * text_to_path is set; here the context draws the glyph outlines (Cairo's text-to-path).
 */
export async function pdf_render_document_to_file(
  doc: SPDocument,
  level: number,
  flags: PDFOptions,
  resolution: number,
): Promise<Uint8Array | null> {
  if (!(await ensureCairoBackend())) return null;

  doc.ensureUpToDate();

  const root = doc.getRoot();
  if (!root) return null;

  /* Create renderer and context */
  const renderer = new CairoRenderer(cairo_renderer_hooks.current);
  const ctx = renderer.createContext();
  ctx.setPDFLevel(level);
  ctx.setTextToPath(flags.text_to_path);
  ctx.setOmitText(flags.text_to_latex);
  ctx.setFilterToBitmap(flags.rasterize_filters);
  ctx.setBitmapResolution(resolution);

  try {
    const ret =
      ctx.setPdfTarget() &&
      renderer.setupDocument(ctx, doc, root) &&
      (await renderer.renderPages(ctx, doc, flags.stretch_to_fit));
    if (ret) ctx.finish();
    return ret ? ctx.getOutput() : null;
  } finally {
    ctx.destroy();
    renderer.dispose();
  }
}

/** The PDF output (upstream CairoRendererPdfOutput). */
export class CairoRendererPdfOutput extends Implementation {
  override check(_module: Extension): boolean {
    return db.get('org.inkscape.output.pdf.cairorenderer') !== null;
  }

  /**
   * Save the document as PDF; the file data. Upstream writes a file (and the LaTeX file of the
   * "Omit text in PDF and create LaTeX file" option).
   * TODO: the LaTeX file (latex_render_document_text_to_file).
   */
  override async save(mod: Output, doc: SPDocument, _filename: string): Promise<Uint8Array | null> {
    const ext = db.get('org.inkscape.output.pdf.cairorenderer');
    if (!ext) return null;

    let level = 0;
    try {
      const new_level = mod.get_param_optiongroup('PDFversion');
      if (new_level.toLowerCase() === 'pdf-1.5') level = 1;
    } catch {
      console.warn('Parameter <PDFversion> might not exist');
    }

    const flags: PDFOptions = {
      text_to_path: false,
      text_to_latex: false,
      rasterize_filters: false,
      stretch_to_fit: false,
    };
    try {
      flags.text_to_path = mod.get_param_optiongroup('textToPath') === 'paths';
    } catch {
      console.warn('Parameter <textToPath> might not exist');
    }
    try {
      flags.text_to_latex = mod.get_param_optiongroup('textToPath') === 'LaTeX';
    } catch {
      console.warn('Parameter <textToLaTeX> might not exist');
    }
    try {
      flags.rasterize_filters = mod.get_param_bool('blurToBitmap');
    } catch {
      console.warn('Parameter <blurToBitmap> might not exist');
    }
    let new_bitmapResolution = 72;
    try {
      new_bitmapResolution = mod.get_param_int('resolution');
    } catch {
      console.warn('Parameter <resolution> might not exist');
    }
    try {
      flags.stretch_to_fit = ext.get_param_optiongroup('stretch') === 'relative';
    } catch {
      console.warn('Parameter <stretch> might not exist');
    }

    // Create PDF file
    return pdf_render_document_to_file(doc, level, flags, new_bitmapResolution);
  }

  /**
   * This is the definition of Cairo PDF out. This function just calls the extension system
   * with the memory allocated XML that describes the data.
   */
  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        '<name>Portable Document Format</name>\n' +
        '<id>org.inkscape.output.pdf.cairorenderer</id>\n' +
        `<param name="PDFversion" gui-text="${N_('Restrict to PDF version:')}" type="optiongroup" appearance="combo" >\n` +
        `<option value='PDF-1.5'>${N_('PDF 1.5')}</option>\n` +
        `<option value='PDF-1.4'>${N_('PDF 1.4')}</option>\n` +
        '</param>\n' +
        `<param name="textToPath" gui-text="${N_('Text output options:')}" type="optiongroup" appearance="radio">\n` +
        `<option value="embed">${N_('Embed fonts')}</option>\n` +
        `<option value="paths">${N_('Convert text to paths')}</option>\n` +
        `<option value="LaTeX">${N_('Omit text in PDF and create LaTeX file')}</option>\n` +
        '</param>\n' +
        `<param name="blurToBitmap" gui-text="${N_('Rasterize filter effects')}" type="bool">true</param>\n` +
        `<param name="resolution" gui-text="${N_('Resolution for rasterization (dpi):')}" type="int" min="1" max="10000">96</param>\n` +
        '<spacer size="10" />' +
        `<param name="stretch" gui-text="${N_('Rounding compensation:')}" gui-description="${N_(
          'Exporting to PDF rounds the document size to the next whole number in pt units. Compensation may stretch the drawing slightly (up to 0.35mm for width and/or height). When not compensating, object sizes will be preserved strictly, but this can sometimes cause white gaps along the page margins.',
        )}" type="optiongroup" appearance="radio" >\n` +
        `<option value="relative">${N_('Compensate for rounding (recommended)')}</option>` +
        `<option value="absolute">${N_('Do not compensate')}</option>` +
        '</param><separator/>' +
        '<hbox indent="1"><image>info-outline</image><spacer/><vbox><spacer/>' +
        `<label>${N_("When exporting from the Export dialog, you can choose objects to export. 'Save a copy' / 'Save as' will export all pages.")}</label>` +
        '<spacer size="5" />' +
        `<label>${N_('The page bleed can be set with the Page tool.')}</label>` +
        '</vbox></hbox>' +
        "<output is_exported='true' priority='5'>\n" +
        '<extension>.pdf</extension>\n' +
        '<mimetype>application/pdf</mimetype>\n' +
        '<filetypename>Cairo PDF (*.pdf)</filetypename>\n' +
        '<filetypetooltip>Cairo PDF File</filetypetooltip>\n' +
        '</output>\n' +
        '</inkscape-extension>',
      new CairoRendererPdfOutput(),
    );
  }
}
