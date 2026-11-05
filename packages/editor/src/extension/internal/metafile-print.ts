// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/metafile-print.cpp, src/extension/internal/metafile-print.h
/*
 * Metafile printing - common routines
 *
 * Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2013 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Colors,
  FillRule,
  is_straight_curve,
  SPCSSFontWeight,
  type SPGradient,
  SPImage,
  type SPLinearGradient,
  type SPObject,
  SPPattern,
  type SPRadialGradient,
  type SPStyle,
  SPWindRule,
} from '@inkscape-web/core';
import {
  Affine,
  type Curve,
  distance,
  LineSegment,
  Path,
  type PathVector,
  Point,
  parse_svg_path,
} from '@inkscape-web/geom';
import type { PrintImagePixels } from '../../print.ts';
import { Implementation } from '../implementation/implementation.ts';
import type { Print } from '../print.ts';
import {
  type U_COLORREF,
  U_FW_BOLD,
  U_FW_EXTRABOLD,
  U_FW_EXTRALIGHT,
  U_FW_HEAVY,
  U_FW_LIGHT,
  U_FW_MEDIUM,
  U_FW_NORMAL,
  U_FW_SEMIBOLD,
  U_FW_THIN,
  U_HS_DITHEREDBKCLR,
  U_HS_SOLIDCLR,
  U_RGB,
  U_RGBA,
  type UemfBackend,
} from './uemf-backend.ts';

/** The RGBA of a color (upstream toColorRef). */
export function toColorRef(color: Colors.Color | null | undefined): U_COLORREF {
  // Make sure it's RGB first, if wmf can support other color formats, this can be changed.
  const c = color?.converted(Colors.SpaceType.RGB) ?? new Colors.Color(0x000000ff);
  const a = c.hasOpacity() ? c.get(3) : 1.0;
  return U_RGBA(255 * c.get(0), 255 * c.get(1), 255 * c.get(2), 255 * a);
}

export enum MFDrawMode {
  DRAW_PAINT,
  DRAW_PATTERN,
  DRAW_IMAGE,
  DRAW_LINEAR_GRADIENT,
  DRAW_RADIAL_GRADIENT,
}

export interface FontfixParams {
  f1: number; //Vertical (rotating) offset factor (* font height)
  f2: number; //Vertical (nonrotating) offset factor (* font height)
  f3: number; //Horizontal (nonrotating) offset factor (* font height)
}

const ppt_fixable_fonts = new Map<string, FontfixParams>([
  ['Arial', { f1: 0.05, f2: -0.055, f3: -0.065 }],
  ['Times New Roman', { f1: 0.05, f2: -0.055, f3: -0.065 }],
  ['Lucida Sans', { f1: -0.025, f2: -0.055, f3: -0.065 }],
  ['Sans', { f1: 0.05, f2: -0.055, f3: -0.065 }],
  ['Microsoft Sans Serif', { f1: -0.05, f2: -0.055, f3: -0.065 }],
  ['Serif', { f1: 0.05, f2: -0.055, f3: -0.065 }],
  ['Garamond', { f1: 0.05, f2: -0.055, f3: -0.065 }],
  ['Century Schoolbook', { f1: 0.25, f2: 0.025, f3: 0.025 }],
  ['Verdana', { f1: 0.025, f2: 0.0, f3: 0.0 }],
  ['Tahoma', { f1: 0.045, f2: 0.025, f3: 0.025 }],
  ['Symbol', { f1: 0.025, f2: 0.0, f3: 0.0 }],
  ['Wingdings', { f1: 0.05, f2: 0.0, f3: 0.0 }],
  ['Zapf Dingbats', { f1: 0.025, f2: 0.0, f3: 0.0 }],
  ['Convert To Symbol', { f1: 0.025, f2: 0.0, f3: 0.0 }],
  ['Convert To Wingdings', { f1: 0.05, f2: 0.0, f3: 0.0 }],
  ['Convert To Zapf Dingbats', { f1: 0.025, f2: 0.0, f3: 0.0 }],
  ['Sylfaen', { f1: 0.1, f2: 0.0, f3: 0.0 }],
  ['Palatino Linotype', { f1: 0.175, f2: 0.125, f3: 0.125 }],
  ['Segoe UI', { f1: 0.1, f2: 0.0, f3: 0.0 }],
]);

/** opacity weighting of two colors as float.  v1 is the color, op is its opacity, v2 is the background color */
function opweight(v1: number, v2: number, op: number): number {
  return v1 * op + v2 * (1.0 - op);
}

/** The values of a gradient that is drawn as slices (upstream GRADVALUES). */
export interface GRADVALUES {
  p1: Point; // center   or start
  p2: Point; // xhandle  or end
  p3: Point; // yhandle  or unused
  r: number; // radius   or unused
  grad: SPGradient | null; // to access the stops information
  mode: MFDrawMode; // DRAW_LINEAR_GRADIENT or DRAW_RADIAL_GRADIENT, if GRADVALUES is valid, else any value
  bgc: U_COLORREF; // document background color, this is as good a place as any to keep it
  rgb: [number, number, number]; // also background color, but as 0-1 float.
}

/** printf("%f") */
const f = (v: number) => v.toFixed(6);

/** The common part of the EMF and WMF print (upstream PrintMetafile). */
export abstract class PrintMetafile extends Implementation {
  /** The functions of uemf-module.wasm; the output sets it before the print. */
  uemf!: UemfBackend;
  /** The decoded pixels of the images of the document (upstream: SPImage::pixbuf). */
  images: ReadonlyMap<SPImage, PrintImagePixels> = new Map();

  _width = 0;
  _height = 0;
  _doc_unit_scale = 1; // to pixels, regardless of the document units

  htextalignment = 0;
  hpolyfillmode = 0; // used to minimize redundant records that set this
  htextcolor_rgb: Colors.Color | null = null; // used to minimize redundant records that set this

  m_tr_stack: Affine[] = [];
  fill_transform = Affine.identity();
  use_stroke = false;
  use_fill = false;
  simple_shape = false;
  usebk = false;

  gv: GRADVALUES = {
    p1: new Point(),
    p2: new Point(),
    p3: new Point(),
    r: 0,
    grad: null,
    mode: MFDrawMode.DRAW_PAINT,
    bgc: U_RGB(0, 0, 0),
    rgb: [0, 0, 0],
  };

  override textToPath(ext: Print): boolean {
    return ext.get_param_bool('textToPath');
  }

  override bind(_mod: Print, transform: Affine, _opacity: number): number {
    const tr_top = this.m_tr_stack.at(-1);
    this.m_tr_stack.push(tr_top ? transform.multiply(tr_top) : transform);
    return 1;
  }

  override release(_mod: Print): number {
    this.m_tr_stack.pop();
    return 1;
  }

  /** Finds font fix parameters for the given fontname. */
  static _lookup_ppt_fontfix(fontname: string, params: FontfixParams): void {
    const it = ppt_fixable_fonts.get(fontname);
    if (it) Object.assign(params, it);
  }

  static _gethexcolor(color: number): U_COLORREF {
    return U_RGB((color >> 16) & 0xff, (color >> 8) & 0xff, (color >> 0) & 0xff);
  }

  /** Translate Inkscape weights to EMF weights. */
  static _translate_weight(inkweight: number): number {
    switch (inkweight) {
      // 400 is tested first, as it is the most common case
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_400:
        return U_FW_NORMAL;
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_100:
        return U_FW_THIN;
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_200:
        return U_FW_EXTRALIGHT;
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_300:
        return U_FW_LIGHT;
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_500:
        return U_FW_MEDIUM;
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_600:
        return U_FW_SEMIBOLD;
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_700:
        return U_FW_BOLD;
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_800:
        return U_FW_EXTRABOLD;
      case SPCSSFontWeight.SP_CSS_FONT_WEIGHT_900:
        return U_FW_HEAVY;
      default:
        return U_FW_NORMAL;
    }
  }

  avg_stop_color(gr: SPGradient): U_COLORREF {
    const stops = gr.vector.stops;
    const last = stops.length - 1;
    if (last >= 1) {
      const rgba = (c: Colors.Color | undefined) => {
        const rgb = c?.converted(Colors.SpaceType.RGB) ?? new Colors.Color(0x000000ff);
        return [rgb.get(0), rgb.get(1), rgb.get(2), rgb.hasOpacity() ? rgb.get(3) : 1];
      };
      const rgbs = rgba(stops[0]!.color);
      const rgbe = rgba(stops[last]!.color);
      const bg = this.gv.rgb;

      /* Replace opacity at start & stop with that fraction background color, then average those two for final color. */
      return U_RGB(
        255 * ((opweight(rgbs[0]!, bg[0], rgbs[3]!) + opweight(rgbe[0]!, bg[0], rgbe[3]!)) / 2.0),
        255 * ((opweight(rgbs[1]!, bg[1], rgbs[3]!) + opweight(rgbe[1]!, bg[1], rgbe[3]!)) / 2.0),
        255 * ((opweight(rgbs[2]!, bg[2], rgbs[3]!) + opweight(rgbe[2]!, bg[2], rgbe[3]!)) / 2.0),
      );
    }
    return U_RGB(0, 0, 0); // The default fill
  }

  weight_opacity(c1: U_COLORREF): U_COLORREF {
    const opa = c1.Reserved / 255.0;
    const bg = this.gv.rgb;
    return U_RGB(
      255 * opweight(c1.Red / 255.0, bg[0], opa),
      255 * opweight(c1.Green / 255.0, bg[1], opa),
      255 * opweight(c1.Blue / 255.0, bg[2], opa),
    );
  }

  /** t between 0 and 1, values outside that range use the nearest limit */
  weight_colors(c1: U_COLORREF, c2: U_COLORREF, t: number): U_COLORREF {
    const clrweight = (a: number, b: number) => ((1 - t) * a + t * b) & 0xff;
    t = t > 1.0 ? 1.0 : Math.max(t, 0.0);
    let result: U_COLORREF = {
      Red: clrweight(c1.Red, c2.Red),
      Green: clrweight(c1.Green, c2.Green),
      Blue: clrweight(c1.Blue, c2.Blue),
      Reserved: clrweight(c1.Reserved, c2.Reserved),
    };

    // now handle the opacity, mix the RGB with background at the weighted opacity
    if (result.Reserved !== 255) result = this.weight_opacity(result);
    return result;
  }

  /**
   * Extract hatchType, hatchColor from a name like EMFhatch<hatchType>_<hatchColor>, where the
   * first one is a number and the second a color in hex. The out object has the defaults.
   */
  hatch_classify(
    name: string,
    out: { hatchType: number; hatchColor: U_COLORREF; bkColor: U_COLORREF },
  ): void {
    // name should be EMFhatch or WMFhatch but *MFhatch will be accepted
    if (name.slice(1, 8) !== 'MFhatch') return; // not anything we can parse
    let rest = name.slice(8); // EMFhatch already detected
    const digits = /^\d*/.exec(rest)![0];
    const val = digits ? Number.parseInt(digits, 10) : 0;
    rest = rest.slice(digits.length);
    out.hatchType = val;
    if (rest[0] !== '_' || val > U_HS_DITHEREDBKCLR) {
      // wrong syntax, cannot classify
      out.hatchType = -1;
    } else {
      rest = rest.slice(1);
      const two = /^([0-9A-Fa-f]+)_([0-9A-Fa-f]+)/.exec(rest);
      if (!two) {
        // not a pattern with background
        const one = /^[0-9A-Fa-f]+/.exec(rest);
        if (!one) out.hatchType = -1; // not a pattern, cannot classify
        out.hatchColor = PrintMetafile._gethexcolor(one ? Number.parseInt(one[0], 16) : 0);
      } else {
        out.hatchColor = PrintMetafile._gethexcolor(Number.parseInt(two[1]!, 16));
        out.bkColor = PrintMetafile._gethexcolor(Number.parseInt(two[2]!, 16));
        this.usebk = true;
      }
    }
    /* Everything > U_HS_SOLIDCLR is solid, just specify the color in the brush rather than messing around with background or textcolor */
    if (out.hatchType > U_HS_SOLIDCLR) out.hatchType = U_HS_SOLIDCLR;
  }

  /**
   * Recurse down from a brush pattern, try to figure out what it is. If an image is found set
   * epixbuf, else leave it null. If a pattern is found with a name like [EW]MFhatch3_3F7FFF
   * return hatchType=3, hatchColor=3F7FFF, otherwise hatchType is set to -1 and hatchColor is
   * not defined.
   */
  brush_classify(
    parent: SPObject,
    depth: number,
    out: { epixbuf: PrintImagePixels | null; hatchType: number; hatchColor: U_COLORREF; bkColor: U_COLORREF },
  ): void {
    if (depth === 0) {
      out.epixbuf = null;
      out.hatchType = -1;
      out.hatchColor = U_RGB(0, 0, 0);
      out.bkColor = U_RGB(255, 255, 255);
    }
    depth++;
    // first look along the pattern chain, if there is one
    if (parent instanceof SPPattern) {
      for (let pat_i: SPPattern | null = parent; pat_i; pat_i = pat_i.ref.getObject()) {
        // Some names may be longer than [EW]MFhatch#_######
        this.hatch_classify((pat_i.getAttribute('id') ?? '').slice(0, 31), out);
        if (out.hatchType !== -1) return;

        // still looking?  Look at this pattern's children, if there are any
        for (const child of pat_i.children) {
          if (out.epixbuf || out.hatchType !== -1) break;
          this.brush_classify(child, depth, out);
        }
      }
    } else if (parent instanceof SPImage) {
      out.epixbuf = this.images.get(parent) ?? null;
    } else {
      // some inkscape rearrangements pass through nodes between pattern and image which are not classified as either.
      for (const child of parent.children) {
        if (out.epixbuf || out.hatchType !== -1) break;
        this.brush_classify(child, depth, out);
      }
    }
  }

  hold_gradient(gr: SPGradient, mode: MFDrawMode): number {
    this.gv.mode = mode;
    this.gv.grad = gr;
    if (mode === MFDrawMode.DRAW_RADIAL_GRADIENT) {
      const rg = gr as SPRadialGradient;
      this.gv.r = rg.r.computed; // radius, but of what???
      this.gv.p1 = new Point(rg.cx.computed, rg.cy.computed); // center
      this.gv.p2 = new Point(this.gv.r, 0).add(this.gv.p1); // xhandle
      this.gv.p3 = new Point(0, -this.gv.r).add(this.gv.p1); // yhandle
      if (rg.gradientTransform_set) {
        this.gv.p1 = this.gv.p1.transformed(rg.gradientTransform);
        this.gv.p2 = this.gv.p2.transformed(rg.gradientTransform);
        this.gv.p3 = this.gv.p3.transformed(rg.gradientTransform);
      }
    } else if (mode === MFDrawMode.DRAW_LINEAR_GRADIENT) {
      const lg = gr as SPLinearGradient;
      this.gv.r = 0; // unused
      this.gv.p1 = new Point(lg.x1.computed, lg.y1.computed); // start
      this.gv.p2 = new Point(lg.x2.computed, lg.y2.computed); // end
      this.gv.p3 = new Point(0, 0); // unused
      if (lg.gradientTransform_set) {
        this.gv.p1 = this.gv.p1.transformed(lg.gradientTransform);
        this.gv.p2 = this.gv.p2.transformed(lg.gradientTransform);
      }
    } else {
      throw new Error(
        'Fatal programming error, hold_gradient() in metafile-print.cpp called with invalid draw mode',
      );
    }
    return 1;
  }

  /**
   * convert from center ellipse to SVGEllipticalArc ellipse (see
   * http://www.w3.org/TR/SVG/implnote.html#ArcConversionEndpointToCenter). F is in RADIANS.
   */
  static center_ellipse_as_SVG_PathV(ctr: Point, rx: number, ry: number, F: number): PathVector {
    const x1 = ctr.x + Math.cos(F) * rx * Math.cos(0) + Math.sin(-F) * ry * Math.sin(0);
    const y1 = ctr.y + Math.sin(F) * rx * Math.cos(0) + Math.cos(F) * ry * Math.sin(0);
    const x2 = ctr.x + Math.cos(F) * rx * Math.cos(Math.PI) + Math.sin(-F) * ry * Math.sin(Math.PI);
    const y2 = ctr.y + Math.sin(F) * rx * Math.cos(Math.PI) + Math.cos(F) * ry * Math.sin(Math.PI);
    const deg = (F * 360) / (2 * Math.PI);
    return parse_svg_path(
      ` M ${f(x1)},${f(y1)} A ${f(rx)} ${f(ry)} ${f(deg)} 0 0 ${f(x2)} ${f(y2)} A ${f(rx)} ${f(ry)} ${f(deg)} 0 0 ${f(x1)} ${f(y1)} z`,
    );
  }

  /** rx2,ry2 must be larger than rx1,ry1! angle is in RADIANS */
  static center_elliptical_ring_as_SVG_PathV(
    ctr: Point,
    rx1: number,
    ry1: number,
    rx2: number,
    ry2: number,
    F: number,
  ): PathVector {
    const degrot = (F * 360) / (2 * Math.PI);
    const pt = (rx: number, ry: number, t: number) => [
      ctr.x + Math.cos(F) * rx * Math.cos(t) + Math.sin(-F) * ry * Math.sin(t),
      ctr.y + Math.sin(F) * rx * Math.cos(t) + Math.cos(F) * ry * Math.sin(t),
    ];
    const [x11, y11] = pt(rx1, ry1, 0);
    const [x12, y12] = pt(rx1, ry1, Math.PI);
    const [x21, y21] = pt(rx2, ry2, 0);
    const [x22, y22] = pt(rx2, ry2, Math.PI);
    return parse_svg_path(
      ` M ${f(x11!)},${f(y11!)} A ${f(rx1)} ${f(ry1)} ${f(degrot)} 0 1 ${f(x12!)} ${f(y12!)} A ${f(rx1)} ${f(ry1)} ${f(degrot)} 0 1 ${f(x11!)} ${f(y11!)} z` +
        ` M ${f(x21!)},${f(y21!)}  A ${f(rx2)} ${f(ry2)} ${f(degrot)} 0 0 ${f(x22!)} ${f(y22!)} A ${f(rx2)} ${f(ry2)} ${f(degrot)} 0 0 ${f(x21!)} ${f(y21!)} z`,
    );
  }

  /** Elliptical hole in a large square extending from -50k to +50k */
  static center_elliptical_hole_as_SVG_PathV(ctr: Point, rx: number, ry: number, F: number): PathVector {
    const x1 = ctr.x + Math.cos(F) * rx * Math.cos(0) + Math.sin(-F) * ry * Math.sin(0);
    const y1 = ctr.y + Math.sin(F) * rx * Math.cos(0) + Math.cos(F) * ry * Math.sin(0);
    const x2 = ctr.x + Math.cos(F) * rx * Math.cos(Math.PI) + Math.sin(-F) * ry * Math.sin(Math.PI);
    const y2 = ctr.y + Math.sin(F) * rx * Math.cos(Math.PI) + Math.cos(F) * ry * Math.sin(Math.PI);
    const deg = (F * 360) / (2 * Math.PI);
    return parse_svg_path(
      ` M ${f(x1)},${f(y1)} A ${f(rx)} ${f(ry)} ${f(deg)} 0 0 ${f(x2)} ${f(y2)} A ${f(rx)} ${f(ry)} ${f(deg)} 0 0 ${f(x1)} ${f(y1)} z M 50000,50000 50000,-50000 -50000,-50000 -50000,50000 z`,
    );
  }

  /**
   * rectangular cutter. ctr "center" of rectangle (might not actually be in the center with
   * respect to leading/trailing edges), pos vector from center to leading edge, neg vector from
   * center to trailing edge, width vector to side edge.
   */
  static rect_cutter(ctr: Point, pos: Point, neg: Point, width: Point): PathVector {
    const cutter = new Path(ctr.add(pos).sub(width));
    const to = (p: Point) => cutter.appendCurve(new LineSegment(cutter.finalPoint(), p));
    to(ctr.add(pos).add(width));
    to(ctr.add(neg).add(width));
    to(ctr.add(neg).sub(width));
    cutter.close();
    return [cutter];
  }

  /** Convert from SPWindRule to livarot's FillRule. This is similar to what sp_selected_path_boolop() does */
  static SPWR_to_LVFR(wr: SPWindRule): FillRule {
    return wr === SPWindRule.SP_WIND_RULE_EVENODD ? FillRule.fill_oddEven : FillRule.fill_nonZero;
  }

  abstract create_brush(style: SPStyle | null, fcolor: U_COLORREF | null): number;
  abstract destroy_brush(): void;
  abstract create_pen(style: SPStyle | null, transform: Affine): number;
  abstract destroy_pen(): void;
}

/** The fill paint server (upstream SP_STYLE_FILL_SERVER). */
export function SP_STYLE_FILL_SERVER(style: SPStyle) {
  return style.getFillPaintServer();
}
/** The stroke paint server (upstream SP_STYLE_STROKE_SERVER). */
export function SP_STYLE_STROKE_SERVER(style: SPStyle) {
  return style.getStrokePaintServer();
}

/** The curves up to end_closed() (with a non-degenerate closing segment). */
export function closed_curves(p: Path): readonly Curve[] {
  return p.sizeClosed() > p.sizeOpen() ? [...p.openCurves(), p.closingSegment()] : p.openCurves();
}

/**
 * Break the paths into dashes (FixPPTDashLine). Upstream measures the path with an arc length
 * parametrization of its SBasis form; here the curves are measured by sampling (0.01 px is
 * the tolerance of upstream path_from_piecewise) and the dashes are made of line segments.
 */
export function dash_pathv(pathv: PathVector, dashes: readonly number[]): PathVector {
  // the whole path as one polyline (upstream concatenates the pieces of all paths)
  const pts: Point[] = [];
  for (const p of pathv) {
    for (const c of closed_curves(p)) {
      const n = is_straight_curve(c) ? 1 : 64;
      if (!pts.length) pts.push(c.initialPoint());
      for (let i = 1; i <= n; i++) pts.push(c.pointAt(i / n));
    }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + distance(pts[i - 1]!, pts[i]!));
  const tlength = cum.at(-1) ?? 0;
  const pointAt = (s: number): [Point, number] => {
    const i = cum.findIndex((c) => c >= s);
    if (i <= 0) return [pts[0]!, 0];
    const t = (s - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
    return [pts[i - 1]!.lerp(t, pts[i]!), i];
  };
  const portion = (from: number, to: number): Path | null => {
    if (to <= from) return null;
    const [a, ia] = pointAt(from);
    const [b, ib] = pointAt(to);
    const out = new Path(a);
    let last = a;
    for (let i = Math.max(ia, 1); i < ib; i++) {
      out.appendCurve(new LineSegment(last, pts[i]!));
      last = pts[i]!;
    }
    out.appendCurve(new LineSegment(last, b));
    return out;
  };

  const out: PathVector = [];
  let first_frag: Path | null = null;
  let i = 0; //dash index
  let slength = 0.0; // start of fragment
  // go around the dash array repeatedly until the entire path is consumed (but not beyond).
  while (slength < tlength && dashes.length) {
    let elength = slength + dashes[i++]!;
    if (elength > tlength) elength = tlength;
    const fragment = portion(slength, elength);
    if (slength) {
      if (fragment) out.push(fragment);
    } else {
      first_frag = fragment;
    }
    slength = elength;
    slength += dashes[i++] ?? 0; // the gap
    if (i >= dashes.length) i = 0;
  }
  if (first_frag) out.push(first_frag); // may merge line around start point
  return out;
}
