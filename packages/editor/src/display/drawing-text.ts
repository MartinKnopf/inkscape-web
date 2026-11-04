// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-text.cpp, src/display/drawing-text.h
/*
 * Group belonging to an SVG drawing element.
 *
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2011 Authors
 */
import {
  type DrawingText,
  type FontInstance,
  PANGO_GLYPH_EMPTY,
  SP_STYLE_FLAG_ALWAYS,
  type SPStyle,
} from '@inkscape-web/core';
import { type Affine, PathVector as PV, parse_svg_path, Rect, write_svg_path } from '@inkscape-web/geom';
import { SvgDrawingItem } from './drawing-item.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Component {
  font: FontInstance;
  glyph: number;
  trans: Affine;
  width: number;
}

/**
 * The glyphs of a text span (upstream DrawingText with its DrawingGlyphs):
 * an svg:path with the outlines of all glyphs, each transformed by its glyph
 * matrix from the layout, and the text decorations. The browser fills and
 * strokes it with the style of the span. A second, invisible path has the
 * pick boxes of the glyphs (upstream DrawingGlyphs picks with bbox_pick).
 */
export class SvgDrawingText extends SvgDrawingItem implements DrawingText {
  readonly #path: SVGElement;
  readonly #pick: SVGElement;
  readonly #components: Component[] = [];
  #style: SPStyle | null = null;

  constructor(doc: Document) {
    super(doc.createElementNS(SVG_NS, 'g') as SVGElement);
    this.#path = doc.createElementNS(SVG_NS, 'path') as SVGElement;
    this.#pick = doc.createElementNS(SVG_NS, 'path') as SVGElement;
    this.#pick.setAttribute('style', 'fill:none;stroke:none;pointer-events:all');
    this.element.append(this.#path, this.#pick);
  }

  protected override styleElement(): SVGElement {
    return this.#path;
  }

  /** Add a glyph of font with its transform (upstream addComponent). */
  addComponent(
    font: FontInstance,
    glyph: number,
    trans: Affine,
    width: number,
    _ascent: number,
    _descent: number,
    _phase_length: number,
  ): boolean {
    if (glyph === PANGO_GLYPH_EMPTY) {
      // Pango returns this for a zero-width empty glyph which we can ignore (e.g. 0xFE0F, Emoji variant selector).
      return false;
    }
    this.#components.push({ font, glyph, trans, width });
    // Layout.show() sets the style after the glyphs; later glyphs update the path at once.
    if (this.#style) this.#update();
    return true;
  }

  override setStyle(style: SPStyle | null, contextStyle?: SPStyle | null): void {
    super.setStyle(style, contextStyle);
    this.#style = style;
    this.#update();
  }

  protected override _styleText(style: SPStyle): string {
    return style.write(SP_STYLE_FLAG_ALWAYS);
  }

  /** Write the path data of the glyphs, the decorations and the pick boxes. */
  #update(): void {
    const glyphs: PV = [];
    const picks: PV = [];
    for (const c of this.#components) {
      const pv = c.font.PathVector(c.glyph);
      if (pv?.length) glyphs.push(...PV.transformed(pv, c.trans));
      const pick = c.font.BBoxPick(c.glyph);
      picks.push(...rectPath(pick, c.trans));
    }
    glyphs.push(...this.#decorations());
    this.#path.setAttribute('d', glyphs.length ? write_svg_path(glyphs) : '');
    this.#pick.setAttribute('d', picks.length ? write_svg_path(picks) : '');
  }

  /**
   * The text decorations of the span (upstream decorateItem, solid lines):
   * underline, overline and line-through along the span, in the coordinates
   * of its first glyph.
   */
  #decorations(): PV {
    const style = this.#style;
    const first = this.#components[0];
    if (!style || !first) return [];
    const line = style.text_decoration_line;
    if (!line.underline && !line.overline && !line.line_through) return [];
    const data = style.text_decoration_data;
    const font_size = Math.hypot(first.trans.c0, first.trans.c1);
    if (font_size <= 1.0e-32) return [];
    const tsp_width_adj = data.tspan_width / font_size;
    const tsp_asc_adj = data.ascender / font_size;
    const tsp_size_adj = (data.ascender + data.descender) / font_size;
    const clamp = (v: number) => Math.min(Math.max(v, tsp_size_adj / 30.0), tsp_size_adj / 10.0);
    const final_underline_thickness = clamp(data.underline_thickness);
    const final_line_through_thickness = clamp(data.line_through_thickness);
    // Decorations are in the coordinates of the first glyph without its rotation of the outline (y up).
    const out: PV = [];
    const bar = (y: number, thickness: number) => {
      out.push(...rectPath(new Rect(0, y - thickness / 2, tsp_width_adj, y + thickness / 2), first.trans));
    };
    if (line.underline) bar(-data.underline_position, final_underline_thickness);
    if (line.overline) {
      bar(tsp_asc_adj - data.underline_position + final_underline_thickness, final_underline_thickness);
    }
    if (line.line_through) bar(data.line_through_position, final_line_through_thickness);
    return out;
  }
}

/** A closed path around rect, transformed. */
function rectPath(rect: Rect, trans: Affine): PV {
  const corners = rect.corners().map((p) => p.transformed(trans));
  return parse_svg_path(`M${corners.map((p) => `${p.x},${p.y}`).join('L')}Z`);
}
