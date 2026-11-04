// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/nr-svgfonts.cpp, src/display/nr-svgfonts.h
/*
 * SVGFonts rendering implementation
 *
 * Authors:
 *    Felipe C. da S. Sanches <juca@members.fsf.org>
 *    Jon A. Cruz <jon@joncruz.org>
 *    Abhishek Sharma
 *
 * Copyright (C) 2008 Felipe C. da S. Sanches
 */
import { Affine, type PathVector, PathVector as PV, Scale } from '@inkscape-web/geom';
import type { SPFont } from '../object/sp-font.ts';
import { SPFontFace } from '../object/sp-font-face.ts';
import { SPGlyph, SPMissingGlyph } from '../object/sp-glyph.ts';
import { SPHkern, SPVkern } from '../object/sp-glyph-kerning.ts';
import { SPPath } from '../object/sp-path.ts';
import { SPShape } from '../object/sp-shape.ts';
import { SPUse } from '../object/sp-use.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';

/** A positioned glyph of a string (cairo_glyph_t): index into the glyphs, glyphs.length is the missing-glyph. */
export interface SvgFontGlyph {
  index: number;
  /** In em units. */
  x: number;
  y: number;
}

/** The number of code units of substring if str starts with it, else 0 (upstream size_of_substring). */
function size_of_substring(substring: string, str: string, at: number): number {
  if (!substring) return 0;
  return str.startsWith(substring, at) ? substring.length : 0;
}

/** Whether hkern applies between the previous glyph and glyph (upstream MatchHKerningRule). */
function MatchHKerningRule(
  hkern: SPHkern | SPVkern,
  glyph: SPGlyph,
  previous_unicode: string,
  previous_glyph_name: string,
): boolean {
  return (
    (hkern.u1.contains(previous_unicode.codePointAt(0) ?? 0) || hkern.g1.contains(previous_glyph_name)) &&
    (hkern.u2.contains(glyph.unicode.codePointAt(0) ?? 0) || hkern.g2.contains(glyph.glyph_name))
  );
}

/**
 * Renders text with an SVG font (upstream SvgFont, a cairo user font): the
 * glyphs of a string with kerning, and the outline of each glyph. Used by the
 * preview of the SVG Font Editor.
 */
export class SvgFont {
  readonly font: SPFont;
  glyphs: SPGlyph[] = [];
  missingglyph: SPMissingGlyph | null = null;

  constructor(spfont: SPFont) {
    this.font = spfont;
    this.refresh();
  }

  /** Read the glyphs again (after the font changed). */
  refresh(): void {
    this.glyphs = [];
    this.missingglyph = null;
    for (const node of this.font.children) {
      if (node instanceof SPGlyph) this.glyphs.push(node);
      if (node instanceof SPMissingGlyph) this.missingglyph = node;
    }
  }

  units_per_em(): number {
    let units_per_em = 1024;
    for (const obj of this.font.children) {
      if (obj instanceof SPFontFace)
        units_per_em = obj.getRepr().getAttributeDouble('units-per-em', units_per_em);
    }
    return units_per_em <= 0.0 ? 1024 : units_per_em;
  }

  /**
   * The glyphs and their positions (em units) for a text (upstream
   * scaled_font_text_to_glyphs): the first glyph whose unicode matches at each
   * position, the kerning of hkern and vkern, and the missing-glyph for
   * characters without a glyph.
   */
  scaled_font_text_to_glyphs(utf8: string): SvgFontGlyph[] {
    const out: SvgFontGlyph[] = [];
    let previous_unicode: string | null = null; //This is used for kerning
    let previous_glyph_name: string | null = null; //This is used for kerning
    let x = 0;
    let y = 0; //These vars store the position of the glyph within the rendered string
    const is_horizontal_text = true; //TODO
    const font_height = this.units_per_em();
    let at = 0;
    while (at < utf8.length) {
      let found_glyphs = false;
      for (let i = 0; i < this.glyphs.length; i++) {
        //check whether is there a glyph declared on the SVG document
        // that matches with the text string in its current position
        const glyph = this.glyphs[i]!;
        const len = size_of_substring(glyph.unicode, utf8, at);
        if (!len) continue;
        found_glyphs = true;
        for (const node of this.font.children) {
          if (previous_unicode === null) break;
          //apply glyph kerning if appropriate
          if (
            node instanceof SPHkern &&
            is_horizontal_text &&
            MatchHKerningRule(node, glyph, previous_unicode, previous_glyph_name ?? '')
          ) {
            x -= node.k / font_height;
          }
          if (
            node instanceof SPVkern &&
            !is_horizontal_text &&
            MatchHKerningRule(node, glyph, previous_unicode, previous_glyph_name ?? '')
          ) {
            y -= node.k / font_height;
          }
        }
        previous_unicode = glyph.unicode; //used for kerning checking
        previous_glyph_name = glyph.glyph_name; //used for kerning checking
        out.push({ index: i, x, y });

        //advance glyph coordinates:
        if (is_horizontal_text) {
          x += (glyph.horiz_adv_x !== 0 ? glyph.horiz_adv_x : this.font.horiz_adv_x) / font_height;
        } else {
          y += this.font.vert_adv_y / font_height;
        }
        at += len; // advance 'len' code units
        break;
      }
      if (!found_glyphs) {
        if (this.missingglyph) {
          out.push({ index: this.glyphs.length, x, y });
          // advance glyph coordinates:
          if (is_horizontal_text) x += this.font.horiz_adv_x / font_height;
          else y += this.font.vert_adv_y / font_height;
        }
        at += (utf8.codePointAt(at) ?? 0) > 0xffff ? 2 : 1; //advance 1 char in our string
      }
    }
    return out;
  }

  /** Flip the y-axis and place the origin at the baseline (upstream flip_coordinate_system). */
  flip_coordinate_system(pathv: PathVector): PathVector {
    const baseline_offset = this.units_per_em() - this.font.horiz_origin_y;
    //This matrix flips y-axis and places the origin at baseline
    return PV.transformed(pathv, new Affine(1, 0, 0, -1, 0, baseline_offset));
  }

  /**
   * The outline of a glyph in em units, y down with the baseline at y 1 (upstream
   * scaled_font_render_glyph): the d attribute and the paths (or clones of paths) of its children.
   */
  glyph_path(glyph: number): PathVector {
    const node = glyph === this.glyphs.length ? this.missingglyph : this.glyphs[glyph];
    if (!node) return [];
    const s = Scale(1.0 / this.units_per_em());
    const out: PathVector = [];
    const add = (pathv: PathVector) => out.push(...PV.transformed(this.flip_coordinate_system(pathv), s));
    if (node.d) add(sp_svg_read_pathv(node.d));
    //render the SVG described on this glyph's child nodes.
    for (const child of node.children) {
      if (child instanceof SPPath) {
        const c = child.curve();
        if (c) add(c);
      }
      if (child instanceof SPUse) {
        const item = child.ref.getObject();
        if (item instanceof SPShape && item.curve()) add(item.curve()!);
      }
    }
    return out;
  }

  /**
   * The outlines of a text at font size `size` with its baseline at y (upstream:
   * cairo_show_text with the user font, as the font editor preview draws it).
   */
  text_path(text: string, size: number, x = 0, y = 0): PathVector {
    const out: PathVector = [];
    // The glyph outlines have the baseline at y = 1 em.
    const base = Scale(size).multiply(new Affine(1, 0, 0, 1, x, y - size));
    for (const g of this.scaled_font_text_to_glyphs(text)) {
      const m = new Affine(1, 0, 0, 1, g.x, g.y).multiply(base);
      out.push(...PV.transformed(this.glyph_path(g.index), m));
    }
    return out;
  }
}
