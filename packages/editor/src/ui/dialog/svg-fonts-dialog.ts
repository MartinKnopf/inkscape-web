// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/svg-fonts-dialog.cpp, src/ui/dialog/svg-fonts-dialog.h
/*
 * SVG Fonts dialog - implementation.
 *
 * Authors:
 *   Felipe C. da S. Sanches <juca@members.fsf.org>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2008 Authors
 */

import {
  _,
  C_,
  DocumentUndo,
  SPGlyph as Glyph,
  type ObjectSet,
  SP_OBJECT_MODIFIED_FLAG,
  type SPDocument,
  SPFont,
  SPFontFace,
  type SPGlyph,
  type SPGlyphKerning,
  SPHkern,
  SPMissingGlyph,
  type SPObject,
  sp_svg_read_pathv,
  sp_svg_write_path,
} from '@inkscape-web/core';
import { Affine, type PathVector, PathVector as PV } from '@inkscape-web/geom';

/** The svg:font elements of a document, in document order (upstream getResourceList("font")). */
export function document_fonts(document: SPDocument): SPFont[] {
  const out: SPFont[] = [];
  const walk = (o: SPObject) => {
    if (o instanceof SPFont) out.push(o);
    for (const c of o.children) walk(c);
  };
  if (document.root) walk(document.root);
  return out;
}

/** The svg:font-face child of a font. */
export function font_face(font: SPFont): SPFontFace | null {
  let face: SPFontFace | null = null;
  for (const obj of font.children) if (obj instanceof SPFontFace) face = obj;
  return face;
}

/** The glyphs of a font in child order. */
export function font_glyphs(font: SPFont): SPGlyph[] {
  return font.children.filter((c): c is SPGlyph => c instanceof Glyph);
}

/** The horizontal kerning pairs of a font. */
export function font_kerning_pairs(font: SPFont): SPGlyphKerning[] {
  return font.children.filter((c): c is SPGlyphKerning => c instanceof SPHkern);
}

/** Create an svg:font in the defs with default font-face and missing-glyph (upstream new_font). */
export function new_font(document: SPDocument): SPFont {
  const defs = document.getDefs()!;
  const xml_doc = document.getReprDoc();
  // create a new font
  const repr = xml_doc.createElement('svg:font');
  //By default, set the horizontal advance to 1000 units
  repr.setAttribute('horiz-adv-x', '1000');
  // Append the new font node to defs
  defs.getRepr().appendChild(repr);
  // add some default values
  const fontface = xml_doc.createElement('svg:font-face');
  fontface.setAttribute('units-per-em', '1000');
  fontface.setAttribute('ascent', '750');
  fontface.setAttribute('cap-height', '600');
  fontface.setAttribute('x-height', '400');
  fontface.setAttribute('descent', '200');
  repr.appendChild(fontface);
  //create a missing glyph
  const mg = xml_doc.createElement('svg:missing-glyph');
  mg.setAttribute('d', 'M0,0h1000v1000h-1000z');
  repr.appendChild(mg);
  // get corresponding object
  return document.getObjectByRepr(repr) as SPFont;
}

/** Add a font named "font N" with family "SVGFont N" (upstream SvgFontsDialog::add_font). */
export function add_font(document: SPDocument): SPFont {
  const count = document_fonts(document).length;
  const font = new_font(document);
  font.setAttribute('inkscape:label', `${_('font')} ${count}`);
  font_face(font)?.setAttribute('font-family', `SVGFont ${count}`);
  DocumentUndo.done(document, C_('Undo', 'Add font'), '');
  return font;
}

/** The units per em of the font-face, or 0 (upstream get_font_units_per_em). */
export function get_font_units_per_em(font: SPFont): number {
  return font_face(font)?.getRepr().getAttributeDouble('units-per-em', 0) ?? 0;
}

/** Flip the y-axis and place the origin at the baseline (upstream flip_coordinate_system). */
export function flip_coordinate_system(pathv: PathVector, font: SPFont, units_per_em: number): PathVector {
  const baseline_offset = units_per_em - font.horiz_origin_y;
  // This matrix flips y-axis and places the origin at baseline
  return PV.transformed(pathv, new Affine(1, 0, 0, -1, 0, baseline_offset));
}

/** Create a glyph (upstream SPFont::create_new_glyph). */
export function create_new_glyph(font: SPFont, name: string, unicode: string): SPGlyph {
  const grepr = font.document.getReprDoc().createElement('svg:glyph');
  grepr.setAttribute('glyph-name', name);
  grepr.setAttribute('unicode', unicode);
  // Append the new glyph node to the current font
  font.getRepr().appendChild(grepr);
  return font.document.getObjectByRepr(grepr) as SPGlyph;
}

/** Add a glyph for the character after the one of the last glyph (upstream add_glyph). */
export function add_glyph(font: SPFont): SPGlyph {
  const glyphs = font_glyphs(font);
  // initialize "unicode" field; if there are glyphs look for the last one and take next unicode
  let unicode = 0x20;
  const code = glyphs.at(-1)?.unicode;
  if (code) {
    let value = code.codePointAt(0)!;
    // skip control chars 7f-9f
    if (value === 0x7e) value = 0x9f;
    // wrap around
    if (value === 0x10ffff) value = 0x1f;
    unicode = value + 1;
  }
  // empty name to begin with
  const glyph = create_new_glyph(font, '', String.fromCodePoint(unicode));
  DocumentUndo.done(font.document, C_('Undo', 'Add glyph'), '');
  return glyph;
}

/** The d attribute of the first selected object, or the error message to flash. */
function selected_path(selection: ObjectSet): PathVector | string {
  if (selection.isEmpty()) return _('Select a <b>path</b> to define the curves of a glyph');
  const node = selection.xmlNodes()[0];
  const d = node?.attribute('d');
  if (!d) return _('The selected object does not have a <b>path</b> description.');
  return sp_svg_read_pathv(d);
}

/**
 * Set the curves of glyph from the selected path (upstream
 * set_glyph_description_from_selected_path). Returns the error message to
 * flash, or null.
 */
export function set_glyph_description_from_selected_path(
  selection: ObjectSet,
  font: SPFont,
  glyph: SPGlyph | null,
): string | null {
  const pathv = selected_path(selection);
  if (typeof pathv === 'string') return pathv;
  if (!glyph) return _('No glyph selected in the SVGFonts dialog.');
  const units_per_em = get_font_units_per_em(font);
  glyph.setAttribute('d', sp_svg_write_path(flip_coordinate_system(pathv, font, units_per_em)));
  DocumentUndo.done(font.document, C_('Undo', 'Set glyph curves'), '');
  return null;
}

/** Set the curves of the missing-glyph from the selected path (upstream missing_glyph_description_from_selected_path). */
export function missing_glyph_description_from_selected_path(
  selection: ObjectSet,
  font: SPFont,
): string | null {
  const pathv = selected_path(selection);
  if (typeof pathv === 'string') return pathv;
  const units_per_em = get_font_units_per_em(font);
  for (const obj of font.children) {
    if (obj instanceof SPMissingGlyph) {
      obj.setAttribute('d', sp_svg_write_path(flip_coordinate_system(pathv, font, units_per_em)));
      DocumentUndo.done(font.document, C_('Undo', 'Set glyph curves'), '');
    }
  }
  return null;
}

/** Reset the missing-glyph to a box (upstream reset_missing_glyph_description). */
export function reset_missing_glyph_description(font: SPFont): void {
  for (const obj of font.children) {
    if (obj instanceof SPMissingGlyph) {
      obj.setAttribute('d', 'M0,0h1000v1024h-1000z');
      DocumentUndo.done(font.document, C_('Undo', 'Reset missing-glyph'), '');
    }
  }
}

/** Rename a glyph (upstream glyph_name_edit). */
export function glyph_name_edit(glyph: SPGlyph, str: string): void {
  if (glyph.glyph_name === str) return; // no change
  glyph.setAttribute('glyph-name', str);
  DocumentUndo.done(glyph.document, C_('Undo', 'Edit glyph name'), '');
}

/** Set the characters of a glyph (upstream glyph_unicode_edit). */
export function glyph_unicode_edit(glyph: SPGlyph, str: string): void {
  if (glyph.unicode === str) return; // no change
  glyph.setAttribute('unicode', str);
  DocumentUndo.done(glyph.document, C_('Undo', 'Set glyph unicode'), '');
}

/** Set the advance of a glyph; ignores text that is not a number (upstream glyph_advance_edit). */
export function glyph_advance_edit(glyph: SPGlyph, str: string): void {
  if (glyph.getAttribute('horiz-adv-x') === str) return; // no change
  if (Number.isNaN(Number.parseFloat(str))) return;
  glyph.setAttribute('horiz-adv-x', str);
  DocumentUndo.done(glyph.document, C_('Undo', 'Set glyph advance'), '');
}

/** Delete an object of the font with an undo step: "Remove font", "Remove glyph" or "Remove kerning pair". */
export function remove_font_object(obj: SPObject, description: string): void {
  const document = obj.document;
  obj.getRepr().parent()?.removeChild(obj.getRepr());
  DocumentUndo.done(document, description, '');
}

/**
 * Add the horizontal kerning pair u1, u2 with k 0, or return the pair that
 * exists (upstream add_kerning_pair).
 */
export function add_kerning_pair(font: SPFont, first: string, second: string): SPGlyphKerning | null {
  if (!first || !second) return null;
  const u1 = first.codePointAt(0)!;
  const u2 = second.codePointAt(0)!;
  //look for this kerning pair on the currently selected font
  for (const pair of font_kerning_pairs(font)) {
    if (pair.u1.contains(u1) && pair.u2.contains(u2)) return pair;
  }
  // create a new hkern node
  const repr = font.document.getReprDoc().createElement('svg:hkern');
  repr.setAttribute('u1', first);
  repr.setAttribute('u2', second);
  repr.setAttribute('k', '0');
  // Append the new hkern node to the current font
  font.getRepr().appendChild(repr);
  DocumentUndo.done(font.document, C_('Undo', 'Add kerning pair'), '');
  return font.document.getObjectByRepr(repr) as SPGlyphKerning;
}

/**
 * Set the kerning of a pair from the slider value (upstream
 * on_kerning_value_changed): slider values increase from right to left so
 * that they match the kerning pair preview.
 */
export function set_kerning_value(font: SPFont, pair: SPGlyphKerning, slider: number): void {
  const undokey = `svgfonts:hkern:k:${pair.u1.attribute_string()}:${pair.u2.attribute_string()}`;
  pair.setAttribute('k', String(font.horiz_adv_x - slider));
  DocumentUndo.maybeDone(font.document, undokey, C_('Undo', 'Adjust kerning value'), '');
}

/** The attributes of the Global settings tab: those of svg:font, then those of svg:font-face. */
export const FONT_ATTRS = ['horiz-adv-x', 'horiz-origin-x', 'horiz-origin-y'] as const;
export const FONT_FACE_ATTRS = ['units-per-em', 'ascent', 'cap-height', 'x-height', 'descent'] as const;

/** Set an attribute of the font or its font-face (upstream AttrSpin/AttrEntry::on_attr_changed). */
export function set_font_attribute(font: SPFont, name: string, value: string): void {
  const o = (FONT_ATTRS as readonly string[]).includes(name) ? font : font_face(font);
  if (!o) return;
  o.setAttribute(name, value);
  o.parent?.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.maybeDone(font.document, `svgfonts:${name}`, C_('Undo', 'Set SVG Font attribute'), '');
}

/** Rename a font (upstream: the edited signal of the font list). */
export function set_font_label(font: SPFont, label: string): void {
  font.setAttribute('inkscape:label', label);
  DocumentUndo.maybeDone(font.document, 'svgfonts:fontName', C_('Undo', 'Set SVG font name'), '');
}
