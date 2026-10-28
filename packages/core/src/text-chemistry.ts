// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/text-chemistry.cpp, src/text-chemistry.h
/*
 * Text commands
 *
 * Authors:
 *   bulia byak
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004 authors
 */
import { DocumentUndo } from './document-undo.ts';
import { C_ } from './i18n.ts';
import { SPFlowtext } from './object/sp-flowtext.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from './object/sp-object.ts';
import { SPText } from './object/sp-text.ts';
import { SP_TEXT_LAYOUT_MODIFIED_FLAG, SPTSpan } from './object/sp-tspan.ts';
import type { Selection } from './selection.ts';

function text_remove_all_kerns_recursively(o: SPObject): void {
  o.removeAttribute('dx');
  o.removeAttribute('dy');
  o.removeAttribute('rotate');

  // if x contains a list, leave only the first value
  const x = o.getRepr().attribute('x');
  if (x) {
    const xa = x.split(/[ ,]/).filter(Boolean);
    if (xa.length > 1) o.setAttribute('x', xa[0]!);
  }

  for (const i of o.children) {
    text_remove_all_kerns_recursively(i);
    i.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG);
  }
}

/**
 * Remove the manual kerns (dx, dy, rotate and x lists) of the selected texts
 * (the app.text-unkern action). Returns false if there is no text.
 * FIXME: must work with text selection
 */
export function text_remove_all_kerns(selection: Selection): boolean {
  let did = false;
  for (const obj of selection.items()) {
    if (!(obj instanceof SPText) && !(obj instanceof SPTSpan) && !(obj instanceof SPFlowtext)) continue;
    text_remove_all_kerns_recursively(obj);
    obj.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_TEXT_LAYOUT_MODIFIED_FLAG);
    did = true;
  }
  const doc = selection.document();
  // TODO: the message "Select <b>text(s)</b> to remove kerns from."
  if (did && doc) DocumentUndo.done(doc, C_('Undo', 'Remove manual kerns'), 'draw-text');
  return did;
}
