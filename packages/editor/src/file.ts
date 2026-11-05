// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/file.cpp, src/file.h
/*
 * File/Print operations: importing documents and pasting clipboard documents
 * into a desktop (opening and saving files is in the web app, apps/web/src/app/file.ts).
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Chema Celorio <chema@celorio.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Bruno Dilly <bruno.dilly@gmail.com>
 *   Stephen Silver <sasilver@users.sourceforge.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Tavmjong Bah
 *
 * Copyright (C) 2006 Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 1999-2016 Authors
 * Copyright (C) 2004 David Turner
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import {
  C_,
  DocumentUndo,
  ImportLayersMode,
  ImportRoot,
  Preferences,
  type SPDocument,
  SPGroup,
  type SPObject,
  SVG_NS_URI,
  saveBuf,
  sp_repr_lookup_name,
  type Node as XmlNode,
} from '@inkscape-web/core';
import { Point, Rect, Translate } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';

/**
 * Paste the contents of a document into the active desktop.
 * @param clipdoc The document to paste
 * @param in_place Whether to paste the selection where it was when copied
 * @pre clipdoc is not empty and items can be added to the current layer
 * TODO: on_page (pages), snapping the offset to the grid (snap_manager.multipleOfGridPitch).
 */
export function sp_import_document(
  desktop: SPDesktop,
  clipdoc: SPDocument,
  in_place: boolean,
  _on_page = false,
): void {
  const target_document = desktop.getDocument();
  const root = clipdoc.getReprRoot();
  let layer: SPGroup | null = desktop.layerManager().currentLayer();
  if (!layer) return;
  let target_parent = layer.getRepr();

  const clipboard = sp_repr_lookup_name(root, 'inkscape:clipboard', 1);

  let node_after: XmlNode | null = desktop.getSelection().topRepr();
  if (
    node_after &&
    Preferences.get().getBool('/options/paste/aboveselected', true) &&
    node_after !== target_parent
  ) {
    target_parent = node_after.parent() ?? target_parent;
    // find parent group
    for (let p: SPObject | null = target_document.getObjectByRepr(node_after.parent()); p; p = p.parent) {
      if (p instanceof SPGroup) {
        layer = p;
        break;
      }
    }
  } else {
    node_after = target_parent.lastChild();
  }

  let offset = new Point(0, 0);
  let bbox = new Rect(0, 0, 0, 0);
  if (clipboard) {
    const min = clipboard.getAttributePoint('min');
    const max = clipboard.getAttributePoint('max');
    bbox = new Rect(min, max).transformed(target_document.dt2doc());
    offset = bbox.min();
  }
  if (!in_place) {
    // Get offset from mouse pointer to bbox center
    const cursor_position = desktop.point().transformed(target_document.dt2doc());
    offset = offset.add(cursor_position.sub(bbox.midpoint()));
  }
  const transform = Translate(offset);

  // copy objects
  const pasted_objects = target_document.import(clipdoc, layer.getRepr(), node_after, transform);

  target_document.ensureUpToDate();
  // Change the selection to the freshly pasted objects
  desktop.getSelection().setReprList(pasted_objects);
}

/**
 * Import a document (opened from a file, or an image from the clipboard) into
 * in_doc at the pointer (or drop_pos), in the current layer, and select it,
 * with the undo step "Import". An SVG document becomes one group, an image
 * document its image (upstream file_import, after Inkscape::Extension::open).
 * TODO: /dialogs/import/import_mode_svg ("new", "link", "embed" as image), pages.
 */
export function file_import(
  in_doc: SPDocument,
  doc: SPDocument,
  is_svg: boolean,
  desktop: SPDesktop | null,
  drop_pos: Point | null = null,
): SPObject | null {
  // Store mouse pointer location before opening any dialogs, so we can drop the item where initially intended.
  const pointer_location = drop_pos ?? desktop?.point() ?? new Point(0, 0);

  // Determine the place to insert the new object.
  // This will be the current layer, if possible.
  const place_to_insert: SPObject = desktop?.layerManager().currentLayer() ?? in_doc.getRoot();

  doc.ensureUpToDate();
  const bbox = doc.getRoot().desktopPreferredBounds() ?? new Rect(0, 0, 0, 0);
  const bbox_doc = bbox.transformed(doc.dt2doc());
  const transform = Translate(pointer_location.transformed(in_doc.dt2doc()).sub(bbox_doc.midpoint()));

  const result = in_doc.import(
    doc,
    place_to_insert.getRepr(),
    null,
    transform,
    is_svg ? ImportRoot.Single : ImportRoot.UngroupSingle, // remove groups for imported bitmap images
    ImportLayersMode.ToGroup,
  );

  const import_root = result.length ? in_doc.getObjectByRepr(result[0] ?? null) : null;
  desktop?.getSelection().setReprList(result);
  DocumentUndo.done(in_doc, C_('Undo', 'Import'), 'document-import');
  return import_root;
}

/**
 * The file name of a template (upstream sp_file_save_template: Glib::uri_escape_string(name,
 * " ", true) and ".svg"): characters other than letters, numbers, "-._~", spaces and UTF-8 are
 * escaped.
 */
export function sp_file_template_filename(name: string): string {
  const escapeChar = (c: string) =>
    encodeURIComponent(c).replace(/[!'()*]/g, (x) => `%${x.charCodeAt(0).toString(16).toUpperCase()}`);
  const escaped = [...name]
    .map((c) => (/[A-Za-z0-9\-._~ ]/.test(c) || c.charCodeAt(0) > 127 ? c : escapeChar(c)))
    .join('');
  return `${escaped}.svg`;
}

/**
 * The SVG text that saves the document as a template (upstream sp_file_save_template): the
 * document with a node inkscape:templateinfo for the time of saving. The caller stores the
 * text under sp_file_template_filename(name) and, for the default template, as "default.svg".
 * Null if name is empty.
 */
export function sp_file_template_svg(
  document: SPDocument,
  name: string,
  author: string,
  description: string,
  keywords: string,
  date = new Date(),
): string | null {
  if (name.length === 0) return null;

  return DocumentUndo.scopedInsensitive(document, () => {
    const root = document.getReprRoot();
    const xml_doc = document.getReprDoc();

    const templateinfo_node = xml_doc.createElement('inkscape:templateinfo');
    const add = (tag: string, text: string) => {
      const element_node = xml_doc.createElement(tag);
      element_node.appendChild(xml_doc.createTextNode(text));
      templateinfo_node.appendChild(element_node);
    };

    add('inkscape:name', name);
    if (author.length !== 0) add('inkscape:author', author);
    if (description.length !== 0) add('inkscape:shortdesc', description);
    const p2 = (n: number) => String(n).padStart(2, '0');
    add('inkscape:date', `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`);
    if (keywords.length !== 0) add('inkscape:keywords', keywords);

    root.appendChild(templateinfo_node);
    const text = saveBuf(document.rdoc, SVG_NS_URI);
    // remove this node from current document after saving it as template
    root.removeChild(templateinfo_node);
    return text;
  });
}
