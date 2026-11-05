// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/latex-pstricks-out.cpp, src/extension/internal/latex-pstricks-out.h
/*
 * Authors:
 *   Ted Gould <ted@gould.cx>
 *   Johan Engelen <johan@shouraizou.nl>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004-2006 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { N_, type SPDocument, SPItem } from '@inkscape-web/core';
import { Implementation } from '../implementation/implementation.ts';
import type { Output } from '../output.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import { build_from_mem } from '../system.ts';
import { PrintLatex } from './latex-pstricks.ts';

/** The output of LaTeX with PSTricks macros (upstream LatexOutput). */
export class LatexOutput extends Implementation {
  /** Save the document as a LaTeX picture. */
  override async save(_mod: Output, doc: SPDocument, _filename: string): Promise<Uint8Array | null> {
    doc.ensureUpToDate();

    const print = new PrintLatex();
    print.begin(doc);
    // SPRoot::print binds c2p and prints the children (SPGroup::print)
    const root = doc.getRoot();
    print.bind(root.c2p, 1.0);
    for (const child of root.children) if (child instanceof SPItem) print.invoke_print(child);
    print.release();
    return new TextEncoder().encode(print.finish());
  }

  /** The definition of the LaTeX output (upstream LatexOutput::init). */
  static init(): void {
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        `<name>${N_('LaTeX Output')}</name>\n` +
        '<id>org.inkscape.output.latex</id>\n' +
        '<output>\n' +
        '<extension>.tex</extension>\n' +
        '<mimetype>text/x-tex</mimetype>\n' +
        `<filetypename>${N_('LaTeX With PSTricks macros (*.tex)')}</filetypename>\n` +
        `<filetypetooltip>${N_('LaTeX PSTricks File')}</filetypetooltip>\n` +
        '</output>\n' +
        '</inkscape-extension>',
      new LatexOutput(),
    );
  }
}
