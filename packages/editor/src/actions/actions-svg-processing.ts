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
  emptyOptionalTextTagAttrs,
  hatch_polyfill,
  item_find_paths,
  item_to_paths,
  mesh_polyfill,
  N_,
  NC_,
  type Node,
  ObjectSet,
  type SPDocument,
  SPItem,
  SPString,
  SPText,
  SPTextAnchor,
  SVGBox,
  sp_item_list_to_curves,
  sp_repr_lookup_descendant,
  sp_repr_lookup_name,
  sp_repr_lookup_property_many,
  sp_svg_read_pathv,
  sp_svg_write_path,
  spReprCssAttr,
  spReprCssAttrInherited,
  spReprCssProperty,
  spReprCssSet,
  spReprCssSetProperty,
  spReprCssUnsetProperty,
  TextTagAttributes,
} from '@inkscape-web/core';
import { type OptRect, Scale } from '@inkscape-web/geom';
import type { InkscapeApplication } from '../inkscape-application.ts';
import { INKSCAPE_VERSION } from './actions-base.ts';

const SECTION = NC_('Action Section', 'Processing');

/**
 * Action id, label, section and tooltip (untranslated).
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
    'doc.reverse-auto-start-markers',
    N_('Reverse Auto Start Markers'),
    SECTION,
    N_('Remove auto start positions from markers'),
  ],
  [
    'doc.remove-all-transforms',
    N_('Try to Remove All Transforms'),
    SECTION,
    N_('Attempt to remove all transforms from all shapes'),
  ],
  [
    'doc.remove-marker-context-paint',
    N_('Remove Marker Context Paint'),
    SECTION,
    N_('Remove context paints from markers'),
  ],
  [
    'doc.insert-mesh-polyfill',
    N_('Insert Mesh Polyfill'),
    SECTION,
    N_('Insert JavaScript for rendering meshes'),
  ],
  [
    'doc.insert-hatch-polyfill',
    N_('Insert Hatch Polyfill'),
    SECTION,
    N_('Insert JavaScript for rendering hatches'),
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
    'doc.add-strokes-to-paths',
    N_('All Strokes to Paths'),
    SECTION,
    N_('Turn all strokes recursively into fill-only paths'),
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
  [
    'doc.insert-path-data',
    N_('Annotate all Shape Paths'),
    SECTION,
    N_('Annotate every non-path shape with their equivalent path string (not kept up to date)'),
  ],
  ['doc.vacuum-defs', N_('Clean up Document'), SECTION, N_('Remove unused definitions (gradients, etc.)')],
  ['doc.insert-text-fallback', N_('Insert Text Fallback'), SECTION, N_('Replace SVG2 text with SVG1.1 text')],
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

/** The child of repr with the attribute set to value (upstream sp_repr_lookup_child). */
function lookup_child(repr: Node, key: string, value: string): Node | null {
  for (let child = repr.firstChild(); child; child = child.next()) {
    if (child.attribute(key) === value) return child;
  }
  return null;
}

/**
 * Create new markers where necessary to simulate the SVG 2 marker attribute 'orient' value
 * 'auto-start-reverse'; property is 'marker' or 'marker-start' (upstream remove_marker_auto_start_reverse).
 */
function remove_marker_auto_start_reverse(repr: Node, defs: Node, property: string): void {
  for (let child = repr.firstChild(); child; child = child.next()) {
    remove_marker_auto_start_reverse(child, defs, property);
  }
  const css = spReprCssAttr(repr, 'style');
  const value = spReprCssProperty(css, property, '');
  if (value === '') return;
  // Find reference <marker>
  const marker_name = /url\(#([^)]*)\)/.exec(value)?.[1];
  const marker = marker_name ? lookup_child(defs, 'id', marker_name) : null;
  if (!marker_name || !marker) return;
  // Does marker use "auto-start-reverse"?
  if (!(marker.attribute('orient') ?? '').startsWith('auto-start-reverse')) return;

  // See if a reversed marker already exists.
  const marker_name_reversed = `${marker_name}_reversed`;
  if (!lookup_child(defs, 'id', marker_name_reversed)) {
    // No reversed marker, need to create!
    const marker_reversed = repr.document().createElement('svg:marker');
    // Copy attributes
    for (const [name, attr_value] of marker.attributeList()) marker_reversed.setAttribute(name, attr_value);
    // Override attributes
    marker_reversed.setAttribute('id', marker_name_reversed);
    marker_reversed.setAttribute('orient', 'auto');
    // Find transform
    const refX = marker_reversed.attribute('refX');
    const refY = marker_reversed.attribute('refY');
    let transform = 'rotate(180';
    if (refX) {
      transform += `,${refX}`;
      if (refY) transform += `,${refY}`;
    }
    transform += ')';
    // We can't set a transform on a marker... must create group first.
    const group = repr.document().createElement('svg:g');
    group.setAttribute('transform', transform);
    marker_reversed.addChild(group, null);
    // Copy all marker content to group.
    for (let child = marker.firstChild(); child; child = child.next()) {
      group.addChild(child.duplicate(repr.document()), null);
    }
    // Add new marker to <defs>.
    defs.addChild(marker_reversed, marker);
  }

  // Change url to reference reversed marker.
  spReprCssSetProperty(css, 'marker-start', `url(#${marker_name_reversed})`);
  // Also fix up if property is marker shorthand.
  if (property === 'marker') {
    spReprCssUnsetProperty(css, 'marker');
    spReprCssSetProperty(css, 'marker-mid', `url(#${marker_name})`);
    spReprCssSetProperty(css, 'marker-end', `url(#${marker_name})`);
  }
  spReprCssSet(repr, css, 'style');
}

/** Called by remove_marker_context_paint() for each property value ("marker", "marker-start", ...). */
function remove_marker_context_paint_property(repr: Node, defs: Node, property: string): void {
  // Value of 'marker', 'marker-start', ... property.
  const value = `url(#${repr.attribute('id')})`;
  // Generate a list of elements that reference this marker.
  for (const it of sp_repr_lookup_property_many(repr.root() ?? repr, property, value)) {
    // Figure out value of fill... could be inherited.
    const css = spReprCssAttrInherited(it, 'style');
    const fill = spReprCssProperty(css, 'fill', '');
    const stroke = spReprCssProperty(css, 'stroke', '');

    // Name of new marker.
    let marker_fixed_id = repr.attribute('id') ?? '';
    if (fill !== '') marker_fixed_id += `_F${fill}`;
    if (stroke !== '') marker_fixed_id += `_S${stroke}`;
    // Replace characters from color value that are invalid in ids
    marker_fixed_id = marker_fixed_id.replace(/[#%]/g, '-').replace(/[(), \n\t\r]/g, '.');

    // See if a fixed marker already exists.
    // Could be more robust, assumes markers are direct children of <defs>.
    if (!lookup_child(defs, 'id', marker_fixed_id)) {
      // Need to create new marker.
      const marker_fixed = repr.duplicate(repr.document());
      marker_fixed.setAttribute('id', marker_fixed_id);
      // This needs to be turned into a function that fixes all descendants.
      for (let child = marker_fixed.firstChild(); child; child = child.next()) {
        const child_css = spReprCssAttr(child, 'style');
        const fill2 = spReprCssProperty(child_css, 'fill', '');
        if (fill2 === 'context-fill') spReprCssSetProperty(child_css, 'fill', fill);
        if (fill2 === 'context-stroke') spReprCssSetProperty(child_css, 'fill', stroke);
        const stroke2 = spReprCssProperty(child_css, 'stroke', '');
        if (stroke2 === 'context-fill') spReprCssSetProperty(child_css, 'stroke', fill);
        if (stroke2 === 'context-stroke') spReprCssSetProperty(child_css, 'stroke', stroke);
        spReprCssSet(child, child_css, 'style');
      }
      defs.addChild(marker_fixed, repr);
    }
    spReprCssSetProperty(css, property, `url(#${marker_fixed_id})`);
    spReprCssSet(it, css, 'style');
  }
}

/** Replace the context-fill and context-stroke of the markers with the paint of the shapes that use them. */
function remove_marker_context_paint(repr: Node, defs: Node): void {
  for (let child = repr.firstChild(); child; child = child.next()) remove_marker_context_paint(child, defs);
  if (!repr.name().startsWith('svg:marker')) return;
  if (!repr.attribute('id')) {
    console.error("remove_marker_context_paint: <marker> without 'id'!");
    return;
  }
  // First see if we need to do anything.
  let need_to_fix = false;
  // This needs to be turned into a function that searches all descendants.
  for (let child = repr.firstChild(); child; child = child.next()) {
    const css = spReprCssAttr(child, 'style');
    const fill = spReprCssProperty(css, 'fill', '');
    const stroke = spReprCssProperty(css, 'stroke', '');
    if (['context-fill', 'context-stroke'].some((v) => v === fill || v === stroke)) {
      need_to_fix = true;
      break;
    }
  }
  if (need_to_fix) {
    // Now we need to search document for all elements that use this marker.
    for (const property of ['marker', 'marker-start', 'marker-mid', 'marker-end']) {
      remove_marker_context_paint_property(repr, defs, property);
    }
  }
}

/** Insert the JavaScript that renders meshes or hatches, if the defs have one (upstream insert_mesh_polyfill, insert_hatch_polyfill). */
function insert_polyfill(repr: Node, kind: 'mesh' | 'hatch', js: string): void {
  const defs = sp_repr_lookup_name(repr, 'svg:defs');
  // We always put meshes and hatches in <defs>, no defs -> no mesh.
  if (!defs) return;
  const has_paint = [...defs.children()].some((child) => child.name().startsWith(`svg:${kind}`));
  if (!has_paint || sp_repr_lookup_descendant(repr, 'id', `${kind}_polyfill`)) return;
  const script = repr.document().createElement('svg:script');
  script.setAttribute('id', `${kind}_polyfill`);
  script.setAttribute('type', 'text/javascript');
  (repr.root() ?? repr).appendChild(script); // Must be last
  script.appendChild(repr.document().createTextNode(js));
}

/** Appends the shape path, if available, to any SPShape recursively (upstream insert_path_data). */
export function insert_path_data(item: SPItem): void {
  const paths = item_find_paths(item);
  if (paths) {
    item.setAttribute('inkscape:d', paths.fill);
  } else {
    for (const child of item.childList()) if (child instanceof SPItem) insert_path_data(child);
  }
}

/** Makes paths more predictable for better processing. */
export function normalize_all_paths(node: Node): void {
  const d = node.attribute('d');
  if (d) node.setAttribute('d', sp_svg_write_path(sp_svg_read_pathv(d), { normalize: true }));
  for (const child of node.children()) normalize_all_paths(child);
}

/**
 * Recursively insert SVG 1.1 fallback for SVG 2 text (ignored by SVG 2 renderers including ours):
 * the children of each text with inline-size or shape-inside are replaced by
 * one tspan with x and y per line of the layout.
 * Notes:
 *   Text must have been layed out.
 */
export function insert_text_fallback(repr: Node | null, doc: SPDocument): void {
  if (!repr) return;
  if (repr.name() === 'svg:text') {
    // We need to get the SPText object to access layout.
    const text = doc.getObjectByRepr(repr);
    if (!(text instanceof SPText)) {
      console.error('insert_text_fallback: bad cast');
      return;
    }
    if (!text.has_inline_size() && !text.has_shape_inside()) {
      // No SVG 2 text, nothing to do.
      return;
    }

    // We will keep this text node but replace all children.
    // Text object must be visible for the text calculatons to work
    const was_hidden = text.isHidden();
    text.setHidden(false);
    text.rebuildLayout();
    const layout = text.layout;
    const xml_doc = doc.getReprDoc();

    // For text in a shape, We need to unset 'text-anchor' or SVG 1.1 fallback won't work.
    if (text.has_shape_inside()) {
      const css = spReprCssAttr(repr, 'style');
      spReprCssUnsetProperty(css, 'text-anchor');
      spReprCssSet(repr, css, 'style');
    }

    // We need to put trailing white space into its own tspan for inline size so
    // it is excluded during calculation of line position in SVG 1.1 renderers.
    const trim =
      text.has_inline_size() && text.style.text_anchor.computed !== SPTextAnchor.SP_CSS_TEXT_ANCHOR_START;

    // Make a list of children to delete at end:
    const old_children = [...repr.children()];

    // For round-tripping, xml:space (or 'white-space:pre') must be set.
    repr.setAttribute('xml:space', 'preserve');

    const text_x = repr.getAttributeDouble('x', 0.0);
    const text_y = repr.getAttributeDouble('y', 0.0);

    // Loop over all lines in layout.
    let it = layout.begin();
    while (!it.equals(layout.end())) {
      // Create a <tspan> with 'x' and 'y' for each line.
      const line_tspan = xml_doc.createElement('svg:tspan');

      // Hide overflow tspan (one line of text).
      if (layout.isHidden(it)) line_tspan.setAttribute('style', 'visibility:hidden');

      const line_anchor_point = layout.characterAnchorPoint(it);
      const line_x = line_anchor_point.x;
      const line_y = line_anchor_point.y;

      if (text.is_horizontal()) {
        // With inline-size, text_x is the reference for 'text-anchor' (line_x is the start
        // of the line which gives wrong position when 'text-anchor' not start); with
        // shape-inside we don't have to worry about 'text-anchor'.
        line_tspan.setAttributeSvgDouble('x', text.has_inline_size() ? text_x : line_x);
        line_tspan.setAttributeSvgDouble('y', line_y); // FIXME: this will pick up the wrong end of counter-directional runs
      } else {
        line_tspan.setAttributeSvgDouble('x', line_x); // FIXME: this will pick up the wrong end of counter-directional runs
        line_tspan.setAttributeSvgDouble('y', text.has_inline_size() ? text_y : line_y);
      }

      // Inside line <tspan>, create <tspan>s for each change of style or shift. (No shifts in SVG 2 flowed text.)
      // For simple lines, this creates an unneeded <tspan> but so be it.
      const it_line_end = it.copy();
      it_line_end.nextStartOfLine();

      // Find last span in line so we can put trailing whitespace in its own tspan for SVG 1.1 fallback.
      const it_last_span = it.copy();
      it_last_span.nextStartOfLine();
      it_last_span.prevStartOfSpan();

      let trailing_whitespace = '';

      // Loop over chunks in line
      while (!it.equals(it_line_end)) {
        let span_tspan = xml_doc.createElement('svg:tspan');

        // use kerning to simulate justification and whatnot
        const it_span_end = it.copy();
        it_span_end.nextStartOfSpan();
        const attrs = emptyOptionalTextTagAttrs();
        layout.simulateLayoutUsingKerning(it, it_span_end, attrs);

        // 'dx' and 'dy' attributes are used to simulated justified text.
        if (!text.is_horizontal()) [attrs.dx, attrs.dy] = [attrs.dy, attrs.dx];
        const tag = new TextTagAttributes();
        tag.attributes = attrs;
        tag.writeTo(span_tspan);
        const { source: source_obj, text_offset: start } = layout.getSourceOfCharacter(it);

        // Set tspan style
        const style_obj = source_obj instanceof SPString ? source_obj.parent : source_obj;
        const style_text = style_obj?.style.writeIfDiff(text.style) ?? '';
        if (style_text) span_tspan.setAttributeOrRemoveIfEmpty('style', style_text);

        // If this tspan has no attributes, discard it and add content directly to parent element.
        if (span_tspan.attributeList().length === 0) span_tspan = line_tspan;
        else line_tspan.appendChild(span_tspan);

        // Add text node
        if (source_obj instanceof SPString) {
          const string = source_obj.string;
          let { source: span_end_obj, text_offset: end } = layout.getSourceOfCharacter(it_span_end);
          if (span_end_obj !== source_obj) {
            if (it_span_end.equals(layout.end())) {
              const n = layout.iteratorToCharIndex(it_span_end) - layout.iteratorToCharIndex(it);
              end = start + [...string.slice(start)].slice(0, n).join('').length;
            } else {
              end = string.length; // spans will never straddle a source boundary
            }
          }
          span_end_obj = null;
          if (start !== end) {
            let new_string = string.slice(start, end);
            if (it.equals(it_last_span) && trim) {
              // Found last span in line
              const s = new_string.search(/[ \t]*$/); // Any other white space characters needed?
              trailing_whitespace = new_string.slice(s);
              new_string = new_string.slice(0, s);
            }
            span_tspan.appendChild(xml_doc.createTextNode(new_string));
          }
        }
        it = it_span_end;
      }

      // Add line tspan to document
      repr.appendChild(line_tspan);

      // For center and end justified text, we need to remove any spaces and put them
      // into a separate tspan (alignment is done by "text chunk" and spaces at ends of
      // line will mess this up).
      if (trim && trailing_whitespace.length !== 0) {
        const space_tspan = xml_doc.createElement('svg:tspan');
        // Set either 'x' or 'y' to force a new text chunk. To do: this really should
        // be positioned at the end of the line (overhanging).
        if (text.is_horizontal()) space_tspan.setAttributeSvgDouble('y', line_y);
        else space_tspan.setAttributeSvgDouble('x', line_x);
        space_tspan.appendChild(xml_doc.createTextNode(trailing_whitespace));
        line_tspan.appendChild(space_tspan);
      }
    }

    for (const i of old_children) repr.removeChild(i);

    text.setHidden(was_hidden);
    return; // No need to look at children of <text>
  }

  for (const child of [...repr.children()]) insert_text_fallback(child, doc);
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
    'reverse-auto-start-markers',
    run((doc) => {
      const defs = doc.getDefs()?.getRepr();
      if (!defs) return;
      // Do marker start for efficiency reasons
      remove_marker_auto_start_reverse(doc.getReprRoot(), defs, 'marker-start');
      remove_marker_auto_start_reverse(doc.getReprRoot(), defs, 'marker');
    }),
  );
  map.add_action(
    'remove-all-transforms',
    run((doc) => doc.getRoot().removeTransformsRecursively(doc.getRoot())),
  );
  map.add_action(
    'remove-marker-context-paint',
    run((doc) => {
      const defs = doc.getDefs()?.getRepr();
      if (defs) remove_marker_context_paint(doc.getReprRoot(), defs);
    }),
  );
  map.add_action(
    'insert-mesh-polyfill',
    run((doc) => insert_polyfill(doc.getReprRoot(), 'mesh', mesh_polyfill)),
  );
  map.add_action(
    'insert-hatch-polyfill',
    run((doc) => insert_polyfill(doc.getReprRoot(), 'hatch', hatch_polyfill)),
  );
  map.add_action(
    'add-strokes-to-paths',
    run((doc) => void item_to_paths(doc.getRoot())),
  );
  map.add_action(
    'insert-path-data',
    run((doc) => insert_path_data(doc.getRoot())),
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
  map.add_action(
    'insert-text-fallback',
    run((doc) => insert_text_fallback(doc.getReprRoot(), doc)),
  );
  app.get_action_extra_data().add_data(doc_svg_processing_actions);
}
