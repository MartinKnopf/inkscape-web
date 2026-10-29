// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/id-clash.cpp, src/id-clash.h
/*
 * Routines for resolving ID clashes when importing or pasting.
 *
 * Authors:
 *   Stephen Silver <sasilver@users.sourceforge.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2008 authors
 */
import type { SPDocument } from './document.ts';
import { _ } from './i18n.ts';
import type { SPObject } from './object/sp-object.ts';
import type { Node } from './xml/node.ts';
import { spReprCssAttr, spReprCssProperty, spReprCssSet, spReprCssSetProperty } from './xml/repr-css.ts';
import { sp_repr_visit_descendants } from './xml/repr-util.ts';

enum ID_REF_TYPE {
  REF_HREF,
  REF_STYLE,
  REF_URL,
  REF_CLIPBOARD,
}

interface IdReference {
  type: ID_REF_TYPE;
  repr: Node;
  /** property or href-like attribute */
  attr: string;
}

type refmap_type = Map<string, IdReference[]>;
/** New id, old id. */
type id_changelist_type = [string, string][];

const href_like_attributes = [
  'inkscape:connection-end',
  'inkscape:connection-end-point',
  'inkscape:connection-start',
  'inkscape:connection-start-point',
  'inkscape:href',
  'inkscape:path-effect',
  'inkscape:perspectiveID',
  'inkscape:linked-fill',
  'inkscape:tiled-clone-of',
  'href',
  'xlink:href',
];

const other_url_properties = [
  'clip-path',
  'color-profile',
  'cursor',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
];

const clipboard_properties = ['fill', 'filter', 'stroke', 'marker-end', 'marker-mid', 'marker-start'];

/**
 * Style properties with url() references. Upstream reads them from the SPStyle
 * (fill, stroke, filter, markers, shape-inside, shape-subtract); here they are
 * read from the style attribute, as the paint servers are not ported yet.
 * TODO: shape-inside and shape-subtract (several urls), LPE satellite parameters.
 */
const style_url_properties = ['fill', 'stroke', 'filter', 'marker-start', 'marker-mid', 'marker-end'];

/** The id of a "url(#id)" value, or null. */
function extract_url_id(value: string | null): string | null {
  const m = value ? /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value) : null;
  return m?.[1] ?? null;
}

function addRef(refmap: refmap_type, id: string, idref: IdReference): void {
  const list = refmap.get(id);
  if (list) list.push(idref);
  else refmap.set(id, [idref]);
}

/** Given an reference (idref), make it point to new_id instead */
function fix_ref(idref: IdReference, new_id: string, old_id: string): void {
  switch (idref.type) {
    case ID_REF_TYPE.REF_HREF: {
      const value = idref.repr.attribute(idref.attr);
      if (!value) break;
      // look to values stores as separated id references like inkscape::path-effect or LPE satellites param
      const posid = value.indexOf(old_id);
      if (posid < 0) break;
      const fixed =
        idref.attr === 'inkscape:linked-fill'
          ? value.slice(0, posid) + new_id + value.slice(posid + old_id.length)
          : `${value.slice(0, posid - 1)}#${new_id}${value.slice(posid + old_id.length)}`;
      idref.repr.setAttribute(idref.attr, fixed);
      break;
    }
    case ID_REF_TYPE.REF_STYLE:
    case ID_REF_TYPE.REF_CLIPBOARD: {
      const style = spReprCssAttr(idref.repr, 'style');
      const prop = spReprCssProperty(style, idref.attr) ?? '';
      spReprCssSetProperty(style, idref.attr, prop.replace(/url\([^)]*\)/, `url(#${new_id})`));
      spReprCssSet(idref.repr, style, 'style');
      break;
    }
    case ID_REF_TYPE.REF_URL:
      idref.repr.setAttribute(idref.attr, `url(#${new_id})`);
      break;
  }
}

function _find_references_helper(repr_elem: Node, refmap: refmap_type, recurse: boolean): void {
  if (repr_elem.type() !== 'element') return;

  /* check for references in inkscape:clipboard elements */
  if (repr_elem.name() === 'inkscape:clipboard') {
    const css = spReprCssAttr(repr_elem, 'style');
    for (const attr of clipboard_properties) {
      const id = extract_url_id(spReprCssProperty(css, attr));
      if (id) addRef(refmap, id, { type: ID_REF_TYPE.REF_CLIPBOARD, repr: repr_elem, attr });
    }
  }

  /* check for xlink:href="#..." and similar */
  for (const attr of href_like_attributes) {
    let attfixed = repr_elem.attribute(attr) ?? '';
    if (attfixed && attr === 'inkscape:linked-fill') attfixed = `#${attfixed}`;
    if (!attfixed.startsWith('#')) continue;
    for (const part of attfixed.split(';')) {
      if (part.startsWith('#'))
        addRef(refmap, part.slice(1), { type: ID_REF_TYPE.REF_HREF, repr: repr_elem, attr });
    }
  }

  /* check for other url(#...) references */
  for (const attr of other_url_properties) {
    const id = extract_url_id(repr_elem.attribute(attr));
    if (id) addRef(refmap, id, { type: ID_REF_TYPE.REF_URL, repr: repr_elem, attr });
  }

  // After this point, we are evalutating object-specific properties and children
  if (!recurse) return;

  /* check for url(#...) references in the style */
  const style = spReprCssAttr(repr_elem, 'style');
  for (const attr of style_url_properties) {
    const id = extract_url_id(spReprCssProperty(style, attr));
    if (id) addRef(refmap, id, { type: ID_REF_TYPE.REF_STYLE, repr: repr_elem, attr });
  }
  for (const attr of style_url_properties) {
    const id = extract_url_id(repr_elem.attribute(attr));
    if (id) addRef(refmap, id, { type: ID_REF_TYPE.REF_URL, repr: repr_elem, attr });
  }

  // recurse
  for (let child = repr_elem.firstChild(); child; child = child.next()) {
    _find_references_helper(child, refmap, child.name() !== 'inkscape:clipboard');
  }
}

/**
 *  Build a table of places where IDs are referenced, for a given element.
 *  FIXME: There are some types of references not yet dealt with here
 *         (e.g., ID selectors in CSS stylesheets, and references in scripts).
 */
function find_references(doc: SPDocument, refmap: refmap_type): void {
  // The children of inkscape:clipboard are not scanned (upstream: they have no SPObject).
  _find_references_helper(doc.getReprRoot(), refmap, true);
}

/** All ids in the repr tree of doc. */
function all_ids(doc: SPDocument): Set<string> {
  const ids = new Set<string>();
  sp_repr_visit_descendants(doc.getReprRoot(), (node) => {
    const id = node.attribute('id');
    if (id) ids.add(id);
    return true;
  });
  return ids;
}

/**
 *  Change any IDs that clash with IDs in the current document, and make
 *  a list of those changes that will require fixing up references.
 *  Upstream walks the objects; here the reprs are walked, so that elements
 *  without object (types that are not ported yet) are included. As upstream,
 *  the children of inkscape:clipboard keep their ids.
 */
function change_clashing_ids(
  imported_ids: Set<string>,
  current_ids: Set<string>,
  elem: Node,
  refmap: refmap_type,
  id_changes: id_changelist_type,
): void {
  if (elem.type() !== 'element' || elem.name() === 'inkscape:clipboard') return;
  const id = elem.attribute('id');
  // TODO: keep the id of a gradient that is equivalent to the clashing one.
  if (id && current_ids.has(id)) {
    // Choose a new ID.
    // To try to preserve any meaningfulness that the original ID
    // may have had, the new ID is the old ID followed by a hyphen
    // and one or more digits.
    let new_id = `${id}-`;
    for (;;) {
      new_id += '0123456789'[Math.floor(Math.random() * 10)];
      if (!current_ids.has(new_id) && !imported_ids.has(new_id)) break;
    }
    // Change to the new ID
    elem.setAttribute('id', new_id);
    imported_ids.add(new_id);
    // Make a note of this change, if we need to fix up refs to it
    if (refmap.has(id)) id_changes.push([new_id, id]);
  }

  // recurse
  for (let child = elem.firstChild(); child; child = child.next()) {
    change_clashing_ids(imported_ids, current_ids, child, refmap, id_changes);
  }
}

/** Fix up references to changed IDs. */
function fix_up_refs(refmap: refmap_type, id_changes: id_changelist_type): void {
  for (const [new_id, old_id] of id_changes) {
    for (const idref of refmap.get(old_id) ?? []) fix_ref(idref, new_id, old_id);
  }
}

/**
 *  This function resolves ID clashes between the document being imported
 *  and the current open document: IDs in the imported document that would
 *  clash with IDs in the existing document are changed, and references to
 *  those IDs are updated accordingly.
 */
export function prevent_id_clashes(imported_doc: SPDocument, current_doc: SPDocument): void {
  const refmap: refmap_type = new Map();
  const id_changes: id_changelist_type = [];
  find_references(imported_doc, refmap);
  change_clashing_ids(
    all_ids(imported_doc),
    all_ids(current_doc),
    imported_doc.getReprRoot(),
    refmap,
    id_changes,
  );
  fix_up_refs(refmap, id_changes);
}

/** Change any references of from_obj into to_obj */
export function change_def_references(from_obj: SPObject, to_obj: SPObject): void {
  const refmap: refmap_type = new Map();
  const old_id = from_obj.getId();
  const new_id = to_obj.getId();
  if (!old_id || !new_id) return;
  find_references(from_obj.document, refmap);
  for (const idref of refmap.get(old_id) ?? []) fix_ref(idref, new_id, old_id);
}

/**
 * Convert a string to a valid XML id: invalid characters become "_", and an id
 * that starts with a digit, a period or a dash gets an "x" in front.
 */
export function sanitize_id(input_id: string): string {
  if (input_id === '') return '_';
  const id = input_id.replace(/[^A-Za-z0-9\-_.:]/g, '_');
  return /^[0-9.-]/.test(id) ? `x${id}` : id;
}

/**
 * Whether id is a valid object id; if not, the reason as a translated message.
 * This is a subset of the valid XML 1.0 ID characters.
 */
export function is_object_id_valid(id: string): { valid: boolean; warning: string } {
  if (id === '') return { valid: false, warning: _('Invalid empty ID') };
  const c = id[0] as string;
  if (/[0-9]/.test(c)) return { valid: false, warning: _('ID cannot start with a digit') };
  if (c === '.') return { valid: false, warning: _('ID cannot start with a period') };
  if (c === '-') return { valid: false, warning: _('ID cannot start with a dash') };
  const pos = id.search(/[^A-Za-z0-9\-_.:]/);
  if (pos !== -1) {
    const warning =
      pos === 0 ? _('ID starts with an invalid character') : _('ID contains invalid characters');
    return { valid: false, warning };
  }
  return { valid: true, warning: '' };
}
