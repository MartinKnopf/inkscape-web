// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/text-editing.cpp, src/text-editing.h
/*
 * Authors:
 *   bulia byak
 *   Richard Hughes
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004-5 authors
 */
import { type Affine, Point } from '@inkscape-web/geom';
import type { Layout, LayoutIterator } from './libnrtype/Layout-TNG.ts';
import { SPFlowdiv, SPFlowline, SPFlowpara, SPFlowregionbreak, SPFlowtspan } from './object/sp-flowdiv.ts';
import { SPFlowregion, SPFlowregionExclude } from './object/sp-flowregion.ts';
import { SPFlowtext } from './object/sp-flowtext.ts';
import { SPItem } from './object/sp-item.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from './object/sp-object.ts';
import { SPString } from './object/sp-string.ts';
import { SPText } from './object/sp-text.ts';
import { SP_TSPAN_ROLE_LINE, SP_TSPAN_ROLE_UNSPECIFIED, SPTSpan } from './object/sp-tspan.ts';
import { TextTagAttributes } from './object/text-tag-attributes.ts';
import { SP_STYLE_FLAG_ALWAYS, type SPStyle, SPStyle as SPStyleClass } from './style.ts';
import type { XmlDocument } from './xml/document.ts';
import type { Node } from './xml/node.ts';
import { spReprCssAttr, spReprCssAttrInherited, spReprCssChange } from './xml/repr-css.ts';
import { sp_repr_is_meta_element } from './xml/repr-util.ts';

/** The result of sp_te_delete(): the real start and end of the deletion (upstream iterator_pair). */
export interface IteratorPair {
  first: LayoutIterator;
  second: LayoutIterator;
}

/** The layout of a text or flowed text item, or null. */
export function te_get_layout(item: SPObject | null): Layout | null {
  if (item instanceof SPText || item instanceof SPFlowtext) return item.layout;
  return null;
}

function te_update_layout_now(item: SPItem): void {
  if (item instanceof SPText || item instanceof SPFlowtext) item.rebuildLayout();
  item.updateRepr();
}

/** Rebuild the layout of the text items in item (recursively in groups) and write their reprs. */
export function te_update_layout_now_recursive(item: SPItem): void {
  if (item instanceof SPText || item instanceof SPFlowtext) item.rebuildLayout();
  else for (const child of item.children) if (child instanceof SPItem) te_update_layout_now_recursive(child);
  item.updateRepr();
}

/** Returns true if there are no visible characters on the canvas. */
export function sp_te_output_is_empty(item: SPItem): boolean {
  const layout = te_get_layout(item);
  return !layout || layout.begin().equals(layout.end());
}

/** Returns true if the user has typed nothing in the text box. */
export function sp_te_input_is_empty(item: SPObject): boolean {
  if (item instanceof SPString) return item.string === '';
  return item.children.every((child) => sp_te_input_is_empty(child));
}

/** The cursor position nearest to i_p (desktop coordinates). */
export function sp_te_get_position_by_coords(item: SPItem, i_p: Point): LayoutIterator {
  const p = i_p.transformed(item.i2dtAffine().inverse());
  return te_get_layout(item)!.getNearestCursorPositionTo(p);
}

/** The selection quads between start and end, transformed by transform. */
export function sp_te_create_selection_quads(
  item: SPItem,
  start: LayoutIterator,
  end: LayoutIterator,
  transform: Affine,
): Point[] {
  if (start.equals(end)) return [];
  const layout = te_get_layout(item);
  return layout ? layout.createSelectionShape(start, end, transform) : [];
}

/** The cursor line at position: p0 at the bottom, p1 at the top (item coordinates). */
export function sp_te_get_cursor_coords(item: SPItem, position: LayoutIterator): { p0: Point; p1: Point } {
  const layout = te_get_layout(item)!;
  const { position: p0, height, rotation } = layout.queryCursorShape(position);
  const p1 = p0.add(new Point(height * Math.sin(rotation), -height * Math.cos(rotation)));
  return { p0, p1 };
}

/** The style at position: of the object of the character (not the string). */
export function sp_te_style_at_position(text: SPItem, position: LayoutIterator): SPStyle | null {
  return sp_te_object_at_position(text, position)?.style ?? null;
}

/** The object of the character at position (not a string), or text. */
export function sp_te_object_at_position(text: SPItem, position: LayoutIterator): SPObject | null {
  const layout = te_get_layout(text);
  if (!layout) return null;
  let pos_obj = layout.getSourceOfCharacter(position).source ?? text;
  // not interested in SPStrings
  while (pos_obj instanceof SPString && pos_obj.parent) pos_obj = pos_obj.parent;
  return pos_obj;
}

// ***************************************************************************************
//                             I N S E R T I N G   T E X T

/**
 * Whether object is a line break: the text itself, a tspan with
 * sodipodi:role="line", a flowDiv, flowPara, flowLine or flowRegionBreak.
 * TODO: textPath.
 */
export function is_line_break_object(object: SPObject | null): boolean {
  return (
    object instanceof SPText ||
    (object instanceof SPTSpan && object.role !== SP_TSPAN_ROLE_UNSPECIFIED) ||
    object instanceof SPFlowdiv ||
    object instanceof SPFlowpara ||
    object instanceof SPFlowline ||
    object instanceof SPFlowregionbreak
  );
}

/** The attributes of a text, tspan, tref or textpath object, or null. */
function attributes_for_object(object: SPObject | null): TextTagAttributes | null {
  if (object instanceof SPTSpan || object instanceof SPText) return object.attributes;
  return null;
}

function span_name_for_text_object(object: SPObject): string | null {
  if (object instanceof SPText) return 'svg:tspan';
  if (object instanceof SPFlowtext) return 'svg:flowSpan';
  return null;
}

/** Number of code points of s (the character count of upstream Glib::ustring). */
function ulength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * Recursively gets the length of all the SPStrings at or below the given
 * item. Also adds 1 for each line break encountered.
 */
export function sp_text_get_length(item: SPObject): number {
  if (item instanceof SPString) return ulength(item.string);
  let length = is_line_break_object(item) ? 1 : 0;
  for (const child of item.children) length += sp_text_get_length(child);
  return length;
}

/**
 * Recursively gets the length of all the SPStrings at or below the given
 * item, before and not including upto. Also adds 1 for each line break encountered.
 */
export function sp_text_get_length_upto(item: SPObject, upto: SPObject | null): number {
  // The string is the lowest level and the length can be counted directly.
  if (item instanceof SPString) return ulength(item.string);
  let length = 0;
  // Take care of new lines...
  if (is_line_break_object(item) && !(item instanceof SPText) && item !== item.parent?.firstChild()) {
    length++; // add 1 for each newline
  }
  // Count the length of the children
  for (const child of item.children) {
    if (upto && child === upto) return length; // hit upto, return immediately
    if (child instanceof SPString) {
      length += ulength(child.string);
    } else if (upto && child.isAncestorOf(upto)) {
      // upto is below us, recurse and break loop
      return length + sp_text_get_length_upto(child, upto);
    } else {
      // recurse and go to the next sibling
      length += sp_text_get_length_upto(child, upto);
    }
  }
  return length;
}

function duplicate_node_without_children(xml_doc: XmlDocument, old_node: Node): Node | null {
  switch (old_node.type()) {
    case 'element': {
      const new_node = xml_doc.createElement(old_node.name());
      for (const [key, value] of old_node.attributeList()) {
        if (key !== 'id') new_node.setAttribute(key, value);
      }
      return new_node;
    }
    case 'text':
      return xml_doc.createTextNode(old_node.content() ?? '');
    case 'comment':
      return xml_doc.createComment(old_node.content() ?? '');
    default:
      return null;
  }
}

/** Returns the sum of the (recursive) lengths of all the SPStrings prior to item at the same level. */
function sum_sibling_text_lengths_before(item: SPObject): number {
  let char_index = 0;
  for (const sibling of item.parent?.children ?? []) {
    if (sibling === item) break;
    char_index += sp_text_get_length(sibling);
  }
  return char_index;
}

/** Splits the attributes for the first object at char_index and moves the ones after that point into second_item. */
function split_attributes(first_item: SPObject, second_item: SPObject | null, char_index: number): void {
  const first_attrs = attributes_for_object(first_item);
  const second_attrs = attributes_for_object(second_item);
  if (first_attrs && second_attrs) first_attrs.split(char_index, second_attrs);
}

/**
 * Recursively divides the XML node tree into two objects: the original will
 * contain all objects up to and including split_obj and the returned value
 * will be the new leaf which represents the copy of split_obj and extends
 * down the tree with new elements all the way to the common root which is the
 * parent of the first line break node encountered.
 */
function split_text_object_tree_at(split_obj: SPObject, char_index: number): SPObject | null {
  const xml_doc = split_obj.document.getReprDoc();
  if (is_line_break_object(split_obj)) {
    const new_node = duplicate_node_without_children(xml_doc, split_obj.getRepr());
    if (!new_node || !split_obj.parent) return null;
    split_obj.parent.getRepr().addChild(new_node, split_obj.getRepr());
    split_attributes(split_obj, split_obj.getNext(), char_index);
    return split_obj.getNext();
  }
  if (
    !(split_obj instanceof SPTSpan) &&
    !(split_obj instanceof SPFlowtspan) &&
    !(split_obj instanceof SPString)
  ) {
    console.error('split_text_object_tree_at: Illegal split object type! (Illegal document structure.)');
    return null;
  }

  const char_count_before = sum_sibling_text_lengths_before(split_obj);
  if (!split_obj.parent) return null;
  const duplicate_obj = split_text_object_tree_at(split_obj.parent, char_index + char_count_before);
  // Illegal document structure (no line break object).
  if (!duplicate_obj) return null;

  // copy the split node
  const new_node = duplicate_node_without_children(xml_doc, split_obj.getRepr());
  if (!new_node) return null;
  duplicate_obj.getRepr().appendChild(new_node);

  // sort out the copied attributes (x/y/dx/dy/rotate)
  split_attributes(split_obj, duplicate_obj.firstChild(), char_index);

  // then move all the subsequent nodes
  let next: SPObject | null = split_obj.getNext();
  while (next) {
    const move_repr = next.getRepr();
    const next_obj = next.getNext(); // this is about to become invalidated by removeChild()
    next.parent?.getRepr().removeChild(move_repr);
    duplicate_obj.getRepr().appendChild(move_repr);
    next = next_obj;
  }
  return duplicate_obj.firstChild();
}

/**
 * Inserts a new line break at the given position in a text or flowtext
 * object. If the position is in the middle of a span, the XML tree must be
 * chopped in two such that the line can be created at the root of the text
 * element. Returns an iterator pointing just after the inserted break.
 * TODO: tref (cloned character data cannot be edited), textPath.
 */
export function sp_te_insert_line(text: SPItem, position: LayoutIterator): LayoutIterator {
  const layout = te_get_layout(text);
  if (!layout) return position;
  position = position.copy();

  // If this is plain SVG 1.1 text object without a tspan with sodipodi:role="line", we need
  // to wrap it or our custom line breaking code won't work!
  if (text instanceof SPText && !text.has_shape_inside() && !text.has_inline_size()) {
    const need_to_wrap = !text.children.some((c) => c instanceof SPTSpan && c.role === SP_TSPAN_ROLE_LINE);
    if (need_to_wrap) {
      // We'll need to rebuild layout, so store character position:
      const char_index = layout.iteratorToCharIndex(position);
      // Create wrapping tspan.
      const text_repr = text.getRepr();
      const new_tspan_repr = text_repr.document().createElement('svg:tspan');
      new_tspan_repr.setAttribute('sodipodi:role', 'line');
      // Move text content to tspan and add tspan to text object.
      // To do: This moves <desc> and <title> too.
      move_child_nodes(text_repr, new_tspan_repr);
      text_repr.appendChild(new_tspan_repr);
      // Need to find new iterator.
      text.rebuildLayout();
      position = layout.charIndexToIterator(char_index);
    }
  }

  let split_obj: SPObject | null = null;
  let split_text_offset = 0;
  if (!position.equals(layout.end())) {
    const src = layout.getSourceOfCharacter(position);
    split_obj = src.source;
    split_text_offset = src.text_offset;
  }

  if (split_obj === null || is_line_break_object(split_obj)) {
    split_obj ??= text.lastChild();
    if (split_obj) {
      const xml_doc = split_obj.document.getReprDoc();
      const new_node = duplicate_node_without_children(xml_doc, split_obj.getRepr());
      // if we finally go to a text element without TSpan we mist set content to none
      if (new_node && split_obj.parent) split_obj.parent.getRepr().addChild(new_node, split_obj.getRepr());
    }
  } else if (split_obj instanceof SPString) {
    const string = split_obj.string;
    const char_index = ulength(string.slice(0, split_text_offset));
    // we need to split the entire text tree into two
    const object = split_text_object_tree_at(split_obj, char_index);
    // Illegal document structure
    if (!object) return position;
    object.getRepr().setContent(string.slice(split_text_offset));
    split_obj.string = string.slice(0, split_text_offset);
    split_obj.getRepr().setContent(split_obj.string);
    // TODO: if the split point was at the beginning of a span we have a whole load of empty elements to clean up
  }

  const char_index = layout.iteratorToCharIndex(position);
  te_update_layout_now(text);
  text.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  return layout.charIndexToIterator(char_index + 1);
}

/** Finds the first SPString after the given position, including children, excluding parents. */
function sp_te_seek_next_string_recursive(start_obj: SPObject | null): SPString | null {
  while (start_obj) {
    if (start_obj.hasChildren()) {
      const found = sp_te_seek_next_string_recursive(start_obj.firstChild());
      if (found) return found;
    }
    if (start_obj instanceof SPString) return start_obj;
    start_obj = start_obj.getNext();
    if (is_line_break_object(start_obj)) break; // don't cross line breaks
  }
  return null;
}

/**
 * Inserts the given characters into the given string (at code unit offset
 * iter_at) and inserts corresponding new x/y/dx/dy/rotate attributes into all its parents.
 */
function insert_into_spstring(string_item: SPString, iter_at: number, utf8: string): void {
  let char_index = ulength(string_item.string.slice(0, iter_at));
  const char_count = ulength(utf8);
  string_item.string = string_item.string.slice(0, iter_at) + utf8 + string_item.string.slice(iter_at);

  let parent_item: SPObject = string_item;
  for (;;) {
    char_index += sum_sibling_text_lengths_before(parent_item);
    if (!parent_item.parent) break;
    parent_item = parent_item.parent;
    const attributes = attributes_for_object(parent_item);
    if (!attributes) break;
    attributes.insert(char_index, char_count);
  }
}

/**
 * Inserts the given text into a text or flowroot object. Line breaks
 * cannot be inserted using this function, see sp_te_insert_line(). Returns
 * an iterator pointing just after the inserted text.
 */
export function sp_te_insert(item: SPItem, position: LayoutIterator, utf8: string): LayoutIterator {
  const layout = te_get_layout(item);
  if (!layout) return position;
  // we want to insert after the previous char, not before the current char.
  // it makes a difference at span boundaries
  const it_prev_char = position.copy();
  const cursor_at_start = !it_prev_char.prevCharacter();
  const cursor_at_end = position.equals(layout.end());
  let { source: source_obj, text_offset } = layout.getSourceOfCharacter(it_prev_char);
  if (source_obj instanceof SPString) {
    // Now the simple case can begin...
    if (!cursor_at_start) text_offset += [...source_obj.string.slice(text_offset)][0]?.length ?? 0;
    insert_into_spstring(source_obj, cursor_at_end ? source_obj.string.length : text_offset, utf8);
  } else {
    // the not-so-simple case where we're at a line break or other control char; add to the next child/sibling SPString
    const xml_doc = item.getRepr().document();
    if (cursor_at_start) {
      source_obj = item;
      if (source_obj.hasChildren()) {
        source_obj = source_obj.firstChild();
        if (item instanceof SPFlowtext) {
          while (source_obj instanceof SPFlowregion || source_obj instanceof SPFlowregionExclude) {
            source_obj = source_obj.getNext();
          }
          source_obj ??= item;
        }
      }
      if (source_obj === item && item instanceof SPFlowtext) {
        const para = xml_doc.createElement('svg:flowPara');
        item.getRepr().appendChild(para);
        source_obj = item.lastChild();
      }
    } else {
      source_obj = source_obj?.getNext() ?? null;
    }

    if (source_obj) {
      // never fails
      let string_item = sp_te_seek_next_string_recursive(source_obj);
      if (!string_item) {
        // need to add an SPString in this (pathological) case
        source_obj.getRepr().addChild(xml_doc.createTextNode(''), null);
        const first = source_obj.firstChild();
        if (!(first instanceof SPString)) return position;
        string_item = first;
      }
      insert_into_spstring(string_item, cursor_at_end ? string_item.string.length : 0, utf8);
    }
  }

  const char_index = layout.iteratorToCharIndex(position);
  te_update_layout_now(item);
  item.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  return layout.charIndexToIterator(char_index + ulength(utf8));
}

/** Delete the text from start to end, then insert utf8 at the start. */
export function sp_te_replace(
  item: SPItem,
  start: LayoutIterator,
  end: LayoutIterator,
  utf8: string,
): LayoutIterator {
  const pair = sp_te_delete(item, start, end);
  return sp_te_insert(item, pair.first, utf8);
}

// ***************************************************************************************
//                            D E L E T I N G   T E X T

/**
 * Moves all the children of from_repr to to_repr, either before the existing
 * children or after them. Order is maintained. The empty from_repr is not deleted.
 */
function move_child_nodes(from_repr: Node, to_repr: Node, prepend = false): void {
  while (from_repr.childCount()) {
    const child = prepend ? from_repr.lastChild()! : from_repr.firstChild()!;
    from_repr.removeChild(child);
    if (prepend) to_repr.addChild(child, null);
    else to_repr.appendChild(child);
  }
}

/** The closest ancestor of both one and two; never higher than text. */
function get_common_ancestor(text: SPObject, one: SPObject | null, two: SPObject | null): SPObject {
  if (!one || !two) return text;
  let common_ancestor = one;
  if (common_ancestor instanceof SPString && common_ancestor.parent) common_ancestor = common_ancestor.parent;
  while (!(common_ancestor === two || common_ancestor.isAncestorOf(two))) {
    if (common_ancestor === text || !common_ancestor.parent) return text;
    common_ancestor = common_ancestor.parent;
  }
  return common_ancestor;
}

/**
 * Position para_obj at the end of the last string in the last leaf object
 * of para_obj. If the last leaf is not an SPString the offset is unchanged.
 */
function move_to_end_of_paragraph(
  para_obj: SPObject,
  text_offset: number,
): { obj: SPObject; offset: number } {
  while (para_obj.hasChildren()) para_obj = para_obj.lastChild()!;
  if (para_obj instanceof SPString) text_offset = para_obj.string.length;
  return { obj: para_obj, offset: text_offset };
}

/**
 * Delete the line break item by merging its children into the next
 * suitable object and deleting item. Returns the object after the ones that
 * have just been moved and whether it is a sibling.
 */
function delete_line_break(
  root: SPObject,
  item: SPObject,
): { next: SPObject | null; next_is_sibling: boolean } {
  const this_repr = item.getRepr();
  let next_item: SPObject | null = null;
  let next_is_sibling = true;
  const moved_char_count = sp_text_get_length(item) - 1; // the -1 is because it's going to count the line break

  /* some sample cases (the div is the item to be deleted, the * represents where to put the new span):
      <div></div><p>*text</p>
      <p><div></div>*text</p>
      <p><div></div></p><p>*text</p>
  */
  const xml_doc = this_repr.document();
  const new_span_repr = xml_doc.createElement(span_name_for_text_object(root) ?? 'svg:tspan');
  new_span_repr.setAttributeOrRemoveIfEmpty('dx', this_repr.attribute('dx'));
  new_span_repr.setAttributeOrRemoveIfEmpty('dy', this_repr.attribute('dy'));
  new_span_repr.setAttributeOrRemoveIfEmpty('rotate', this_repr.attribute('rotate'));

  let following_item: SPObject = item;
  while (following_item.getNext() === null) {
    if (!following_item.parent || following_item.parent === root)
      return { next: null, next_is_sibling: false };
    following_item = following_item.parent;
  }
  following_item = following_item.getNext()!;

  let new_parent_item: SPObject;
  if (following_item instanceof SPString) {
    new_parent_item = following_item.parent!;
    new_parent_item.getRepr().addChild(new_span_repr, following_item.getPrev()?.getRepr() ?? null);
    next_item = following_item;
    next_is_sibling = true;
  } else {
    new_parent_item = following_item;
    next_item = new_parent_item.firstChild();
    next_is_sibling = true;
    if (!next_item) {
      next_item = new_parent_item;
      next_is_sibling = false;
    }
    new_parent_item.getRepr().addChild(new_span_repr, null);
  }

  // work around a bug in sp_style_write_difference() which causes the difference
  // not to be written if the second param has a style set which the first does not
  // by causing the first param to have everything set
  const dest_node_attrs = spReprCssAttr(new_parent_item.getRepr(), 'style');
  const this_node_attrs = spReprCssAttr(this_repr, 'style');
  const this_node_attrs_inherited = spReprCssAttrInherited(this_repr, 'style');
  for (const [key, value] of dest_node_attrs.attributeList()) {
    const this_attr = this_node_attrs_inherited.attribute(key);
    if ((this_attr === null || value !== this_attr) && this_node_attrs.attribute(key) === null) {
      this_node_attrs.setAttribute(key, this_attr);
    }
  }
  spReprCssChange(new_span_repr, this_node_attrs, 'style');

  attributes_for_object(new_parent_item)?.insert(0, moved_char_count);
  move_child_nodes(this_repr, new_span_repr);
  this_repr.parent()?.removeChild(this_repr);
  return { next: next_item, next_is_sibling };
}

/**
 * Erases the given characters (code unit offsets) from the given string
 * and deletes the corresponding x/y/dx/dy/rotate attributes from all its parents.
 */
function erase_from_spstring(string_item: SPString, iter_from: number, iter_to: number): void {
  let char_index = ulength(string_item.string.slice(0, iter_from));
  const char_count = ulength(string_item.string.slice(iter_from, iter_to));
  string_item.string = string_item.string.slice(0, iter_from) + string_item.string.slice(iter_to);
  string_item.getRepr().setContent(string_item.string);

  let parent_item: SPObject = string_item;
  for (;;) {
    char_index += sum_sibling_text_lengths_before(parent_item);
    if (!parent_item.parent) break;
    parent_item = parent_item.parent;
    const attributes = attributes_for_object(parent_item);
    if (!attributes) break;
    attributes.erase(char_index, char_count);
    attributes.writeTo(parent_item.getRepr());
  }
}

/**
 * Deletes the given characters from a text or flowroot object. This is
 * quite a complicated operation, partly due to the cleanup that is done if all
 * the text in a subobject has been deleted, and partly due to the difficulty
 * of figuring out what is a line break and how to delete one. Returns
 * whether anything was deleted, and the real start and end iterators.
 */
export function sp_te_delete(
  item: SPItem,
  start: LayoutIterator,
  end: LayoutIterator,
): IteratorPair & { success: boolean } {
  let success = false;
  const iter_pair = { first: start.copy(), second: end.copy() };
  if (start.equals(end)) return { ...iter_pair, success };
  if (start.compare(end) > 0) {
    iter_pair.first = end.copy();
    iter_pair.second = start.copy();
  }

  const layout = te_get_layout(item);
  if (!layout) return { ...iter_pair, success };
  let { source: start_item, text_offset: start_text_iter } = layout.getSourceOfCharacter(iter_pair.first);
  let { source: end_item, text_offset: end_text_iter } = layout.getSourceOfCharacter(iter_pair.second);
  if (!start_item) return { ...iter_pair, success }; // start is at end of text
  if (is_line_break_object(start_item)) {
    ({ obj: start_item, offset: start_text_iter } = move_to_end_of_paragraph(start_item, start_text_iter));
  }
  if (!end_item) {
    end_item = item.lastChild();
    if (end_item)
      ({ obj: end_item, offset: end_text_iter } = move_to_end_of_paragraph(end_item, end_text_iter));
  } else if (is_line_break_object(end_item)) {
    ({ obj: end_item, offset: end_text_iter } = move_to_end_of_paragraph(end_item, end_text_iter));
  }

  const common_ancestor = get_common_ancestor(item, start_item, end_item);

  const root_style = item.getRepr().attribute('style');
  const has_text_decoration = !!root_style?.includes('text-decoration');

  if (start_item === end_item) {
    // the quick case where we're deleting stuff all from the same string
    if (start_item instanceof SPString) {
      // always true (if it_start != it_end anyway)
      erase_from_spstring(start_item, start_text_iter, end_text_iter);
      success = true;
    }
  } else {
    let sub_item: SPObject | null = start_item;
    // walk the tree from start_item to end_item, deleting as we go
    while (sub_item && sub_item !== item) {
      if (sub_item === end_item) {
        if (sub_item instanceof SPString) {
          erase_from_spstring(sub_item, 0, end_text_iter);
          success = true;
        }
        break;
      }
      if (sub_item instanceof SPString) {
        if (sub_item === start_item) erase_from_spstring(sub_item, start_text_iter, sub_item.string.length);
        else erase_from_spstring(sub_item, 0, sub_item.string.length);
        success = true;
      }
      // walk to the next item in the tree
      if (sub_item.hasChildren()) {
        sub_item = sub_item.firstChild();
      } else {
        let next_item: SPObject | null;
        do {
          let is_sibling = true;
          next_item = sub_item!.getNext();
          if (!next_item) {
            next_item = sub_item!.parent;
            is_sibling = false;
          }
          if (is_line_break_object(sub_item)) {
            const r = delete_line_break(item, sub_item!);
            next_item = r.next;
            is_sibling = r.next_is_sibling;
          }
          sub_item = next_item;
          if (is_sibling) break;
          // no more siblings, go up a parent
        } while (sub_item && sub_item !== item && sub_item !== end_item);
      }
    }
  }

  while (tidy_xml_tree_recursively(common_ancestor, has_text_decoration)) {}
  te_update_layout_now(item);
  item.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  layout.validateIterator(iter_pair.first);
  layout.validateIterator(iter_pair.second);
  return { ...iter_pair, success };
}

// ***************************************************************************************
//                            P L A I N   T E X T   F U N C T I O N S

function sp_te_get_ustring_multiline(
  root: SPObject,
  state: { string: string; pending_line_break: boolean },
): void {
  if (state.pending_line_break) {
    state.string += '\n';
    state.pending_line_break = false;
  }
  for (const child of root.children) {
    if (child instanceof SPString) state.string += child.string;
    else if (is_part_of_text_subtree(child)) sp_te_get_ustring_multiline(child, state);
  }
  if (!(root instanceof SPText) && is_line_break_object(root)) state.pending_line_break = true;
}

/**
 * Gets a text-only representation of the given text or flowroot object
 * (from start to end, if given), replacing line break elements with '\n'.
 */
export function sp_te_get_string_multiline(
  text: SPItem,
  start?: LayoutIterator,
  end?: LayoutIterator,
): string {
  if (!start || !end) {
    const state = { string: '', pending_line_break: false };
    if (text instanceof SPText || text instanceof SPFlowtext) sp_te_get_ustring_multiline(text, state);
    return state.string;
  }
  if (start.equals(end)) return '';
  const layout = te_get_layout(text);
  if (!layout) return '';
  const first = (start.compare(end) < 0 ? start : end).copy();
  const last = start.compare(end) < 0 ? end : start;
  let result = '';
  // not a particularly fast piece of code. I'll optimise it if people start to notice.
  for (; first.compare(last) < 0; first.nextCharacter()) {
    const { source, text_offset } = layout.getSourceOfCharacter(first);
    if (source instanceof SPString) result += [...source.string.slice(text_offset)][0] ?? '';
    else result += '\n';
  }
  return result;
}

/** Replace the content of a text or flowtext with str; lines become sodipodi:role="line" tspans (or flowParas). */
export function sp_te_set_repr_text_multiline(text: SPItem, str: string | null): void {
  if (!(text instanceof SPText) && !(text instanceof SPFlowtext)) return;
  const xml_doc = text.getRepr().document();
  const repr = text.getRepr();
  const content = str ?? '';

  repr.setContent('');
  for (const child of text.childList()) {
    if (!(child instanceof SPFlowregion) && !(child instanceof SPFlowregionExclude))
      repr.removeChild(child.getRepr());
  }

  if (text instanceof SPText && (text.has_inline_size() || text.has_shape_inside())) {
    // Do nothing... we respect newlines (and assume CSS already set to do so).
    repr.addChild(xml_doc.createTextNode(content), null);
    return;
  }
  // Break into tspans with sodipodi:role="line".
  for (const line of content.split('\n')) {
    let rtspan: Node;
    if (text instanceof SPText) {
      // create a tspan for each line
      rtspan = xml_doc.createElement('svg:tspan');
      rtspan.setAttribute('sodipodi:role', 'line');
    } else {
      // create a flowPara for each line
      rtspan = xml_doc.createElement('svg:flowPara');
    }
    rtspan.addChild(xml_doc.createTextNode(line), null);
    repr.appendChild(rtspan);
  }
}

/** The average distance between the baselines of the lines. */
export function sp_te_get_average_linespacing(text: SPItem): number {
  const layout = te_get_layout(text);
  if (!layout) return 0;
  const line_count = layout._cursorLine(layout.end());
  const all_lines_height =
    layout.characterAnchorPoint(layout.end()).y - layout.characterAnchorPoint(layout.begin()).y;
  return all_lines_height / (line_count === 0 ? 1 : line_count);
}

// ***************************************************************************************
//                            T I D Y I N G

/**
 * Whether the style of child (from its style attributes up to parent) equals
 * the style of parent; then the children of both appear the same.
 */
function objects_have_equal_style(parent: SPObject, child: SPObject): boolean {
  // the obvious implementation of strcmp(style_write_all(parent), style_write_all(child))
  // will not work, the css spec requires that the computed value is inherited, not the specified value.
  let parent_style = parent.style.write(SP_STYLE_FLAG_ALWAYS);
  // we have to write parent_style then read it again, because some properties format their values
  // differently depending on whether they're set or not (*cough*dash-offset*cough*)
  const parent_spstyle = new SPStyleClass(parent.document);
  parent_spstyle.mergeString(parent_style);
  parent_style = parent_spstyle.write(SP_STYLE_FLAG_ALWAYS);

  let child_style_construction = '';
  for (let c: SPObject | null = child; c && c !== parent; c = c.parent) {
    // FIXME: this assumes that child's style is only in style= whereas it can also be in css attributes!
    const style_text = c.getRepr().attribute('style');
    if (style_text) child_style_construction = `;${style_text}${child_style_construction}`;
  }
  child_style_construction = parent_style + child_style_construction;
  const child_spstyle = new SPStyleClass(parent.document);
  child_spstyle.mergeString(child_style_construction);
  return child_spstyle.write(SP_STYLE_FLAG_ALWAYS) === parent_style;
}

/** Tidy operator: empty spans: abc<span></span>def -> abcdef. Returns the next item, or undefined if nothing changed. */
function tidy_operator_empty_spans(item: SPObject): SPObject | null | undefined {
  if (
    !item.hasChildren() &&
    !is_line_break_object(item) &&
    !(item instanceof SPString && item.string !== '')
  ) {
    const next = item.getNext();
    item.deleteObject();
    return next;
  }
  return undefined;
}

/** Tidy operator: inexplicable spans: abc<span style="">def</span>ghi -> "abc""def""ghi". */
function tidy_operator_inexplicable_spans(item: SPObject): SPObject | null | undefined {
  if (sp_repr_is_meta_element(item.getRepr())) return undefined;
  if (item instanceof SPString || is_line_break_object(item)) return undefined;
  if (attributes_for_object(item)?.anyAttributesSet()) return undefined;
  if (!item.parent || !objects_have_equal_style(item.parent, item)) return undefined;
  let next: SPObject = item;
  while (item.hasChildren()) {
    const repr = item.firstChild()!.getRepr();
    item.getRepr().removeChild(repr);
    item.parent.getRepr().addChild(repr, next.getRepr());
    next = next.getNext()!;
  }
  item.deleteObject();
  return next;
}

/** Tidy operator: repeated spans: <font a>abc</font><font a>def</font> -> <font a>abcdef</font>. */
function tidy_operator_repeated_spans(first: SPObject): SPObject | null | undefined {
  const second = first.getNext();
  if (!second) return undefined;
  const first_repr = first.getRepr();
  const second_repr = second.getRepr();
  if (first_repr.type() !== second_repr.type()) return undefined;

  if (first instanceof SPString && second instanceof SPString) {
    // also amalgamate consecutive SPStrings into one
    first_repr.setContent(first.string + second.string);
    second_repr.parent()?.removeChild(second_repr);
    return first;
  }

  // merge consecutive spans with identical styles into one
  if (first_repr.type() !== 'element') return undefined;
  if (first_repr.name() !== second_repr.name()) return undefined;
  if (is_line_break_object(second)) return undefined;
  if (first_repr.attribute('style') !== second_repr.attribute('style')) return undefined;

  // all our tests passed: do the merge
  const attributes_first = attributes_for_object(first);
  const attributes_second = attributes_for_object(second);
  if (attributes_first && attributes_second?.anyAttributesSet()) {
    const copy = new TextTagAttributes();
    copy.attributes = { ...attributes_first.attributes };
    attributes_first.join(copy, attributes_second, sp_text_get_length(first));
  }
  move_child_nodes(second_repr, first_repr);
  second_repr.parent()?.removeChild(second_repr);
  return first; // *item is still the next object to process
}

const tidy_operators = [
  tidy_operator_empty_spans,
  tidy_operator_inexplicable_spans,
  tidy_operator_repeated_spans,
];

/**
 * Run the tidy operators over the children of root, recursively. They must
 * not significantly alter (ie delete) any ancestor elements of the one they
 * are passed. Returns whether anything changed.
 * TODO: the nesting operators and the styled white space operator.
 */
function tidy_xml_tree_recursively(root: SPObject, has_text_decoration: boolean): boolean {
  if (root.getRepr().attribute('style')?.includes('text-decoration')) has_text_decoration = true;
  let changes = false;
  for (let child: SPObject | null = root.firstChild(); child; ) {
    if (child instanceof SPFlowregion || child instanceof SPFlowregionExclude) {
      child = child.getNext();
      continue;
    }
    if (child.hasChildren()) changes = tidy_xml_tree_recursively(child, has_text_decoration) || changes;
    let next: SPObject | null | undefined;
    for (const op of tidy_operators) {
      next = op(child);
      if (next !== undefined) break;
    }
    if (next !== undefined) {
      changes = true;
      child = next;
    } else {
      child = child.getNext();
    }
  }
  return changes;
}

/** Whether obj is part of a text: a text, tspan, flowtext or one of the flowtext children. */
export function is_part_of_text_subtree(obj: SPObject | null): boolean {
  return (
    obj instanceof SPTSpan ||
    obj instanceof SPText ||
    obj instanceof SPFlowtext ||
    obj instanceof SPFlowtspan ||
    obj instanceof SPFlowdiv ||
    obj instanceof SPFlowpara ||
    obj instanceof SPFlowline ||
    obj instanceof SPFlowregionbreak
  );
}

export function is_top_level_text_object(obj: SPObject | null): boolean {
  return obj instanceof SPText || obj instanceof SPFlowtext;
}

export function has_visible_text(obj: SPObject): boolean {
  if (obj instanceof SPString && obj.string !== '') return true; // maybe we should also check that it's not all whitespace?
  return is_part_of_text_subtree(obj) && obj.children.some((child) => has_visible_text(child));
}
