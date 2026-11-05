// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/latex-pstricks.cpp, src/extension/internal/latex-pstricks.h
/*
 * LaTeX Printing
 *
 * Author:
 *  Michael Forbes <miforbes@mbhs.edu>
 *   Abhishek Sharma
 *
 * Copyright (C) 2004 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Colors,
  formatFixed,
  is_straight_curve,
  pathv_to_linear_and_cubic_beziers,
  SP_SCALE24_MAX,
  type SPDocument,
  SPGroup,
  SPItem,
  SPShape,
  type SPStyle,
  SPUse,
  stripTrailingZeros,
} from '@inkscape-web/core';
import {
  type Affine,
  CubicBezier,
  type Curve,
  Path,
  type PathVector,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { INKSCAPE_VERSION } from '../../actions/actions-base.ts';

/** The module key of the LaTeX print (upstream SP_MODULE_KEY_PRINT_LATEX). */
export const SP_MODULE_KEY_PRINT_LATEX = 'org.inkscape.print.latex';

/**
 * A number as upstream writes it to the LaTeX file (SVGOStringStream with std::ios::fixed): an
 * integer as it is, else with 10 digits after the point and without trailing zeros.
 */
function num(d: number): string {
  if (Number.isInteger(d) && d >= -0x80000000 && d <= 0x7fffffff) return String(d === 0 ? 0 : d);
  return stripTrailingZeros(formatFixed(d, 10));
}

/**
 * The print driver for LaTeX with PSTricks macros (upstream PrintLatex): the document is
 * printed through begin(), bind()/release(), fill() and stroke(), and finish() returns the
 * file.
 */
export class PrintLatex {
  #out = '';
  #started = false;
  readonly #m_tr_stack: Affine[] = [];

  /** Start the picture (upstream begin). */
  begin(doc: SPDocument): void {
    const dims = doc.getDimensions();
    this.#out = '%LaTeX with PSTricks extensions\n';
    this.#started = true;
    this.#out += `%%Creator: Inkscape ${INKSCAPE_VERSION}\n`;
    this.#out += '%%Please note this file requires PSTricks extensions\n';
    this.#out += '\\psset{xunit=.5pt,yunit=.5pt,runit=.5pt}\n';
    // from now on we can output px, but they will be treated as pt
    this.#out += `\\begin{pspicture}(${num(dims.x)},${num(dims.y)})\n`;
    /// @fixme hardcoded doc2dt transform
    this.#m_tr_stack.push(Scale(1, -1).multiply(Translate(0, dims.y)));
  }

  /** End the picture and return the file (upstream finish). */
  finish(): string {
    if (this.#started) this.#out += '\\end{pspicture}\n';
    this.#started = false;
    return this.#out;
  }

  /** Apply the transform and the opacity to what follows, until release() (upstream bind). */
  bind(transform: Affine, _opacity: number): void {
    const top = this.#m_tr_stack.at(-1);
    this.#m_tr_stack.push(top ? transform.multiply(top) : transform);
  }

  release(): void {
    this.#m_tr_stack.pop();
  }

  fill(pathv: PathVector, _transform: Affine, style: SPStyle): void {
    if (!this.#started) return;
    if (style.fill.isColor()) {
      const fill_opacity = style.fill_opacity.as_double();
      const rgb = style.fill.getColor().converted(Colors.SpaceType.RGB) ?? style.fill.getColor();
      let os = `{\n\\newrgbcolor{curcolor}{${num(rgb.get(0))} ${num(rgb.get(1))} ${num(rgb.get(2))}}\n`;
      os += '\\pscustom[linestyle=none,fillstyle=solid,fillcolor=curcolor';
      if (fill_opacity !== 1.0) os += `,opacity=${num(fill_opacity)}`;
      os += ']\n{\n';
      os += this.#print_pathvector(pathv);
      os += '}\n}\n';
      this.#out += os;
    }
  }

  stroke(pathv: PathVector, _transform: Affine, style: SPStyle): void {
    if (!this.#started) return;
    if (style.stroke.isColor()) {
      const tr_stack = this.#m_tr_stack.at(-1);
      const scale = tr_stack ? tr_stack.descrim() : 1;
      const stroke_opacity = style.stroke_opacity.as_double();
      const rgb = style.stroke.getColor().converted(Colors.SpaceType.RGB) ?? style.stroke.getColor();
      let os = `{\n\\newrgbcolor{curcolor}{${num(rgb.get(0))} ${num(rgb.get(1))} ${num(rgb.get(2))}}\n`;
      os += `\\pscustom[linewidth=${num(style.stroke_width.computed * scale)},linecolor=curcolor`;
      if (stroke_opacity !== 1.0) os += `,strokeopacity=${num(stroke_opacity)}`;
      if (style.stroke_dasharray.set && style.stroke_dasharray.values.length) {
        os += ',linestyle=dashed,dash=';
        os += style.stroke_dasharray.values.map((v) => num(v.value)).join(' ');
      }
      os += ']\n{\n';
      os += this.#print_pathvector(pathv);
      os += '}\n}\n';
      this.#out += os;
    }
  }

  // FIXME: why is 'transform' argument not used? (As upstream, the transform stack applies.)
  #print_pathvector(pathv_in: PathVector): string {
    if (!pathv_in.length) return '';
    const tf_stack = this.#m_tr_stack.at(-1);
    // generates new path, which is a bit slow, but this doesn't have to be performance optimized
    const pathv = tf_stack ? pathv_in.map((p) => p.transformed(tf_stack)) : pathv_in;
    let os = '\\newpath\n';
    for (const it of pathv) {
      os += `\\moveto(${num(it.initialPoint().x)},${num(it.initialPoint().y)})\n`;
      for (const cit of it.openCurves()) os += this.#print_2geomcurve(cit);
      if (it.closed()) os += '\\closepath\n';
    }
    return os;
  }

  #print_2geomcurve(c: Curve): string {
    if (is_straight_curve(c)) return `\\lineto(${num(c.finalPoint().x)},${num(c.finalPoint().y)})\n`;
    if (c instanceof CubicBezier) {
      const [, p1, p2, p3] = c.controlPoints();
      return `\\curveto(${num(p1!.x)},${num(p1!.y)})(${num(p2!.x)},${num(p2!.y)})(${num(p3!.x)},${num(p3!.y)})\n`;
    }
    // this case handles all other curve types: approximated with cubics
    const single = new Path(c.initialPoint());
    single.appendCurve(c);
    const [path] = pathv_to_linear_and_cubic_beziers([single]);
    return (path?.openCurves() ?? []).map((iter) => this.#print_2geomcurve(iter)).join('');
  }

  /**
   * Print an item and its children (upstream SPItem::invoke_print with SPShape::print,
   * SPGroup::print and SPUse::print).
   * TODO: text (upstream prints the glyph outlines), images and markers.
   */
  invoke_print(item: SPItem): void {
    if (item.isHidden()) return;
    if (!item.transform.isIdentity() || item.style.opacity.value !== SP_SCALE24_MAX) {
      this.bind(item.transform, item.style.opacity.as_double());
      this.#print(item);
      this.release();
    } else {
      this.#print(item);
    }
  }

  #print(item: SPItem): void {
    if (item instanceof SPShape) {
      const pathv = item.curve();
      if (!pathv?.length) return;
      const i2dt = item.i2dtAffine();
      if (!item.style.fill.isNone()) this.fill(pathv, i2dt, item.style);
      if (!item.style.stroke.isNone()) this.stroke(pathv, i2dt, item.style);
    } else if (item instanceof SPGroup) {
      for (const child of item.children) if (child instanceof SPItem) this.invoke_print(child);
    } else if (item instanceof SPUse) {
      if (item.has_xy_offset()) this.bind(Translate(item.x.computed, item.y.computed), 1.0);
      if (item.child) this.invoke_print(item.child);
      if (item.has_xy_offset()) this.release();
    }
  }
}
