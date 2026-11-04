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
import { Scale, Translate } from '@inkscape-web/geom';
import { DocumentUndo } from './document-undo.ts';
import { C_ } from './i18n.ts';
import { Alignment } from './libnrtype/Layout-TNG.ts';
import { SPFlowpara } from './object/sp-flowdiv.ts';
import { SPFlowtext } from './object/sp-flowtext.ts';
import { i2i_affine, SPItem } from './object/sp-item.ts';
import { SP_OBJECT_MODIFIED_FLAG, type SPObject } from './object/sp-object.ts';
import { SPShape } from './object/sp-shape.ts';
import { SPText } from './object/sp-text.ts';
import {
  SP_IS_TEXT_TEXTPATH,
  SP_TEXT_LAYOUT_MODIFIED_FLAG,
  SPTSpan,
  sp_textpath_to_text,
} from './object/sp-tspan.ts';
import { Preferences } from './preferences.ts';
import type { Selection } from './selection.ts';
import { SPStyle } from './style.ts';
import { SPCSSDirection, SPCSSWritingMode } from './style-enums.ts';
import { sp_svg_transform_write } from './svg/svg-affine.ts';
import { sp_te_get_string_multiline, te_get_layout } from './text-editing.ts';
import type { Node } from './xml/node.ts';
import { spReprCssAttr, spReprCssChange, spReprCssUnsetProperty } from './xml/repr-css.ts';

/** The first text or flowed text of the selection. */
export function text_or_flowtext_in_selection(selection: Selection): SPItem | null {
  return selection.items().find((item) => item instanceof SPText || item instanceof SPFlowtext) ?? null;
}

function shape_in_selection(selection: Selection): SPItem | null {
  return selection.items().find((item) => item instanceof SPShape) ?? null;
}

/** The url(#id) of an object (upstream SPObject::getUrl). */
function getUrl(o: SPObject): string {
  return `url(#${o.getId() ?? ''})`;
}

/**
 * Put the selected text on the selected path: move the children of the text
 * into an svg:textPath that references the path (the app.text-put-on-path
 * action). Returns false if the selection is not a text and a path.
 */
export function text_put_on_path(selection: Selection): boolean {
  const doc = selection.document();
  let text = text_or_flowtext_in_selection(selection);
  const shape = shape_in_selection(selection);
  if (!doc || !text || !shape || selection.items().length !== 2) {
    // TODO: flash "Select <b>a text and a path</b> to put text on path."
    return false;
  }
  if (SP_IS_TEXT_TEXTPATH(text)) {
    // TODO: flash "This text object is <b>already put on a path</b>. Remove it from the path first. Use <b>Shift+D</b> to look up its path."
    return false;
  }
  const xml_doc = doc.getReprDoc();

  // if a flowed text is selected, convert it to a regular text object
  if (text instanceof SPFlowtext) {
    // TODO: flash "The flowed text(s) must be <b>visible</b> in order to be put on a path." when no output.
    const repr = text.getAsText();
    if (!repr) return false;
    text.getRepr().parent()?.appendChild(repr);
    const new_item = doc.getObjectByRepr(repr);
    if (!(new_item instanceof SPItem)) return false;
    new_item.doWriteTransform(text.transform);
    new_item.updateRepr();
    text.deleteObject(); // delete the original flowtext
    doc.ensureUpToDate();
    selection.clear();
    text = new_item; // point to the new text
  }

  // Replace any new lines (including sodipodi:role="line") by spaces.
  if (text instanceof SPText) text.remove_newlines();

  const layout = te_get_layout(text)!;
  const text_alignment = layout.paragraphAlignment(layout.begin());

  // remove transform from text, but recursively scale text's fontsize by the expansion
  SPText._adjustFontsizeRecursive(text, text.transform.descrim());
  text.removeAttribute('transform');

  // make a list of text children
  const text_reprs = text.children.map((o) => o.getRepr());

  // create textPath and put it into the text
  const textpath = xml_doc.createElement('svg:textPath');
  // reference the shape
  textpath.setAttribute('xlink:href', `#${shape.getRepr().attribute('id')}`);
  if (text_alignment === Alignment.RIGHT) textpath.setAttribute('startOffset', '100%');
  else if (text_alignment === Alignment.CENTER) textpath.setAttribute('startOffset', '50%');
  text.getRepr().addChild(textpath, null);

  for (const child of text_reprs) {
    // Make a copy of each text child
    const copy = child.duplicate(xml_doc);
    // We cannot have multiline in textpath, so remove line attrs from tspans
    if (copy.name() === 'svg:tspan') {
      copy.removeAttribute('sodipodi:role');
      copy.removeAttribute('x');
      copy.removeAttribute('y');
    }
    // remove the old repr from under text
    text.getRepr().removeChild(child);
    // put its copy into under textPath
    textpath.appendChild(copy); // fixme: copy id
  }

  // x/y are useless with textpath, and confuse Batik 1.5
  text.removeAttribute('x');
  text.removeAttribute('y');

  DocumentUndo.done(doc, C_('Undo', 'Put text on path'), 'draw-text');
  return true;
}

/** Move the texts on paths of the selection back to plain text (the app.text-remove-from-path action). */
export function text_remove_from_path(selection: Selection): boolean {
  const doc = selection.document();
  if (!doc || selection.isEmpty()) {
    // TODO: flash "Select <b>a text on path</b> to remove it from path."
    return false;
  }
  let did = false;
  for (const obj of selection.items()) {
    if (SP_IS_TEXT_TEXTPATH(obj)) {
      const tp = obj.firstChild()!;
      did = true;
      sp_textpath_to_text(tp);
    }
  }
  if (!did) {
    // TODO: flash "<b>No texts-on-paths</b> in the selection."
    return false;
  }
  DocumentUndo.done(doc, C_('Undo', 'Remove text from path'), 'draw-text');
  return true;
}

function text_remove_all_kerns_recursively(o: SPObject): void {
  o.removeAttribute('dx');
  o.removeAttribute('dy');
  o.removeAttribute('rotate');

  // if x contains a list, leave only the first value
  const x = o.getRepr().attribute('x');
  if (x) {
    const xa_space = x.split(' ');
    const xa_comma = x.split(',');
    if (xa_space.length > 1 && xa_space[0]) o.setAttribute('x', xa_space[0]);
    else if (xa_comma.length > 1 && xa_comma[0]) o.setAttribute('x', xa_comma[0]);
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

/** Make the selected shapes the shape-subtract of the selected text (the app.text-flow-subtract-frame action). */
export function text_flow_shape_subtract(selection: Selection): boolean {
  const doc = selection.document();
  const text = text_or_flowtext_in_selection(selection);
  if (!doc || !(text instanceof SPText)) {
    // SVG 1.2 Flowed Text
    // TODO: flash "Subtraction not available for SVG 1.2 Flowed text."
    return false;
  }
  // Make list of all shapes.
  const shapes = selection
    .items()
    .filter((item) => item instanceof SPShape)
    .map(getUrl)
    .join(' ');
  // Set 'shape-subtract' property.
  text.style.shape_subtract.read(shapes);
  text.updateRepr();
  DocumentUndo.done(doc, C_('Undo', 'Flow text subtract shape'), 'draw-text');
  return true;
}

/**
 * Flow the selected text into the selected shapes (the
 * app.text-flow-into-frame action): with /tools/text/use_svg2 an SVG 2
 * shape-inside, else an SVG 1.2 flowRoot with clones of the shapes.
 */
export function text_flow_into_shape(selection: Selection): boolean {
  const doc = selection.document();
  const text = text_or_flowtext_in_selection(selection);
  const shape = shape_in_selection(selection);
  if (!doc || !text || !shape || selection.items().length < 2) {
    // TODO: flash "Select <b>a text</b> and one or more <b>paths or shapes</b> to flow text."
    return false;
  }
  const xml_doc = doc.getReprDoc();

  if (Preferences.get().getBool('/tools/text/use_svg2', true)) {
    // SVG 2 Text
    if (!(text instanceof SPText)) return false;
    // Make list of all shapes.
    const shapes: string[] = [];
    for (const item of selection.items()) {
      if (!(item instanceof SPShape)) continue;
      if (!shapes.length && item.parent && text.parent) {
        // can only take one shape into account for transform compensation
        // compensate transform
        const new_transform = i2i_affine(item.parent, text.parent);
        const ex = text.transform.descrim() / new_transform.descrim();
        SPText._adjustFontsizeRecursive(text, ex);
        text.transform = new_transform;
      }
      shapes.push(getUrl(item));
    }
    // Set 'shape-inside' property.
    text.style.shape_inside.read(shapes.join(' '));
    text.style.white_space.read('pre-wrap'); // Respect new lines.
    text.updateRepr();
    DocumentUndo.done(doc, C_('Undo', 'Flow text into shape'), 'draw-text');
    return true;
  }

  if (!shape.parent) return false;
  // remove transform from text, but recursively scale text's fontsize by the expansion
  SPText._adjustFontsizeRecursive(text, i2i_affine(text, shape.parent).descrim());
  text.removeAttribute('transform');

  const root_repr = xml_doc.createElement('svg:flowRoot');
  root_repr.setAttribute('xml:space', 'preserve'); // we preserve spaces in the text objects we create
  root_repr.setAttribute('style', text.getRepr().attribute('style')); // fixme: transfer style attrs too
  shape.parent.getRepr().appendChild(root_repr);
  const root_object = doc.getObjectByRepr(root_repr);
  if (!(root_object instanceof SPFlowtext)) return false;

  const region_repr = xml_doc.createElement('svg:flowRegion');
  root_repr.appendChild(region_repr);

  /* Add clones */
  for (const item of selection.items()) {
    if (!(item instanceof SPShape)) continue;
    const clone = xml_doc.createElement('svg:use');
    clone.setAttribute('x', '0');
    clone.setAttribute('y', '0');
    clone.setAttribute('xlink:href', `#${item.getRepr().attribute('id')}`);
    // add the new clone to the region
    region_repr.appendChild(clone);
  }

  if (text instanceof SPText) {
    // flow from text, as string
    const para_repr = xml_doc.createElement('svg:flowPara');
    root_repr.appendChild(para_repr);
    const layout = te_get_layout(text)!;
    // FIXME: transfer all formatting! and convert newlines into flowParas!
    para_repr.appendChild(
      xml_doc.createTextNode(sp_te_get_string_multiline(text, layout.begin(), layout.end())),
    );
  } else {
    // reflow an already flowed text, preserving paras
    for (const o of text.children) {
      if (o instanceof SPFlowpara) root_repr.appendChild(o.getRepr().duplicate(xml_doc));
    }
  }

  text.deleteObject(true);
  DocumentUndo.done(doc, C_('Undo', 'Flow text into shape'), 'draw-text');
  selection.set(root_object);
  return true;
}

/**
 * Remove the selected texts from their frames (the app.text-unflow action):
 * a flowRoot becomes a one-line text, a text with shape-inside loses it and
 * keeps its baseline.
 */
export function text_unflow(selection: Selection): boolean {
  const doc = selection.document();
  if (!doc || !text_or_flowtext_in_selection(selection)) {
    // TODO: flash "Select <b>a flowed text</b> to unflow it."
    return false;
  }
  const xml_doc = doc.getReprDoc();
  const new_objs: SPItem[] = [];
  const old_objs: SPItem[] = [];

  for (const i of selection.items()) {
    if (i instanceof SPFlowtext) {
      const flowtext = i;
      // we discard transform when unflowing, but we must preserve expansion which is visible as
      // font size multiplier
      const ex = flowtext.transform.descrim();
      const text_string = sp_te_get_string_multiline(flowtext);
      if (!text_string) continue; // flowtext is empty

      /* Create <text> */
      const rtext = xml_doc.createElement('svg:text');
      rtext.setAttribute('xml:space', 'preserve'); // we preserve spaces in the text objects we create
      /* Set style */
      rtext.setAttribute('style', flowtext.getRepr().attribute('style')); // fixme: transfer style attrs too
      const bbox = flowtext.geometricBounds(flowtext.i2docAffine());
      if (bbox) {
        rtext.setAttributeSvgDouble('x', bbox.min().x);
        rtext.setAttributeSvgDouble('y', bbox.min().y);
      }

      /* Create <tspan> */
      const rtspan = xml_doc.createElement('svg:tspan');
      rtspan.setAttribute('sodipodi:role', 'line'); // otherwise, why bother creating the tspan?
      rtext.addChild(rtspan, null);
      rtspan.appendChild(xml_doc.createTextNode(text_string)); // FIXME: transfer all formatting!!!

      flowtext.parent?.getRepr().appendChild(rtext);
      const text_object = doc.getObjectByRepr(rtext);
      // restore the font size multiplier from the flowtext's transform
      if (text_object instanceof SPText) {
        SPText._adjustFontsizeRecursive(text_object, ex);
        new_objs.push(text_object);
      }
      old_objs.push(flowtext);
    } else if (i instanceof SPText && i.has_shape_inside()) {
      const text = i;
      const old_point = text.getBaselinePoint();
      const rtext = text.getRepr();
      // Position unflowed text near shape.
      const bbox = text.geometricBounds(text.i2docAffine());
      if (bbox) {
        rtext.setAttributeSvgDouble('x', bbox.min().x);
        rtext.setAttributeSvgDouble('y', bbox.min().y);
      }
      // Remove 'shape-inside' property.
      const css = spReprCssAttr(rtext, 'style');
      spReprCssUnsetProperty(css, 'shape-inside');
      spReprCssUnsetProperty(css, 'shape-padding');
      spReprCssChange(rtext, css, 'style');

      // We'll leave tspans alone other than stripping 'x' and 'y' (this will preserve
      // styling). We'll also remove temporarily 'sodipodi:role' (which shouldn't be
      // necessary later).
      for (const j of text.childList()) {
        if (j instanceof SPTSpan) {
          j.getRepr().removeAttribute('x');
          j.getRepr().removeAttribute('y');
          j.getRepr().removeAttribute('sodipodi:role');
        }
      }
      // Reposition the text so the baselines don't change.
      doc.ensureUpToDate();
      text.rebuildLayout();
      const new_point = text.getBaselinePoint();
      if (old_point && new_point) {
        const move = Translate(old_point.sub(new_point)).multiply(text.transform);
        text.doWriteTransform(move, move, false);
      }
    }
  }

  // For flowtext objects.
  if (new_objs.length) {
    // Update selection
    selection.clear();
    selection.setList(new_objs.reverse());
    // Delete old objects
    for (const i of old_objs) i.deleteObject(true);
  }
  DocumentUndo.done(doc, C_('Undo', 'Unflow flowed text'), 'draw-text');
  return true;
}

/** Remove shape-inside from the style of text, keeping its shape (upstream SPText::hide_shape_inside). */
export function text_hide_shape_inside(text: SPText): void {
  if (!text.style.shape_inside.set) return;
  const css = spReprCssAttr(text.getRepr(), 'style');
  spReprCssUnsetProperty(css, 'shape-inside');
  spReprCssChange(text.getRepr(), css, 'style');
}

/**
 * Split the selected texts into one text per glyph cluster, each with the
 * transform of its glyph (the app.text-convert-to-glyphs action).
 */
export function text_to_glyphs(selection: Selection): boolean {
  const doc = selection.document();
  if (!doc) return false;
  const xml_doc = doc.getReprDoc();
  const results: SPItem[] = [];
  const to_delete: SPText[] = [];

  for (const item of selection.items()) {
    if (!(item instanceof SPText)) continue;
    const text = item;
    const parent = text.parent?.getRepr();
    const sibling = text.getRepr();
    if (!parent) continue;
    const layout = text.layout;
    const iter = layout.end();
    while (!iter.equals(layout.begin())) {
      const end = iter.copy();
      // Glyph index may not be zero leading to an infinite loop
      // if we don't test this here... (see issue #4767).
      if (!iter.prevCharacter()) break;
      if (layout.isWhitespace(iter)) continue;

      const it_next = iter.copy();
      let last_glyph = iter.glyphIndex();
      while (it_next.prevCharacter()) {
        // multiple characters single glyph ligature
        const multi_char_glyph = it_next.glyphIndex() === last_glyph;
        // In some cases diacritics are separate glyphs and separate characters, but they can not
        // be used independently without base character.
        const helper_char = !layout.isCursorPosition(iter);
        if (multi_char_glyph || helper_char) {
          iter._char_index = it_next._char_index;
          iter._glyph_index = it_next._glyph_index;
        } else break;
        last_glyph = it_next.glyphIndex();
      }

      // multiple glyphs from single character, get first glyph
      while (
        iter.glyphIndex() > 0 &&
        layout._glyphs[iter.glyphIndex() - 1]!.in_character ===
          layout._glyphs[iter.glyphIndex()]!.in_character
      ) {
        iter.prevGlyph();
      }

      let str = '';
      for (const char_iter = iter.copy(); char_iter.compare(end) < 0; ) {
        if (layout.isWhitespace(char_iter)) break;
        str += layout.characterAt(char_iter);
        if (!char_iter.nextCharacter()) break; // should not happen
      }

      if (!iter.hasGlyph()) continue;
      const glyph = layout._glyphs[iter.glyphIndex()]!;
      const tspan = layout.getSourceOfCharacter(iter).source;
      if (!tspan) break;

      // Create new text object to hold the single glyph
      const new_node = xml_doc.createElement('svg:text');

      // Write the effective style and transform back into the new text node
      const result_style = new SPStyle(doc);
      for (let sp = tspan.parent; sp && sp !== text; sp = sp.parent) result_style.merge(sp.style);
      result_style.merge(text.style);
      result_style.text_anchor.read('start');
      // reset layout properties which are already included in glyph transform
      result_style.writing_mode.read('lr-tb');
      result_style.writing_mode.computed = SPCSSWritingMode.SP_CSS_WRITING_MODE_LR_TB;
      result_style.direction.read('ltr');
      result_style.direction.computed = SPCSSDirection.SP_CSS_DIRECTION_LTR;
      const glyph_style = result_style.writeIfDiff(text.parent?.style ?? null);
      new_node.setAttributeOrRemoveIfEmpty('style', glyph_style);

      const glyph_span = layout._charSpan(layout._characters[glyph.in_character]!);
      const inverse_scale = 1.0 / glyph_span.font_size;
      // not ideal, assumes that in case of 1 character -> n glyphs, the first glyph is the base glyph
      // and has normal position
      const transform = Scale(inverse_scale, -inverse_scale) // prevent font size from being applied twice
        .multiply(layout.glyphTransform(glyph))
        .multiply(text.transform);
      new_node.setAttributeOrRemoveIfEmpty('transform', sp_svg_transform_write(transform));
      new_node.appendChild(xml_doc.createTextNode(str));

      // Store the new object for the selection and prepare for the next glyph
      parent.addChild(new_node, sibling);
      const new_text = doc.getObjectByRepr(new_node);
      if (new_text instanceof SPText) results.push(new_text);
    }
    to_delete.push(text);
  }

  selection.clear();
  for (const item of to_delete) item.deleteObject();

  if (!results.length) {
    // TODO: flash "Select <b>text(s)</b> to convert to glyphs."
    return false;
  }
  DocumentUndo.done(doc, C_('Undo', 'Convert text to glyphs'), 'text-convert-to-regular');
  selection.setList(results);
  return true;
}

/** Convert the selected flowed texts to regular texts that look the same (the app.text-convert-to-regular action). */
export function flowtext_to_text(selection: Selection): boolean {
  const doc = selection.document();
  if (!doc || selection.isEmpty()) {
    // TODO: flash "Select <b>flowed text(s)</b> to convert."
    return false;
  }
  let did = false;
  const reprs: Node[] = [];
  for (const item of [...selection.items()]) {
    if (!(item instanceof SPFlowtext)) continue;
    if (!item.layout.outputExists()) {
      // TODO: flash "Flowed text(s) must be <b>visible</b> in order to be converted."
      continue;
    }
    const repr = item.getAsText();
    if (!repr) break;
    did = true;
    item.getRepr().parent()?.addChild(repr, item.getRepr());
    const new_item = doc.getObjectByRepr(repr);
    if (new_item instanceof SPItem) {
      new_item.doWriteTransform(item.transform);
      new_item.updateRepr();
    }
    item.deleteObject();
    reprs.push(repr);
  }
  if (!did) {
    // TODO: flash "<b>No flowed text(s)</b> to convert in the selection."
    return false;
  }
  DocumentUndo.done(doc, C_('Undo', 'Convert flowed text to text'), 'text-convert-to-regular');
  selection.setReprList(reprs);
  return true;
}

/** Select the items under parent that use family (set, not inherited) (upstream text_select_by_font). */
export function text_select_by_font(selection: Selection, family: string, parent: SPObject): void {
  const items: SPItem[] = [];
  const walk = (o: SPObject) => {
    for (const child of o.children) {
      if (!(child instanceof SPItem)) continue;
      const style = child.style;
      if (
        (style.font_family.set && style.font_family.value() === family) ||
        (style.font_specification.set && style.font_specification.value() === family)
      ) {
        items.push(child);
      }
      walk(child);
    }
  };
  walk(parent);
  selection.clear();
  selection.setList(items);
}
