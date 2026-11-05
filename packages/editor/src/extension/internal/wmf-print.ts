// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/wmf-print.cpp, src/extension/internal/wmf-print.h
/*
 * Windows Metafile printing
 *
 * Authors:
 *   Ulf Erikson <ulferikson@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   David Mathog
 *
 * Copyright (C) 2006-2009 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 *
 * References:
 *  - How to Create & Play Enhanced Metafiles in Win32
 *      http://support.microsoft.com/kb/q145999/
 *  - INFO: Windows Metafile Functions & Aldus Placeable Metafiles
 *      http://support.microsoft.com/kb/q66949/
 *  - Metafile Functions
 *      http://msdn.microsoft.com/library/en-us/gdi/metafile_0whf.asp
 *  - Metafile Structures
 *      http://msdn.microsoft.com/library/en-us/gdi/metafile_5hkj.asp
 *
 * The records are made with libuemf in uemf-module.wasm (see uemf-backend.ts).
 */
import {
  BooleanOp,
  convertUnit,
  FillRule,
  is_straight_curve,
  pathv_to_linear_and_cubic_beziers,
  SPCSSFontStyle,
  type SPDocument,
  SPGradient,
  SPLinearGradient,
  SPPattern,
  SPRadialGradient,
  type SPStyle,
  sp_pathvector_boolop,
} from '@inkscape-web/core';
import {
  Affine,
  BezierCurve,
  CubicBezier,
  distance,
  LineSegment,
  type OptRect,
  Path,
  type PathVector,
  Point,
  unit_vector,
} from '@inkscape-web/geom';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import type { Print } from '../print.ts';
import { build_from_mem } from '../system.ts';
import { dash_pathv, type FontfixParams, MFDrawMode, PrintMetafile, toColorRef } from './metafile-print.ts';
import {
  cvt_to_font,
  type Ptr,
  point16_set,
  U_ALTERNATE,
  U_BCBM_COLOR32,
  U_BI_RGB,
  U_BS_HATCHED,
  U_BS_NULL,
  U_BS_SOLID,
  U_CLIP_DEFAULT_PRECIS,
  U_COLORONCOLOR,
  type U_COLORREF,
  U_DEFAULT_CHARSET,
  U_DEFAULT_PITCH,
  U_DEFAULT_QUALITY,
  U_DIB_RGB_COLORS,
  U_ETO_NONE,
  U_ETO_RTLREADING,
  U_FF_DONTCARE,
  U_HS_CROSS,
  U_HS_DIAGCROSS,
  U_HS_HORIZONTAL,
  U_HS_SOLIDCLR,
  U_MM_ANISOTROPIC,
  U_OPAQUE,
  U_OUT_DEFAULT_PRECIS,
  U_PEN_set,
  type U_POINT16,
  U_PS_DASH,
  U_PS_DASHDOT,
  U_PS_DASHDOTDOT,
  U_PS_DOT,
  U_PS_ENDCAP_FLAT,
  U_PS_ENDCAP_ROUND,
  U_PS_ENDCAP_SQUARE,
  U_PS_JOIN_BEVEL,
  U_PS_JOIN_MITER,
  U_PS_JOIN_ROUND,
  U_PS_NULL,
  U_PS_SOLID,
  U_R2_COPYPEN,
  U_RCL16_DEF,
  U_REC_FREE,
  U_RECT16_set,
  U_RGB,
  U_RGBAGetB,
  U_RGBAGetG,
  U_RGBAGetR,
  U_SRCCOPY,
  U_TA_BASELINE,
  U_TA_LEFT,
  U_TA_RIGHT,
  U_TA_RTLREADING,
  U_TRANSPARENT,
  U_WINDING,
  U_WLOGBRUSH_set,
} from './uemf-backend.ts';

const PXPERMETER = 2835;
const MAXDISP = 2.0; // This should be set in the output dialog.  This is ok for experimenting, no more than 2 pixel deviation.  Not actually used at present
/** The file of the WMF in the file system of the WASM module (upstream: the "destination"). */
const WMF_FILE = '/tmp/print.wmf';

/** C++ round(): halves away from zero. */
const round = (v: number) => (v < 0 ? -Math.round(-v) : Math.round(v));

/**
 * The points of a cubic Bezier between its end points (upstream recursive_bezier4 of
 * helper/geom.cpp, from curve4_div::recursive_bezier of AGG). With the angle tolerance 0 of
 * upstream the angle and cusp tests never run, so they are left out.
 */
function recursive_bezier4(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
  m_points: Point[],
  level: number,
): void {
  const curve_collinearity_epsilon = 1e-30;
  const m_distance_tolerance_square = 0.5 * 0.5;
  const curve_recursion_limit = 32;
  const calc_sq_distance = (a: number, b: number, c: number, d: number) =>
    (a - c) * (a - c) + (b - d) * (b - d);

  if (level > curve_recursion_limit) return;

  // Calculate all the mid-points of the line segments
  const x12 = (x1 + x2) / 2;
  const y12 = (y1 + y2) / 2;
  const x23 = (x2 + x3) / 2;
  const y23 = (y2 + y3) / 2;
  const x34 = (x3 + x4) / 2;
  const y34 = (y3 + y4) / 2;
  const x123 = (x12 + x23) / 2;
  const y123 = (y12 + y23) / 2;
  const x234 = (x23 + x34) / 2;
  const y234 = (y23 + y34) / 2;
  const x1234 = (x123 + x234) / 2;
  const y1234 = (y123 + y234) / 2;

  // Try to approximate the full cubic curve by a single straight line
  const dx = x4 - x1;
  const dy = y4 - y1;

  let d2 = Math.abs((x2 - x4) * dy - (y2 - y4) * dx);
  let d3 = Math.abs((x3 - x4) * dy - (y3 - y4) * dx);

  switch ((Number(d2 > curve_collinearity_epsilon) << 1) + Number(d3 > curve_collinearity_epsilon)) {
    case 0: {
      // All collinear OR p1==p4
      let k = dx * dx + dy * dy;
      if (k === 0) {
        d2 = calc_sq_distance(x1, y1, x2, y2);
        d3 = calc_sq_distance(x4, y4, x3, y3);
      } else {
        k = 1 / k;
        d2 = k * ((x2 - x1) * dx + (y2 - y1) * dy);
        d3 = k * ((x3 - x1) * dx + (y3 - y1) * dy);
        if (d2 > 0 && d2 < 1 && d3 > 0 && d3 < 1) {
          // Simple collinear case, 1---2---3---4
          // We can leave just two endpoints
          return;
        }
        if (d2 <= 0) d2 = calc_sq_distance(x2, y2, x1, y1);
        else if (d2 >= 1) d2 = calc_sq_distance(x2, y2, x4, y4);
        else d2 = calc_sq_distance(x2, y2, x1 + d2 * dx, y1 + d2 * dy);

        if (d3 <= 0) d3 = calc_sq_distance(x3, y3, x1, y1);
        else if (d3 >= 1) d3 = calc_sq_distance(x3, y3, x4, y4);
        else d3 = calc_sq_distance(x3, y3, x1 + d3 * dx, y1 + d3 * dy);
      }
      if (d2 > d3) {
        if (d2 < m_distance_tolerance_square) {
          m_points.push(new Point(x2, y2));
          return;
        }
      } else if (d3 < m_distance_tolerance_square) {
        m_points.push(new Point(x3, y3));
        return;
      }
      break;
    }
    case 1:
      // p1,p2,p4 are collinear, p3 is significant
      if (d3 * d3 <= m_distance_tolerance_square * (dx * dx + dy * dy)) {
        m_points.push(new Point(x23, y23));
        return;
      }
      break;
    case 2:
      // p1,p3,p4 are collinear, p2 is significant
      if (d2 * d2 <= m_distance_tolerance_square * (dx * dx + dy * dy)) {
        m_points.push(new Point(x23, y23));
        return;
      }
      break;
    case 3:
      // Regular case
      if ((d2 + d3) * (d2 + d3) <= m_distance_tolerance_square * (dx * dx + dy * dy)) {
        // If the curvature doesn't exceed the distance_tolerance value
        // we tend to finish subdivisions.
        m_points.push(new Point(x23, y23));
        return;
      }
      break;
  }

  // Continue subdivision
  recursive_bezier4(x1, y1, x12, y12, x123, y123, x1234, y1234, m_points, level + 1);
  recursive_bezier4(x1234, y1234, x234, y234, x34, y34, x4, y4, m_points, level + 1);
}

/** The path vector with all segments converted to lines (upstream pathv_to_linear of helper/geom.cpp). */
function pathv_to_linear(pathv: PathVector, _maxdisp: number): PathVector {
  const output: PathVector = [];
  const tmppath = pathv_to_linear_and_cubic_beziers(pathv);

  // Now all path segments are either already lines, or they are beziers.
  for (const pit of tmppath) {
    const out = new Path(pit.initialPoint());
    out.close(pit.closed());
    output.push(out);

    for (const cit of pit.openCurves()) {
      if (is_straight_curve(cit)) {
        out.appendCurve(new LineSegment(cit.initialPoint(), cit.finalPoint()));
      } else if (cit instanceof BezierCurve) {
        /* all others must be Bezier curves */
        const [A, B, C, D] = cit.controlPoints() as [Point, Point, Point, Point];
        const pointlist: Point[] = [A];
        recursive_bezier4(A.x, A.y, B.x, B.y, C.x, C.y, D.x, D.y, pointlist, 0);
        pointlist.push(D);
        for (let i = 1; i < pointlist.length; i++) {
          out.appendCurve(new LineSegment(pointlist[i - 1]!, pointlist[i]!));
        }
      }
    }
  }
  return output;
}

/** The WMF print (upstream PrintWmf). */
export class PrintWmf extends PrintMetafile {
  PX2WORLD = 1;
  FixPPTCharPos = false;
  FixPPTDashLine = false;
  FixPPTGrad2Polys = false;
  FixPPTPatternAsHatch = false;
  wt: Ptr = 0;
  wht: Ptr = 0;
  hbrush = 0;
  hpen = 0;
  hbrush_null = 0;
  hpen_null = 0;
  hmiterlimit = 0; // used to minimize redundant records that set this

  /** Append a record (upstream: wmf_append, g_error on failure). */
  #append(rec: Ptr, where: string): void {
    if (!rec || this.uemf.wmf_append(rec, this.wt, U_REC_FREE)) {
      throw new Error(`Fatal programming error in PrintWmf::${where}`);
    }
  }

  /** Append a record in begin(): false (and a warning) on failure. */
  #begin_append(rec: Ptr, where: string): boolean {
    if (!rec || this.uemf.wmf_append(rec, this.wt, U_REC_FREE)) {
      console.warn(`Failed in PrintWmf::begin at ${where}`);
      return false;
    }
    return true;
  }

  /** Read the character widths, y kern and direction that Layout::print smuggles in after the text. */
  static smuggle_adxky_out(
    string: string,
    scale: number,
  ): { text: string; adx: number[]; ky: number; rtl: number; ndx: number } {
    const nul = string.indexOf('\0');
    const text = nul < 0 ? string : string.slice(0, nul);
    const adx: number[] = [];
    if (nul < 0) return { text, adx, ky: 0, rtl: 0, ndx: 0 };
    let cptr = nul + 1; // this works because of the first fake terminator
    const ndx = Number.parseInt(string.slice(cptr, cptr + 7), 10) || 0;
    if (!ndx) return { text, adx, ky: 0, rtl: 0, ndx }; // this could happen with an empty string
    cptr += 7;
    for (let i = 0; i < ndx; i++, cptr += 7) {
      const fdx = Math.fround(Number.parseFloat(string.slice(cptr, cptr + 7)));
      adx.push((round(Math.fround(fdx * scale)) << 16) >> 16); // int16_t
    }
    cptr++; // skip 2nd fake terminator
    const ky = Math.fround(Number.parseFloat(string.slice(cptr, cptr + 7)));
    cptr += 7; // advance over ky and its space
    const rtl = Number.parseInt(string.slice(cptr, cptr + 7), 10);
    return { text, adx, ky, rtl, ndx };
  }

  override setup(_mod: Print): number {
    return 1;
  }

  override begin(mod: Print, doc: SPDocument): number {
    const uemf = this.uemf;

    // Typically PX2WORLD is 1200/90, using inkscape's default dpi
    this.PX2WORLD = 1200.0 / convertUnit(1.0, 'in', 'px');
    this.FixPPTCharPos = mod.get_param_bool('FixPPTCharPos');
    this.FixPPTDashLine = mod.get_param_bool('FixPPTDashLine');
    this.FixPPTGrad2Polys = mod.get_param_bool('FixPPTGrad2Polys');
    this.FixPPTPatternAsHatch = mod.get_param_bool('FixPPTPatternAsHatch');

    // The file name of upstream ("destination") is not needed: the WMF goes to WMF_FILE.
    this.wt = uemf.wmf_start(WMF_FILE, 1000000, 250000).wt; // Initialize the wt structure
    this.wht = uemf.wmf_htable_create(128, 128); // Initialize the wht structure
    this.m_tr_stack = [];

    // WMF header the only things that can be set are the page size in inches (w,h) and the dpi
    // width and height in px

    // initialize a few global variables
    this.hbrush = this.hpen = 0;
    this.htextalignment = U_TA_BASELINE | U_TA_LEFT;
    this.use_stroke = this.use_fill = this.simple_shape = this.usebk = false;

    const p1 = doc.getNamedView().getAttribute('pagecolor');
    if (p1) {
      let lc = Number.parseInt(p1.slice(1), 16); // it looks like "#ABC123"
      if (!/^#[0-9a-fA-F]+$/.test(p1)) lc = 0;
      this.gv.bgc = PrintMetafile._gethexcolor(lc);
      this.gv.rgb = [
        U_RGBAGetR(this.gv.bgc) / 255.0,
        U_RGBAGetG(this.gv.bgc) / 255.0,
        U_RGBAGetB(this.gv.bgc) / 255.0,
      ];
    }

    const pageBoundingBox = mod.get_param_bool('pageBoundingBox');

    let d: OptRect = null;
    if (pageBoundingBox) {
      d = doc.preferredBounds();
    } else {
      d = doc.getRoot().desktopVisualBounds();
    }

    const inches = convertUnit(1, 'px', 'in'); // 90 dpi inside inkscape, wmf file will be 1200 dpi

    /* -1/1200 in next two lines so that WMF read in will write out again at exactly the same size */
    const dwInchesX = Math.fround((d?.width() ?? 0) * inches - 1.0 / 1200.0);
    const dwInchesY = Math.fround((d?.height() ?? 0) * inches - 1.0 / 1200.0);
    const dwPxX = round(dwInchesX * 1200.0);
    const dwPxY = round(dwInchesY * 1200.0);

    const ps = uemf.U_PAIRF_set(dwInchesX, dwInchesY);
    const rec = uemf.U_WMRHEADER_set(ps, 1200); // Example: drawing is A4 horizontal,  1200 dpi
    uemf.free(ps);
    if (!rec) {
      console.warn('Failed in PrintWmf::begin at WMRHEADER');
      return -1;
    }
    uemf.wmf_header_append(rec, this.wt, 1);

    if (!this.#begin_append(uemf.U_WMRSETWINDOWEXT_set(point16_set(dwPxX, dwPxY)), 'WMRSETWINDOWEXT'))
      return -1;
    if (!this.#begin_append(uemf.U_WMRSETWINDOWORG_set(point16_set(0, 0)), 'WMRSETWINDOWORG')) return -1;
    if (!this.#begin_append(uemf.U_WMRSETMAPMODE_set(U_MM_ANISOTROPIC), 'WMRSETMAPMODE')) return -1;

    /* set some parameters, else the program that reads the WMF may default to other values */
    if (!this.#begin_append(uemf.U_WMRSETBKMODE_set(U_TRANSPARENT), 'U_WMRSETBKMODE')) return -1;

    this.hpolyfillmode = U_WINDING;
    if (!this.#begin_append(uemf.U_WMRSETPOLYFILLMODE_set(U_WINDING), 'U_WMRSETPOLYFILLMODE')) return -1;

    // Text alignment:  (only changed if RTL text is encountered )
    //   - (x,y) coordinates received by this filter are those of the point where the text
    //     actually starts, and already takes into account the text object's alignment;
    //   - for this reason, the WMF text alignment must always be TA_BASELINE|TA_LEFT.
    if (!this.#begin_append(uemf.U_WMRSETTEXTALIGN_set(U_TA_BASELINE | U_TA_LEFT), 'U_WMRSETTEXTALIGN_set')) {
      return -1;
    }

    this.htextcolor_rgb = null;
    if (!this.#begin_append(uemf.U_WMRSETTEXTCOLOR_set(U_RGB(0, 0, 0)), 'U_WMRSETTEXTCOLOR_set')) return -1;

    if (!this.#begin_append(uemf.U_WMRSETROP2_set(U_R2_COPYPEN), 'U_WMRSETROP2')) return -1;

    this.hmiterlimit = 5;
    if (!this.#begin_append(uemf.wmiterlimit_set(5), 'wmiterlimit_set')) return -1;

    // create a pen as object 0.  We never use it (except by mistake).  Its purpose it to make all of the other object indices >=1
    let up = U_PEN_set(U_PS_SOLID, 1, U_RGB(0, 0, 0));
    let r = uemf.wcreatepenindirect_set(this.wht, up);
    if (!this.#begin_append(r.rec, 'wcreatepenindirect_set')) return -1;

    // create a null pen.  If no specific pen is set, this is used
    up = U_PEN_set(U_PS_NULL, 1, U_RGB(0, 0, 0));
    r = uemf.wcreatepenindirect_set(this.wht, up);
    this.hpen_null = r.ih;
    if (!this.#begin_append(r.rec, 'wcreatepenindirect_set')) return -1;
    this.destroy_pen(); // make this pen active

    // create a null brush.  If no specific brush is set, this is used
    const lb = U_WLOGBRUSH_set(U_BS_NULL, U_RGB(0, 0, 0), U_HS_HORIZONTAL);
    r = uemf.wcreatebrushindirect_set(this.wht, lb);
    this.hbrush_null = r.ih;
    if (!this.#begin_append(r.rec, 'wcreatebrushindirect_set')) return -1;
    this.destroy_brush(); // make this brush active

    return 0;
  }

  override finish(_mod: Print): Uint8Array | null {
    const uemf = this.uemf;
    if (!this.wt) return null;

    // get rid of null brush
    this.#append(
      uemf.wdeleteobject_set(this.hbrush_null, this.wht),
      'finish at wdeleteobject_set null brush',
    );

    // get rid of null pen
    this.#append(uemf.wdeleteobject_set(this.hpen_null, this.wht), 'finish at wdeleteobject_set null pen');

    // get rid of object 0, which was a pen that was used to shift the other object indices to >=1.
    this.hpen = 0;
    this.#append(uemf.wdeleteobject_set(this.hpen, this.wht), 'finish at wdeleteobject_set filler object');

    this.#append(uemf.U_WMREOF_set(), 'finish'); // generate the EOF record
    uemf.wmf_finish(this.wt); // Finalize and write out the WMF
    uemf.uwmf_free(this.wt); // clean up
    uemf.wmf_htable_free(this.wht); // clean up
    this.wt = this.wht = 0;
    return uemf.read_file(WMF_FILE);
  }

  /** fcolor is defined when gradients are being expanded, it is the color of one stripe or ring. */
  override create_brush(style: SPStyle | null, fcolor: U_COLORREF | null): number {
    const uemf = this.uemf;
    let brush = 0;
    let pixbuf = null;
    let width = 0; // quiets a harmless compiler warning, initialization not otherwise required.
    let height = 0;

    if (!this.wt) return 0;

    // set a default fill in case we can't figure out a better way to do it
    let fmode = U_ALTERNATE;
    let fill_mode = MFDrawMode.DRAW_PAINT;
    let brushStyle = U_BS_SOLID;
    let hatchType = U_HS_SOLIDCLR;
    let bkColor = U_RGB(0, 0, 0);
    let hatchColor = fcolor ?? U_RGB(0, 0, 0);

    if (!fcolor && style) {
      const server = style.getFillPaintServer();
      if (style.fill.isColor()) {
        fill_mode = MFDrawMode.DRAW_PAINT;
        hatchColor = toColorRef(style.fill.getColor());
        fmode = style.fill_rule.computed === 0 ? U_WINDING : U_ALTERNATE;
      } else if (server instanceof SPPattern) {
        // must be paint-server
        width = Math.trunc(server.width());
        height = Math.trunc(server.height());
        const out = { epixbuf: null, hatchType, hatchColor, bkColor } as Parameters<
          typeof this.brush_classify
        >[2];
        this.brush_classify(server, 0, out);
        ({ hatchType, hatchColor, bkColor } = out);
        pixbuf = out.epixbuf;
        if (pixbuf) {
          fill_mode = MFDrawMode.DRAW_IMAGE;
        } else {
          // pattern
          fill_mode = MFDrawMode.DRAW_PATTERN;
          if (hatchType === -1) {
            // Not a standard hatch, so force it to something
            hatchType = U_HS_CROSS;
            hatchColor = U_RGB(0xff, 0xc3, 0xc3);
          }
        }
        if (this.FixPPTPatternAsHatch) {
          if (hatchType === -1) {
            // image or unclassified
            fill_mode = MFDrawMode.DRAW_PATTERN;
            hatchType = U_HS_DIAGCROSS;
            hatchColor = U_RGB(0xff, 0xc3, 0xc3);
          }
        }
        brushStyle = U_BS_HATCHED;
      } else if (server instanceof SPGradient) {
        // must be a gradient
        // currently we do not do anything with gradients, the code below just sets the color to the average of the stops
        let lg: SPLinearGradient | null = null;
        let rg: SPRadialGradient | null = null;

        if (server instanceof SPLinearGradient) {
          lg = server;
          lg.ensureVector(); // when exporting from commandline, vector is not built
          fill_mode = MFDrawMode.DRAW_LINEAR_GRADIENT;
        } else if (server instanceof SPRadialGradient) {
          rg = server;
          rg.ensureVector(); // when exporting from commandline, vector is not built
          fill_mode = MFDrawMode.DRAW_RADIAL_GRADIENT;
        }

        if (rg) {
          if (this.FixPPTGrad2Polys) return this.hold_gradient(rg, fill_mode);
          hatchColor = this.avg_stop_color(rg);
        } else if (lg) {
          if (this.FixPPTGrad2Polys) return this.hold_gradient(lg, fill_mode);
          hatchColor = this.avg_stop_color(lg);
        }
      }
    }

    switch (fill_mode) {
      case MFDrawMode.DRAW_LINEAR_GRADIENT: // fill with average color unless gradients are converted to slices
      case MFDrawMode.DRAW_RADIAL_GRADIENT: // ditto
      case MFDrawMode.DRAW_PAINT:
      case MFDrawMode.DRAW_PATTERN: {
        // SVG text has no background attribute, so OPAQUE mode ALWAYS cancels after the next draw, otherwise it would mess up future text output.
        if (this.usebk) {
          this.#append(uemf.U_WMRSETBKCOLOR_set(bkColor), 'create_brush at U_WMRSETBKCOLOR_set');
          this.#append(uemf.U_WMRSETBKMODE_set(U_OPAQUE), 'create_brush at U_WMRSETBKMODE_set');
        }
        const lb = U_WLOGBRUSH_set(brushStyle, hatchColor, hatchType);
        const r = uemf.wcreatebrushindirect_set(this.wht, lb);
        brush = r.ih;
        this.#append(r.rec, 'create_brush at createbrushindirect_set');
        break;
      }
      case MFDrawMode.DRAW_IMAGE: {
        const colortype = U_BCBM_COLOR32;
        // the pixels are RGBA, so the R and B swap of upstream for PF_CAIRO is not needed
        const dib = uemf.RGBA_to_DIB(pixbuf!.data as Uint8Array, width, height, width * 4, colortype, 0, 1);
        const Bmih = uemf.bitmapinfoheader_set(
          width,
          height,
          1,
          colortype,
          U_BI_RGB,
          0,
          PXPERMETER,
          PXPERMETER,
          dib.numCt,
          0,
        );
        const Bmi = uemf.bitmapinfo_set(Bmih, dib.ct);
        const r = uemf.wcreatedibpatternbrush_srcdib_set(this.wht, U_DIB_RGB_COLORS, Bmi, dib.cbPx, dib.px);
        brush = r.ih;
        this.#append(r.rec, 'create_brush at createdibpatternbrushpt_set');
        uemf.free(dib.px);
        uemf.free(Bmi); // ct will be NULL because of colortype
        break;
      }
    }

    this.hbrush = brush; // need this later for destroy_brush
    this.#append(uemf.wselectobject_set(brush, this.wht), 'create_brush at wselectobject_set');

    if (fmode !== this.hpolyfillmode) {
      this.hpolyfillmode = fmode;
      this.#append(uemf.U_WMRSETPOLYFILLMODE_set(fmode), 'create_brush at U_WMRSETPOLYFILLMODE_set');
    }
    return 0;
  }

  override destroy_brush(): void {
    // WMF lets any object be deleted whenever, and the chips fall where they may...
    if (this.hbrush) {
      this.#append(this.uemf.wdeleteobject_set(this.hbrush, this.wht), 'destroy_brush');
      this.hbrush = 0;
    }

    // (re)select the null brush
    this.#append(this.uemf.wselectobject_set(this.hbrush_null, this.wht), 'destroy_brush');
  }

  override create_pen(style: SPStyle | null, transform: Affine): number {
    const uemf = this.uemf;

    if (!this.wt) return 0;

    // set a default stroke  in case we can't figure out a better way to do it
    let penstyle = U_PS_SOLID;
    let modstyle = 0;
    let penColor = U_RGB(0, 0, 0);
    let linewidth = 1;

    if (style) {
      // override some or all of the preceding

      // WMF does not support hatched, bitmap, or gradient pens, just set the color.
      penColor = toColorRef(style.stroke.getColor());

      const p0 = new Point(0, 0).transformed(transform);
      const p1 = new Point(1, 1).transformed(transform);
      const p = p1.sub(p0);

      const scale = Math.sqrt(p.x * p.x + p.y * p.y) / Math.sqrt(2);

      if (!style.stroke_width.computed) {
        return 0; //if width is 0 do not (reset) the pen, it should already be NULL_PEN
      }
      linewidth = Math.max(1, round(scale * style.stroke_width.computed * this.PX2WORLD) >>> 0);

      // most WMF readers will ignore linecap and linejoin, but set them anyway.  Inkscape itself can read them back in.

      if (style.stroke_linecap.computed === 0) {
        modstyle |= U_PS_ENDCAP_FLAT;
      } else if (style.stroke_linecap.computed === 1) {
        modstyle |= U_PS_ENDCAP_ROUND;
      } else {
        modstyle |= U_PS_ENDCAP_SQUARE;
      }

      if (style.stroke_linejoin.computed === 0) {
        let miterlimit = Math.fround(style.stroke_miterlimit.value); // This is a ratio.
        if (miterlimit < 1) miterlimit = 1;

        // most WMF readers will ignore miterlimit, but set it anyway.  Inkscape itself can read it back in
        if (Math.trunc(miterlimit) !== this.hmiterlimit) {
          this.hmiterlimit = Math.trunc(miterlimit);
          this.#append(uemf.wmiterlimit_set(Math.trunc(miterlimit)), 'create_pen at wmiterlimit_set');
        }
        modstyle |= U_PS_JOIN_MITER;
      } else if (style.stroke_linejoin.computed === 1) {
        modstyle |= U_PS_JOIN_ROUND;
      } else {
        modstyle |= U_PS_JOIN_BEVEL;
      }

      const values = style.stroke_dasharray.values;
      if (values.length) {
        if (!this.FixPPTDashLine) {
          // if this is set code elsewhere will break dots/dashes into many smaller lines.
          const n_dash = values.length;
          /* options are dash, dot, dashdot and dashdotdot.  Try to pick the closest one. */
          let mark_short = 0x7fffffff;
          let mark_long = 0;
          for (const v of values) {
            const mark = Math.trunc(v.value);
            if (mark > mark_long) mark_long = mark;
            if (mark < mark_short) mark_short = mark;
          }
          if (mark_long === mark_short) {
            // only one mark size
            penstyle = U_PS_DOT;
          } else if (n_dash === 2) {
            penstyle = U_PS_DASH;
          } else if (n_dash === 4) {
            penstyle = U_PS_DASHDOT;
          } else {
            penstyle = U_PS_DASHDOTDOT;
          }
        }
      }
    }

    const up = U_PEN_set(penstyle | modstyle, linewidth, penColor);
    const r = uemf.wcreatepenindirect_set(this.wht, up);
    this.#append(r.rec, 'create_pen at wcreatepenindirect_set');

    this.#append(uemf.wselectobject_set(r.ih, this.wht), 'create_pen at wselectobject_set');
    this.hpen = r.ih; // need this later for destroy_pen

    return 0;
  }

  /** delete the defined pen object */
  override destroy_pen(): void {
    // WMF lets any object be deleted whenever, and the chips fall where they may...
    if (this.hpen) {
      this.#append(this.uemf.wdeleteobject_set(this.hpen, this.wht), 'destroy_pen');
      this.hpen = 0;
    }

    // (re)select the null pen
    this.#append(this.uemf.wselectobject_set(this.hpen_null, this.wht), 'destroy_pen');
  }

  override fill(
    _mod: Print,
    pathv: PathVector,
    _transform: Affine,
    style: SPStyle,
    _pbox: OptRect,
    _dbox: OptRect,
    _bbox: OptRect,
  ): number {
    const tf = this.m_tr_stack.at(-1) ?? Affine.identity();

    this.use_fill = true;
    this.use_stroke = false;

    this.fill_transform = tf;

    if (this.create_brush(style, null)) {
      /*
          Handle gradients.  Uses modified livarot as 2geom boolops is currently broken.
          Can handle gradients with multiple stops.

          The overlap is needed to avoid antialiasing artifacts when edges are not strictly aligned on pixel boundaries.
          There is an inevitable loss of accuracy saving through an WMF file because of the integer coordinate system.
          Keep the overlap quite large so that loss of accuracy does not remove an overlap.
      */
      this.destroy_pen(); //this sets the NULL_PEN, otherwise gradient slices may display with boundaries, see longer explanation below
      const frb = PrintMetafile.SPWR_to_LVFR(style.fill_rule.computed);
      let doff: number;
      let doff_base: number;
      let doff_range: number;
      const divisions = 128.0;
      let istop = 1;

      const tg = this.gv.grad!; // linear/radial are the same here
      const stops = tg.vector.stops;
      const nstops = stops.length;
      let c1 = toColorRef(stops[0]?.color);
      let c2 = toColorRef(stops[nstops - 1]?.color);

      doff = 0.0;
      doff_base = 0.0;
      doff_range = stops[1]?.offset ?? 1; // next or last stop

      if (this.gv.mode === MFDrawMode.DRAW_RADIAL_GRADIENT) {
        const xv = this.gv.p2.sub(this.gv.p1); // X'  vector
        const yv = this.gv.p3.sub(this.gv.p1); // Y'  vector
        const xuv = unit_vector(xv); // X' unit vector
        const rx = Math.hypot(xv.x, xv.y);
        const ry = Math.hypot(yv.x, yv.y);
        const range = Math.max(rx, ry); // length along the gradient
        const step = range / divisions; // adequate approximation for gradient
        const overlap = step / 4.0; // overlap slices slightly

        /*  radial gradient might stop part way through the shape, fill with outer color from there to "infinity".
            Do this first so that outer colored ring will overlay it.
        */
        let pathvc = PrintMetafile.center_elliptical_hole_as_SVG_PathV(
          this.gv.p1,
          rx * (1.0 - overlap / range),
          ry * (1.0 - overlap / range),
          Math.asin(xuv.y),
        );
        let pathvr = sp_pathvector_boolop(
          pathvc,
          pathv,
          BooleanOp.bool_op_inters,
          FillRule.fill_oddEven,
          frb,
        );
        let wc = this.weight_opacity(c2);
        this.create_brush(style, wc);
        this.print_pathv(pathvr, this.fill_transform);

        c2 = toColorRef(stops[istop]?.color);

        for (let start = 0.0; start < range; start += step, doff += 1 / divisions) {
          let stop = start + step + overlap;
          if (stop > range) stop = range;
          wc = this.weight_colors(c1, c2, (doff - doff_base) / (doff_range - doff_base));
          this.create_brush(style, wc);

          pathvc = PrintMetafile.center_elliptical_ring_as_SVG_PathV(
            this.gv.p1,
            (rx * start) / range,
            (ry * start) / range,
            (rx * stop) / range,
            (ry * stop) / range,
            Math.asin(xuv.y),
          );

          pathvr = sp_pathvector_boolop(pathvc, pathv, BooleanOp.bool_op_inters, FillRule.fill_nonZero, frb);
          this.print_pathv(pathvr, this.fill_transform); // show the intersection

          if (doff >= doff_range - doff_base) {
            istop++;
            if (istop >= nstops) continue; // could happen on a rounding error
            doff_base = doff_range;
            doff_range = stops[istop]!.offset; // next or last stop
            c1 = c2;
            c2 = toColorRef(stops[istop]!.color);
          }
        }
      } else if (this.gv.mode === MFDrawMode.DRAW_LINEAR_GRADIENT) {
        const uv = unit_vector(this.gv.p2.sub(this.gv.p1)); // unit vector
        const puv = uv.cw(); // perp. to unit vector
        const range = distance(this.gv.p1, this.gv.p2); // length along the gradient
        const step = range / divisions; // adequate approximation for gradient
        const overlap = step / 4.0; // overlap slices slightly

        /* before lower end of gradient, overlap first slice position */
        let wc = this.weight_opacity(c1);
        this.create_brush(style, wc);
        let pathvc = PrintMetafile.rect_cutter(
          this.gv.p1,
          uv.mul(overlap),
          uv.mul(-50000.0),
          puv.mul(50000.0),
        );
        let pathvr = sp_pathvector_boolop(
          pathvc,
          pathv,
          BooleanOp.bool_op_inters,
          FillRule.fill_nonZero,
          frb,
        );
        this.print_pathv(pathvr, this.fill_transform);

        /* after high end of gradient, overlap last slice position */
        wc = this.weight_opacity(c2);
        this.create_brush(style, wc);
        pathvc = PrintMetafile.rect_cutter(this.gv.p2, uv.mul(-overlap), uv.mul(50000.0), puv.mul(50000.0));
        pathvr = sp_pathvector_boolop(pathvc, pathv, BooleanOp.bool_op_inters, FillRule.fill_nonZero, frb);
        this.print_pathv(pathvr, this.fill_transform);

        c2 = toColorRef(stops[istop]?.color);

        for (let start = 0.0; start < range; start += step, doff += 1 / divisions) {
          let stop = start + step + overlap;
          if (stop > range) stop = range;
          pathvc = PrintMetafile.rect_cutter(this.gv.p1, uv.mul(start), uv.mul(stop), puv.mul(50000.0));

          wc = this.weight_colors(c1, c2, (doff - doff_base) / (doff_range - doff_base));
          this.create_brush(style, wc);
          pathvr = sp_pathvector_boolop(pathvc, pathv, BooleanOp.bool_op_inters, FillRule.fill_nonZero, frb);
          this.print_pathv(pathvr, this.fill_transform); // show the intersection

          if (doff >= doff_range - doff_base) {
            istop++;
            if (istop >= nstops) continue; // could happen on a rounding error
            doff_base = doff_range;
            doff_range = stops[istop]!.offset; // next or last stop
            c1 = c2;
            c2 = toColorRef(stops[istop]!.color);
          }
        }
      } else {
        throw new Error('Fatal programming error in PrintWmf::fill, invalid gradient type detected');
      }
      this.use_fill = false; // gradients handled, be sure stroke does not use stroke and fill
    } else {
      /*
          Inkscape was not calling create_pen for objects with no border.
          This was because it never called stroke() (next method).
          PPT, and presumably others, pick whatever they want for the border if it is not specified, so no border can
          become a visible border.
          To avoid this force the pen to NULL_PEN if we can determine that no pen will be needed after the fill.
      */
      if (style.stroke.noneSet || style.stroke_width.computed === 0.0) this.destroy_pen(); //this sets the NULL_PEN

      /*  postpone fill in case stroke also required AND all stroke paths closed
          Dashes converted to line segments will "open" a closed path.
      */
      let all_closed = true;
      for (const pit of pathv) {
        if (pit.openCurves().length && !pit.closed()) all_closed = false;
      }
      if (
        style.stroke.isNone() ||
        style.stroke.noneSet ||
        style.stroke_width.computed === 0.0 ||
        (style.stroke_dasharray.values.length && this.FixPPTDashLine) ||
        !all_closed
      ) {
        this.print_pathv(pathv, this.fill_transform); // do any fills. side effect: clears fill_pathv
        this.use_fill = false;
      }
    }
    return 0;
  }

  override stroke(
    _mod: Print,
    pathv: PathVector,
    _transform: Affine,
    style: SPStyle,
    _pbox: OptRect,
    _dbox: OptRect,
    _bbox: OptRect,
  ): number {
    const tf = this.m_tr_stack.at(-1) ?? Affine.identity();

    this.use_stroke = true;
    //  use_fill was set in ::fill, if it is needed, if not, the null brush is used, it should be already set

    if (this.create_pen(style, tf)) return 0;

    if (style.stroke_dasharray.values.length && this.FixPPTDashLine) {
      // convert the path, gets its complete length, and then make a new path with parameter length instead of t
      const out_pathv = dash_pathv(
        pathv,
        style.stroke_dasharray.values.map((v) => v.value),
      );
      this.print_pathv(out_pathv, tf);
    } else {
      this.print_pathv(pathv, tf);
    }

    this.use_stroke = false;
    this.use_fill = false;

    if (this.usebk) {
      // OPAQUE was set, revert to TRANSPARENT
      this.usebk = false;
      this.#append(this.uemf.U_WMRSETBKMODE_set(U_TRANSPARENT), 'stroke at U_WMRSETBKMODE_set');
    }
    return 0;
  }

  /**
   * Draws simple_shapes, those with closed WMR_* primitives, like polygons, rectangles and
   * ellipses. These use whatever the current pen/brush are and need not be followed by a
   * FILLPATH or STROKEPATH. For other paths it sets a few flags and returns.
   */
  print_simple_shape(pathv: PathVector, transform: Affine): boolean {
    const pv = pathv_to_linear(
      pathv.map((p) => p.transformed(transform)),
      MAXDISP,
    );

    let nodes = 0;
    let moves = 0;
    let lines = 0;
    let curves = 0;

    for (const pit of pv) {
      moves++;
      nodes++;
      for (const cit of pit.openCurves()) {
        nodes++;
        if (is_straight_curve(cit)) {
          lines++;
        } else if (cit instanceof CubicBezier) {
          curves++;
        }
      }
    }

    if (!nodes) return false;

    const lpPoints: U_POINT16[] = [];
    const pt = (p: Point): U_POINT16 => point16_set(round(p.x * this.PX2WORLD), round(p.y * this.PX2WORLD));

    /**
     * For all Subpaths in the <path>
     */
    for (const pit of pv) {
      lpPoints.push(pt(pit.initialPoint()));
      /**
       * For all segments in the subpath
       */
      for (const cit of pit.openCurves()) {
        if (is_straight_curve(cit)) {
          lpPoints.push(pt(cit.finalPoint()));
        } else if (cit instanceof CubicBezier) {
          const points = cit.controlPoints();
          lpPoints.push(pt(points[1]!), pt(points[2]!), pt(points[3]!));
        }
      }
    }

    let done = false;
    const last = lpPoints.at(-1)!;
    const closed = lpPoints[0]!.x === last.x && lpPoints[0]!.y === last.y;
    let polygon = false;
    const rectangle = false;
    const ellipse = false;

    if (moves === 1 && moves + lines === nodes && closed) {
      polygon = true;
      //        if (nodes==5) {                             // disable due to LP Bug 407394
    } else if (moves === 1 && nodes === 5 && moves + curves === nodes && closed) {
      //        disable due to LP Bug 407394
    }

    if (polygon || ellipse) {
      // pens and brushes already set by caller, do not touch them
      let rec: Ptr = 0;
      if (polygon) {
        if (rectangle) {
          rec = this.uemf.U_WMRRECTANGLE_set(U_RECT16_set(lpPoints[0]!, lpPoints[2]!));
        } else {
          rec = this.uemf.U_WMRPOLYGON_set(lpPoints.slice(0, nodes));
        }
      } else if (ellipse) {
        rec = this.uemf.U_WMRELLIPSE_set(
          U_RECT16_set({ x: lpPoints[6]!.x, y: lpPoints[3]!.y }, { x: lpPoints[0]!.x, y: lpPoints[9]!.y }),
        );
      }
      this.#append(rec, 'print_simple_shape at rectangle/ellipse/polygon');

      done = true;
    }
    return done;
  }

  /**
   * Some parts based on win32.cpp by Lauris Kaplinski <lauris@kaplinski.com>. Limitations:
   * images lose their rotation (one corner stays in the same place), transparency is lost on
   * export (a limitation of the WMF format), and it probably messes up if row stride != w*4.
   */
  override image(
    _mod: Print,
    rgba_px: Uint8Array, // array of pixel values, Gdk::Pixbuf bitmap format
    w: number, // width of bitmap
    h: number, // height of bitmap
    rs: number, // row stride (normally w*4)
    tf_rect: Affine, // affine transform only used for defining location and size of rect, for all other transforms, use the one from m_tr_stack
    _style: SPStyle, // provides indirect link to image object
  ): number {
    const uemf = this.uemf;
    const tf = this.m_tr_stack.at(-1) ?? Affine.identity();

    this.#append(uemf.U_WMRSETSTRETCHBLTMODE_set(U_COLORONCOLOR), 'image at EMRHEADER');

    const x1 = tf_rect.c4;
    const y1 = tf_rect.c5;
    const dw = w * tf_rect.c0;
    const dh = h * tf_rect.c3;
    const pLL = new Point(x1, y1);
    const pLL2 = pLL.transformed(tf); //location of LL corner in Inkscape coordinates

    /* adjust scale of w and h.  This works properly when there is no rotation. The values are
    a bit strange when there is rotation, but since WMF cannot handle rotation in any case, all
    answers are equally wrong.
    */
    const pWH = new Point(dw, dh);
    const pWH2 = pWH.transformed(tf.withoutTranslation());

    const colortype = U_BCBM_COLOR32;
    const dib = uemf.RGBA_to_DIB(rgba_px, w, h, w * 4, colortype, 0, 1);
    const Bmih = uemf.bitmapinfoheader_set(
      w,
      h,
      1,
      colortype,
      U_BI_RGB,
      0,
      PXPERMETER,
      PXPERMETER,
      dib.numCt,
      0,
    );
    const Bmi = uemf.bitmapinfo_set(Bmih, dib.ct);

    const Dest = point16_set(round(pLL2.x * this.PX2WORLD), round(pLL2.y * this.PX2WORLD));
    const cDest = point16_set(round(pWH2.x * this.PX2WORLD), round(pWH2.y * this.PX2WORLD));
    const Src = point16_set(0, 0);
    const cSrc = point16_set(w, h);
    const rec = uemf.U_WMRSTRETCHDIB_set(
      Dest, //! Destination UL corner in logical units
      cDest, //! Destination W & H in logical units
      Src, //! Source UL corner in logical units
      cSrc, //! Source W & H in logical units
      U_DIB_RGB_COLORS, //! DIBColors Enumeration
      U_SRCCOPY, //! RasterOPeration Enumeration
      Bmi, //! (Optional) bitmapbuffer (U_BITMAPINFO section)
      h * rs, //! size in bytes of px
      dib.px, //! (Optional) bitmapbuffer (U_BITMAPINFO section)
    );
    this.#append(rec, 'image at U_WMRSTRETCHDIB_set');
    uemf.free(dib.px);
    uemf.free(Bmi);
    if (dib.numCt) uemf.free(dib.ct);
    return 0;
  }

  /** may also be called with a simple_shape or an empty path, whereupon it just returns without doing anything */
  print_pathv(pathv: PathVector, transform: Affine): number {
    const uemf = this.uemf;
    this.simple_shape = this.print_simple_shape(pathv, transform);
    if (!this.simple_shape && pathv.length) {
      // WMF does not have beziers, need to convert to ONLY  linears with something like this:
      const pv = pathv_to_linear(
        pathv.map((p) => p.transformed(transform)),
        MAXDISP,
      );
      const pt = (p: Point): U_POINT16 => point16_set(round(p.x * this.PX2WORLD), round(p.y * this.PX2WORLD));

      /**
       * For all Subpaths in the <path>
       */

      /* If the path consists entirely of closed subpaths use one polypolygon.
          Otherwise use a mix of  polygon or polyline separately on each path.
          If the polyline turns out to be single line segments, use a series of MOVETO/LINETO instead,
          because WMF has no POLYPOLYLINE.
          The former allows path delimited donuts and the like, which
          cannot be represented in WMF with polygon or polyline because there is no external way to combine paths
          as there is in EMF or SVG.
          For polygons specify the last point the same as the first.  The WMF/EMF manuals say that the
          reading program SHOULD close the path, which allows a conforming program not to, potentially rendering
          a closed path as an open one. */
      let nPolys = 0;
      for (const pit of pv) {
        if (pit.closed()) {
          nPolys++;
        } else {
          nPolys = 0;
          break;
        }
      }

      if (nPolys > 1) {
        // a single polypolygon, a single polygon falls through to the else
        const pt16: U_POINT16[] = [];
        const n16: number[] = [];
        for (const pit of pv) {
          n16.push(pit.size()); // points in the subpath

          /**
           * For each segment in the subpath
           */
          pt16.push(pt(pit.initialPoint())); // This point is special, it isn't in the iterator
          for (const cit of pit.openCurves()) pt16.push(pt(cit.finalPoint()));
        }
        this.#append(uemf.U_WMRPOLYPOLYGON_set(n16, pt16), 'print_pathv at U_WMRPOLYPOLYGON_set');
      } else {
        // one or more polyline or polygons (but not all polygons, that would be the preceding case)
        for (const pit of pv) {
          /* Malformatted Polylines with a sequence like M L M M L have been seen, the 2nd M does nothing
             and that point must not go into the output. */
          if (!pit.size()) continue;
          /*  Figure out how many points there are, make an array big enough to hold them, and store
              all the points.  This is the same for open or closed path.  This gives the upper bound for
              the number of points.  The actual number used is calculated on the fly.
          */
          const pt16: U_POINT16[] = [pt(pit.initialPoint())]; // This point is special, it isn't in the iterator

          /**
           * For each segment in the subpath
           */
          for (const cit of pit.curves()) pt16.push(pt(cit.finalPoint()));
          const nPoints = pt16.length;

          if (pit.closed()) {
            this.#append(uemf.U_WMRPOLYGON_set(pt16), 'print_pathv at U_WMRPOLYGON_set');
          } else if (nPoints > 2) {
            this.#append(uemf.U_WMRPOLYLINE_set(pt16), 'print_pathv at U_POLYLINE_set');
          } else if (nPoints === 2) {
            this.#append(uemf.U_WMRMOVETO_set(pt16[0]!), 'print_pathv at U_WMRMOVETO_set');
            this.#append(uemf.U_WMRLINETO_set(pt16[1]!), 'print_pathv at U_WMRLINETO_set');
          }
        }
      }
    }

    // WMF has no fill or stroke commands, the draw does it with active pen/brush

    // clean out brush and pen, but only after all parts of the draw complete
    if (this.use_fill) this.destroy_brush();
    if (this.use_stroke) this.destroy_pen();
    return 1;
  }

  override text(_mod: Print, text: string, p: Point, style: SPStyle): number {
    const uemf = this.uemf;
    if (!this.wt || !text) return 0;

    let fix90n = 0;
    let hfont = 0;
    const tf = this.m_tr_stack.at(-1) ?? Affine.identity();
    let rot = (-1800.0 * Math.atan2(tf.c1, tf.c0)) / Math.PI; // 0.1 degree rotation,  - sign for MM_TEXT
    let rotb = -Math.atan2(tf.c1, tf.c0); // rotation for baseline offset for superscript/subscript, used below
    let dx: number;
    let dy: number;

    // the dx array is smuggled in like: text<nul>w1 w2 w3 ...wn<nul><nul>, where the widths are floats 7 characters wide, including the space
    const sm = PrintWmf.smuggle_adxky_out(
      text,
      Math.fround(this.PX2WORLD * Math.min(tf.expansionX(), tf.expansionY())),
    );
    const { adx, ky, rtl, ndx } = sm;

    let textalignment: number;
    if (rtl > 0) {
      textalignment = U_TA_BASELINE | U_TA_LEFT;
    } else {
      textalignment = U_TA_BASELINE | U_TA_RIGHT | U_TA_RTLREADING;
    }
    if (textalignment !== this.htextalignment) {
      this.htextalignment = textalignment;
      this.#append(uemf.U_WMRSETTEXTALIGN_set(textalignment), 'text at U_WMRSETTEXTALIGN_set');
    }

    const unicode_text = uemf.U_Utf8ToUtf16le(sm.text);
    //translates Unicode  as Utf16le to NonUnicode, if possible.  If any translate, all will, and all to
    //the same font, because of code in Layout::print
    const { newfont } = uemf.UnicodeToNon(unicode_text);
    // The preceding hopefully handled conversions to symbol, wingdings or zapf dingbats.  Now slam everything
    // else down into latin1, which is all WMF can handle.  If the language isn't English expect terrible results.
    const latin1_text = uemf.U_Utf16leToLatin1(unicode_text);
    uemf.free(unicode_text);

    // in some cases a UTF string may reduce to NO latin1 characters, which returns NULL
    if (!latin1_text) return 0;

    //PPT gets funky with text within +-1 degree of a multiple of 90, but only for SOME fonts.Snap those to the central value
    //Some funky ones:  Arial, Times New Roman
    //Some not funky ones: Symbol and Verdana.
    //Without a huge table we cannot catch them all, so just the most common problem ones.
    const params: FontfixParams = { f1: 0, f2: 0, f3: 0 };
    const font_family = style.font_family.value() ?? '';

    if (this.FixPPTCharPos) {
      switch (newfont) {
        case cvt_to_font.CVTSYM:
          PrintMetafile._lookup_ppt_fontfix('Convert To Symbol', params);
          break;
        case cvt_to_font.CVTZDG:
          PrintMetafile._lookup_ppt_fontfix('Convert To Zapf Dingbats', params);
          break;
        case cvt_to_font.CVTWDG:
          PrintMetafile._lookup_ppt_fontfix('Convert To Wingdings', params);
          break;
        default: //also CVTNON
          PrintMetafile._lookup_ppt_fontfix(font_family, params);
          break;
      }
      if (params.f2 !== 0 || params.f3 !== 0) {
        const irem = round(rot) % 900;
        if (irem <= 9 && irem >= -9) {
          fix90n = 1; //assume vertical
          rot = round(rot) - irem;
          rotb = (rot * Math.PI) / 1800.0;
          if (Math.abs(rot) === 900.0) fix90n = 2;
        }
      }
    }

    /*
        Note that text font sizes are stored into the WMF as fairly small integers and that limits their precision.
        The WMF output files produced here have been designed so that the integer valued pt sizes
        land right on an integer value in the WMF file, so those are exact.  However, something like 18.1 pt will be
        somewhat off, so that when it is read back in it becomes 18.11 pt.  (For instance.)
    */
    const textheight = round(
      -style.font_size.computed * this.PX2WORLD * Math.min(tf.expansionX(), tf.expansionY()),
    );
    if (!hfont) {
      // Get font face name.  Use changed font name if unicode mapped to one
      // of the special fonts.
      const facename = uemf.U_Utf8ToLatin1(!newfont ? font_family : uemf.FontName(newfont));

      // Scale the text to the minimum stretch. (It tends to stay within bounding rectangles even if
      // it was streteched asymmetrically.)  Few applications support text from WMF which is scaled
      // differently by height/width, so leave lfWidth alone.
      const puf = uemf.U_FONT_set(
        textheight,
        0,
        round(rot),
        round(rot),
        PrintMetafile._translate_weight(style.font_weight.computed),
        Number(style.font_style.computed === SPCSSFontStyle.SP_CSS_FONT_STYLE_ITALIC),
        Number(style.text_decoration_line.underline),
        Number(style.text_decoration_line.line_through),
        U_DEFAULT_CHARSET,
        U_OUT_DEFAULT_PRECIS,
        U_CLIP_DEFAULT_PRECIS,
        U_DEFAULT_QUALITY,
        U_DEFAULT_PITCH | U_FF_DONTCARE,
        facename,
      );
      uemf.free(facename);

      const r = uemf.wcreatefontindirect_set(this.wht, puf);
      hfont = r.ih;
      this.#append(r.rec, 'text at wcreatefontindirect_set');
      uemf.free(puf);
    }

    this.#append(uemf.wselectobject_set(hfont, this.wht), 'text at wselectobject_set');

    const rgb = style.fill.isColor() ? style.fill.getColor() : null;
    // only change the text color when it needs to be changed
    if (rgb && !this.htextcolor_rgb?.equals(rgb)) {
      this.htextcolor_rgb = rgb;
      this.#append(uemf.U_WMRSETTEXTCOLOR_set(toColorRef(rgb)), 'text at U_WMRSETTEXTCOLOR_set');
    }

    // Text alignment:
    //   - (x,y) coordinates received by this filter are those of the point where the text
    //     actually starts, and already takes into account the text object's alignment;
    //   - for this reason, the WMF text alignment must always be TA_BASELINE|TA_LEFT.
    //     this is set at the beginning of the file and never changed

    // Transparent text background, never changes, set at the beginning of the file

    let p2 = p.transformed(tf);

    //Handle super/subscripts and vertical kerning
    p2 = p2.add(new Point(ky * Math.sin(rotb), ky * Math.cos(rotb)));

    //Conditionally handle compensation for PPT WMF import bug (affects PPT 2003-2010, at least)
    if (this.FixPPTCharPos) {
      if (fix90n === 1) {
        //vertical
        dx = 0.0;
        dy = params.f3 * style.font_size.computed * Math.cos(rotb);
      } else if (fix90n === 2) {
        //horizontal
        dx = params.f2 * style.font_size.computed * Math.sin(rotb);
        dy = 0.0;
      } else {
        dx = params.f1 * style.font_size.computed * Math.sin(rotb);
        dy = params.f1 * style.font_size.computed * Math.cos(rotb);
      }
      p2 = p2.add(new Point(dx, dy));
    }

    const xpos = round(p2.x * this.PX2WORLD);
    const ypos = round(p2.y * this.PX2WORLD);

    // The number of characters in the string is a bit fuzzy.  ndx, the number of entries in adx is
    // the number of VISIBLE characters, since some may combine from the UTF (8 originally,
    // now 16) encoding.  Conversely strlen() or wchar16len() would give the absolute number of
    // encoding characters.  Unclear if emrtext wants the former or the latter but for now assume the former.
    const rec = uemf.U_WMREXTTEXTOUT_set(
      point16_set(xpos, ypos),
      ndx,
      rtl > 0 ? U_ETO_NONE : U_ETO_RTLREADING, // RTL text, U_TA_RTLREADING should be enough, but set this one too just in case
      latin1_text,
      adx,
      U_RCL16_DEF,
    );
    uemf.free(latin1_text);
    this.#append(rec, 'text at U_WMREXTTEXTOUTW_set');

    this.#append(uemf.wdeleteobject_set(hfont, this.wht), 'text at wdeleteobject_set');
    return 0;
  }

  static init(): void {
    /* WMF print */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        '<name>Windows Metafile Print</name>\n' +
        '<id>org.inkscape.print.wmf</id>\n' +
        '<param gui-hidden="true" name="destination" type="string"></param>\n' +
        '<param gui-hidden="true" name="textToPath" type="bool">true</param>\n' +
        '<param gui-hidden="true" name="pageBoundingBox" type="bool">true</param>\n' +
        '<param gui-hidden="true" name="FixPPTCharPos" type="bool">false</param>\n' +
        '<param gui-hidden="true" name="FixPPTDashLine" type="bool">false</param>\n' +
        '<param gui-hidden="true" name="FixPPTGrad2Polys" type="bool">false</param>\n' +
        '<param gui-hidden="true" name="FixPPTPatternAsHatch" type="bool">false</param>\n' +
        '<print/>\n' +
        '</inkscape-extension>',
      new PrintWmf(),
    );
  }
}
