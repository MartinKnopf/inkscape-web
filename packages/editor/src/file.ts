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
