// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/emf-inout.cpp, src/extension/internal/emf-inout.h
/*
 * Windows-only Enhanced Metafile input and output.
 *
 * Authors:
 *   Ulf Erikson <ulferikson@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   David Mathog
 *   Abhishek Sharma
 *
 * Copyright (C) 2006-2008 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 *
 * The record parsing of Emf::open (myEnhMetaFileProc) is the upstream C++, compiled to WASM
 * unchanged (packages/wasm/bindings/uemf.cpp); it returns the SVG text of the drawing.
 */
import { N_, type SPDocument } from '@inkscape-web/core';
import { invoke_print, load_print_images, SPPrintContext } from '../../print.ts';
import { db } from '../db.ts';
import type { Extension } from '../extension.ts';
import type { Input } from '../input.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import type { Print } from '../print.ts';
import { build_from_mem } from '../system.ts';
import { cairo_renderer_hooks } from './cairo-renderer-pdf-out.ts';
import { PrintEmf } from './emf-print.ts';
import { Metafile } from './metafile-inout.ts';
import { ensureUemfBackend } from './uemf-backend.ts';

const PRINT_EMF = 'org.inkscape.print.emf';

/** The EMF input and output (upstream Emf). */
export class Emf extends Metafile {
  override check(_module: Extension): boolean {
    return db.get(PRINT_EMF) !== null;
  }

  /** Print the document with the EMF print extension (upstream print_document_to_file); the file data. */
  static async print_document_to_file(doc: SPDocument, filename: string): Promise<Uint8Array | null> {
    doc.ensureUpToDate();
    const mod = db.get(PRINT_EMF) as Print | null;
    const uemf = await ensureUemfBackend();
    if (!mod || !uemf) return null;
    const oldoutput = mod.get_param_string('destination');
    mod.set_param_string('destination', filename);

    /* Start */
    const imp = mod.get_imp() as PrintEmf;
    imp.uemf = uemf;
    imp.images = await load_print_images(doc, cairo_renderer_hooks.current.loadImage);
    const context = new SPPrintContext(mod, imp.images);
    context.canUTN = () => uemf.CanUTN() !== 0;
    context.singleUnicodeToNon = (c) => uemf.SingleUnicodeToNon(c);
    try {
      /* Print document */
      if (mod.begin(doc)) return null; // upstream throws Output::save_failed
      invoke_print(doc.getRoot(), context);
      return mod.finish();
    } finally {
      imp.abort(); // nothing to free after finish()
      mod.set_param_string('destination', oldoutput);
    }
  }

  override async save(mod: Output, doc: SPDocument, filename: string): Promise<Uint8Array | null> {
    const ext = db.get(PRINT_EMF);
    if (!ext) return null;
    const uemf = await ensureUemfBackend();
    if (!uemf) throw new Error('save_failed: uemf-module.wasm is not available');

    const new_val = mod.get_param_bool('textToPath');
    const new_FixPPTCharPos = mod.get_param_bool('FixPPTCharPos'); // character position bug
    // reserve FixPPT2 for opacity bug.  Currently EMF does not export opacity values
    const new_FixPPTDashLine = mod.get_param_bool('FixPPTDashLine'); // dashed line bug
    const new_FixPPTGrad2Polys = mod.get_param_bool('FixPPTGrad2Polys'); // gradient bug
    const new_FixPPTLinGrad = mod.get_param_bool('FixPPTLinGrad'); // allow native rectangular linear gradient
    const new_FixPPTPatternAsHatch = mod.get_param_bool('FixPPTPatternAsHatch'); // force all patterns as standard EMF hatch
    const new_FixImageRot = mod.get_param_bool('FixImageRot'); // remove rotations on images

    uemf.TableGen(
      //possibly regenerate the unicode-convert tables
      mod.get_param_bool('TnrToSymbol'),
      mod.get_param_bool('TnrToWingdings'),
      mod.get_param_bool('TnrToZapfDingbats'),
      mod.get_param_bool('UsePUA'),
    );

    ext.set_param_bool('FixPPTCharPos', new_FixPPTCharPos); // Remember to add any new ones to PrintEmf::init or a mysterious failure will result!
    ext.set_param_bool('FixPPTDashLine', new_FixPPTDashLine);
    ext.set_param_bool('FixPPTGrad2Polys', new_FixPPTGrad2Polys);
    ext.set_param_bool('FixPPTLinGrad', new_FixPPTLinGrad);
    ext.set_param_bool('FixPPTPatternAsHatch', new_FixPPTPatternAsHatch);
    ext.set_param_bool('FixImageRot', new_FixImageRot);
    ext.set_param_bool('textToPath', new_val);

    return Emf.print_document_to_file(doc, filename);
  }

  override async open(_mod: Input, _uri: string, data: Uint8Array): Promise<SPDocument | null> {
    return Metafile.import_svg((uemf) => uemf.emfImport(data));
  }

  static init(): void {
    PrintEmf.init();

    /* EMF in */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('EMF Input')}</name>\n` +
        '<id>org.inkscape.input.emf</id>\n' +
        '<input>\n' +
        '<extension>.emf</extension>\n' +
        '<mimetype>image/x-emf</mimetype>\n' +
        `<filetypename>${N_('Enhanced Metafiles (*.emf)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Enhanced Metafiles')}</filetypetooltip>\n` +
        '</input>\n' +
        '</inkscape-extension>',
      new Emf(),
    );

    /* EMF out */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('EMF Output')}</name>\n` +
        '<id>org.inkscape.output.emf</id>\n' +
        `<param name="textToPath" gui-text="${N_('Convert texts to paths')}" type="bool">true</param>\n` +
        `<param name="TnrToSymbol" gui-text="${N_('Map Unicode to Symbol font')}" type="bool">true</param>\n` +
        `<param name="TnrToWingdings" gui-text="${N_('Map Unicode to Wingdings')}" type="bool">true</param>\n` +
        `<param name="TnrToZapfDingbats" gui-text="${N_('Map Unicode to Zapf Dingbats')}" type="bool">true</param>\n` +
        `<param name="UsePUA" gui-text="${N_('Use MS Unicode PUA (0xF020-0xF0FF) for converted characters')}" type="bool">false</param>\n` +
        `<param name="FixPPTCharPos" gui-text="${N_('Compensate for PPT font bug')}" type="bool">false</param>\n` +
        `<param name="FixPPTDashLine" gui-text="${N_('Convert dashed/dotted lines to single lines')}" type="bool">false</param>\n` +
        `<param name="FixPPTGrad2Polys" gui-text="${N_('Convert gradients to colored polygon series')}" type="bool">false</param>\n` +
        `<param name="FixPPTLinGrad" gui-text="${N_('Use native rectangular linear gradients')}" type="bool">false</param>\n` +
        `<param name="FixPPTPatternAsHatch" gui-text="${N_('Map all fill patterns to standard EMF hatches')}" type="bool">false</param>\n` +
        `<param name="FixImageRot" gui-text="${N_('Ignore image rotations')}" type="bool">false</param>\n` +
        '<output>\n' +
        '<extension>.emf</extension>\n' +
        '<mimetype>image/x-emf</mimetype>\n' +
        `<filetypename>${N_('Enhanced Metafile (*.emf)')}</filetypename>\n` +
        `<filetypetooltip>${N_('Enhanced Metafile')}</filetypetooltip>\n` +
        '</output>\n' +
        '</inkscape-extension>',
      new Emf(),
    );
  }
}
