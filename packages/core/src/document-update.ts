// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/document-update.cpp, src/document-update.h
/*
 * Fixes for old documents when they are opened.
 *
 * Authors:
 *   Martin Owens <doctormo@geek-2.com>
 *
 * Copyright (C) 2021 Authors
 *
 * TODO: the other fixes of document-update.cpp (dpi, text, feComposite, ...).
 */
import type { SPDocument } from './document.ts';
import type { Node } from './xml/node.ts';

/**
 * Convert the inkscape:page children of the namedview (Inkscape 1.2 to 1.4)
 * to svg:view elements in the defs, which are the pages now. Keeps the ids.
 * Upstream makes an undo step; here it runs before the undo history starts.
 */
export function sp_file_fix_page_elements(doc: SPDocument): void {
  const nv = [...doc.getReprRoot().children()].find((c) => c.name() === 'sodipodi:namedview');
  const defs = doc.getDefs()?.getRepr();
  if (!nv || !defs) return;
  const to_delete: Node[] = [];
  const to_add: Node[] = [];
  const num = (child: Node, name: string) => Number.parseFloat(child.attribute(name) ?? '') || 0;
  for (const child of nv.children()) {
    if (child.name() !== 'inkscape:page') continue;
    const page = doc.getReprDoc().createElement('svg:view');
    page.setAttribute(
      'viewBox',
      [num(child, 'x'), num(child, 'y'), num(child, 'width'), num(child, 'height')].join(' '),
    );
    page.setAttribute('id', child.attribute('id'));
    page.setAttribute('inkscape:label', child.attribute('inkscape:label'));
    page.setAttributeOrRemoveIfEmpty('inkscape:margin', child.attribute('margin'));
    page.setAttributeOrRemoveIfEmpty('inkscape:bleed', child.attribute('bleed'));
    page.setAttributeOrRemoveIfEmpty('inkscape:page-size', child.attribute('page-size'));
    to_delete.push(child);
    to_add.push(page);
  }
  // To preserve ids, we remove and then add replacements
  for (const child of to_delete) nv.removeChild(child);
  for (const page of to_add) defs.appendChild(page);
}
