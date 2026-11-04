// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/actions/actions-svg-processing.cpp, src/actions/actions-svg-processing.h
/*
 * Actions that process the SVG of the document, mostly for the command line.
 *
 * Copyright (C) 2023 Authors
 *
 * The contents of this file may be used under the GNU General Public License Version 2 or later.
 */
import {
  N_,
  NC_,
  type Node,
  ObjectSet,
  type SPDocument,
  SPItem,
  SVGBox,
  sp_item_list_to_curves,
  sp_svg_read_pathv,
  sp_svg_write_path,
} from '@inkscape-web/core';
import { type OptRect, Scale } from '@inkscape-web/geom';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { INKSCAPE_VERSION } from './actions-base.ts';

const SECTION = NC_('Action Section', 'Processing');

/**
 * Action id, label, section and tooltip (untranslated).
 * TODO: reverse-auto-start-markers, remove-all-transforms, remove-marker-context-paint,
 * insert-text-fallback, insert-mesh-polyfill, insert-hatch-polyfill, add-strokes-to-paths and
 * insert-path-data.
 */
export const doc_svg_processing_actions: readonly (readonly [string, string, string, string])[] = [
  [
    'doc.set-svg-version-1',
    N_('Set SVG Version to 1.1'),
    SECTION,
    N_("Set the document's SVG version to 1.1"),
  ],
  [
    'doc.set-svg-version-2',
    N_('Set SVG Version to 2.0'),
    SECTION,
    N_("Set the document's SVG version to 2.0"),
  ],
  [
    'doc.set-inkscape-version',
    N_('Set Inkscape Version'),
    SECTION,
    N_('Add the Inkscape version to the document'),
  ],
  [
    'doc.prune-inkscape-namespaces',
    N_('Prune Inkscape Namespaces'),
    SECTION,
    N_('Remove any Inkscape-specific SVG data'),
  ],
  [
    'doc.prune-proprietary-namespaces',
    N_('Prune Proprietary Namespaces'),
    SECTION,
    N_('Remove any known proprietary SVG data'),
  ],
  [
    'doc.all-clones-to-objects',
    N_('Unlink All Clones'),
    SECTION,
    N_('Recursively unlink all clones and symbols'),
  ],
  [
    'doc.all-objects-to-paths',
    N_('All Objects to Paths'),
    SECTION,
    N_('Turn all shapes recursively into path elements'),
  ],
  [
    'doc.normalize-all-paths',
    N_('Normalize Path Data'),
    SECTION,
    N_('Make all paths absolute and predictable'),
  ],
  [
    'doc.insert-bounding-boxes',
    N_('Annotate all Bounding Boxes'),
    SECTION,
    N_('Annotate every shape and group with its current bounding box (not kept up to date)'),
  ],
  ['doc.vacuum-defs', N_('Clean up Document'), SECTION, N_('Remove unused definitions (gradients, etc.)')],
];

const starts = (name: string, prefix: string): boolean => name.startsWith(prefix);

/** Removes all sodipodi and inkscape elements and attributes from an xml tree; used to make plain svg output. */
export function prune_inkscape_from_node(repr: Node): void {
  if (repr.type() === 'element') {
    for (const [name] of [...repr.attributeList()]) {
      if (starts(name, 'inkscape:') || starts(name, 'sodipodi:')) repr.removeAttribute(name);
    }
  }
  const removed: Node[] = [];
  for (const child of repr.children()) {
    if (starts(child.name(), 'inkscape:') || starts(child.name(), 'sodipodi:')) removed.push(child);
    else prune_inkscape_from_node(child);
  }
  for (const child of removed) repr.removeChild(child);
}

/** Similar to the above prune, but used on all documents to remove problematic elements, e.g. Adobe's i:pgf tag. */
export function prune_proprietary_from_node(repr: Node): void {
  const removed: Node[] = [];
  for (const child of repr.children()) {
    if (starts(child.name(), 'i:pgf')) {
      removed.push(child);
      console.warn(
        'An Adobe proprietary tag was found which is known to cause issues. It was removed before saving.',
      );
    } else prune_proprietary_from_node(child);
  }
  for (const child of removed) repr.removeChild(child);
}

/** The rectangle in the form that SVGBox takes. */
const to_box = (r: OptRect) => (r ? { x0: r.left(), y0: r.top(), x1: r.right(), y1: r.bottom() } : null);

/** Appends a visual box, and an optional geometric box to each SPItem recursively (groups too). */
export function insert_bounding_boxes(item: SPItem): void {
  for (const child of item.childList()) if (child instanceof SPItem) insert_bounding_boxes(child);
  const doc_scale = item.document.getDocumentScale();
  const transform = item.i2docAffine().multiply(Scale(1 / doc_scale.x, 1 / doc_scale.y));
  const vbox = item.visualBounds(transform);
  const gbox = item.geometricBounds(transform);
  item.setAttributeOrRemoveIfEmpty('inkscape:visualbox', new SVGBox(to_box(vbox)).write());
  if (gbox && vbox ? !gbox.equals(vbox) : gbox !== vbox) {
    item.setAttributeOrRemoveIfEmpty('inkscape:geometricbox', new SVGBox(to_box(gbox)).write());
  }
}

/** Makes paths more predictable for better processing. */
export function normalize_all_paths(node: Node): void {
  const d = node.attribute('d');
  if (d) node.setAttribute('d', sp_svg_write_path(sp_svg_read_pathv(d), { normalize: true }));
  for (const child of node.children()) normalize_all_paths(child);
}

export function add_actions_processing(app: InkscapeApplication): void {
  const map = app.actions.doc;
  const run = (f: (doc: SPDocument) => void) => () => {
    const doc = app.get_active_document();
    if (doc) f(doc);
  };
  map.add_action(
    'set-svg-version-2',
    run((doc) => {
      doc.getReprRoot().setAttribute('standalone', 'no');
      doc.getReprRoot().setAttribute('version', '2.0');
    }),
  );
  map.add_action(
    'set-svg-version-1',
    run((doc) => doc.getReprRoot().setAttribute('version', '1.1')),
  );
  map.add_action(
    'set-inkscape-version',
    run((doc) => doc.getReprRoot().setAttribute('inkscape:version', `${INKSCAPE_VERSION} (web)`)),
  );
  map.add_action(
    'prune-inkscape-namespaces',
    run((doc) => prune_inkscape_from_node(doc.getReprRoot())),
  );
  map.add_action(
    'prune-proprietary-namespaces',
    run((doc) => prune_proprietary_from_node(doc.getReprRoot())),
  );
  map.add_action(
    'all-clones-to-objects',
    run((doc) => {
      const selection = new ObjectSet(doc);
      selection.set(doc.getRoot());
      selection.unlinkRecursive(true, false, true);
    }),
  );
  map.add_action(
    'all-objects-to-paths',
    run((doc) => {
      sp_item_list_to_curves([doc.getRoot()], [], []);
    }),
  );
  map.add_action(
    'normalize-all-paths',
    run((doc) => normalize_all_paths(doc.getReprRoot())),
  );
  map.add_action(
    'insert-bounding-boxes',
    run((doc) => insert_bounding_boxes(doc.getRoot())),
  );
  map.add_action(
    'vacuum-defs',
    run((doc) => void doc.vacuumDocument()),
  );
  app.get_action_extra_data().add_data(doc_svg_processing_actions);
}
