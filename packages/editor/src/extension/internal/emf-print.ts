// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/emf-print.cpp, src/extension/internal/emf-print.h
/*
 * Enhanced Metafile printing
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
 * The records are made with libuemf in uemf-module.wasm (see uemf-backend.ts).
 */
import {
  BooleanOp,
  convertUnit,
  FillRule,
  is_straight_curve,
  pathv_to_linear_and_cubic_beziers,
  type SPClipPath,
  SPCSSFontStyle,
  type SPDocument,
  SPGradient,
  SPGroup,
  SPItem,
  SPLinearGradient,
  SPPattern,
  SPRadialGradient,
  SPRoot,
  SPShape,
  type SPStyle,
  sp_pathvector_boolop,
} from '@inkscape-web/core';
import {
  Affine,
  are_near,
  CubicBezier,
  distance,
  dot,
  LineSegment,
  type OptRect,
  Path,
  type PathVector,
  Point,
  Rotate,
  Scale,
  unit_vector,
} from '@inkscape-web/geom';
import { INKSCAPE_VERSION } from '../../actions/actions-base.ts';
import { INKSCAPE_EXTENSION_URI } from '../prefdialog/widget.ts';
import type { Print } from '../print.ts';
import { build_from_mem } from '../system.ts';
import {
  closed_curves,
  dash_pathv,
  type FontfixParams,
  MFDrawMode,
  PrintMetafile,
  toColorRef,
} from './metafile-print.ts';
import {
  cvt_to_font,
  logbrush_set,
  type Ptr,
  pointl_set,
  rectl_set,
  U_ALTERNATE,
  U_BCBM_COLOR32,
  U_BI_RGB,
  U_BS_DIBPATTERN,
  U_BS_HATCHED,
  U_BS_SOLID,
  U_CLIP_DEFAULT_PRECIS,
  U_COLORONCOLOR,
  type U_COLORREF,
  U_DEFAULT_CHARSET,
  U_DEFAULT_PITCH,
  U_DEFAULT_QUALITY,
  U_DEVICE_DEFAULT_FONT,
  U_DIB_RGB_COLORS,
  U_ETO_NONE,
  U_ETO_RTLREADING,
  U_FF_DONTCARE,
  U_GM_COMPATIBLE,
  U_GRADIENT_FILL_RECT_H,
  U_GRADIENT_FILL_RECT_V,
  U_HS_CROSS,
  U_HS_DIAGCROSS,
  U_HS_HORIZONTAL,
  U_HS_SOLIDCLR,
  U_MM_TEXT,
  U_MWT_LEFTMULTIPLY,
  U_NULL_BRUSH,
  U_NULL_PEN,
  U_OPAQUE,
  U_OUT_DEFAULT_PRECIS,
  type U_POINT,
  U_PS_ENDCAP_FLAT,
  U_PS_ENDCAP_ROUND,
  U_PS_ENDCAP_SQUARE,
  U_PS_GEOMETRIC,
  U_PS_JOIN_BEVEL,
  U_PS_JOIN_MITER,
  U_PS_JOIN_ROUND,
  U_PS_SOLID,
  U_PS_USERSTYLE,
  U_R2_COPYPEN,
  U_RCL_DEF,
  U_REC_FREE,
  U_RGB,
  U_RGBAGetB,
  U_RGBAGetG,
  U_RGBAGetR,
  U_RGN_COPY,
  U_SRCCOPY,
  U_TA_BASELINE,
  U_TA_LEFT,
  U_TA_RIGHT,
  U_TA_RTLREADING,
  U_TRANSPARENT,
  type U_TRIVERTEX,
  U_WINDING,
  type U_XFORM,
} from './uemf-backend.ts';

const PXPERMETER = 2835;
/** The file of the EMF in the file system of the WASM module (upstream: the "destination"). */
const EMF_FILE = '/tmp/print.emf';

/** C++ round(): halves away from zero. */
const round = (v: number) => (v < 0 ? -Math.round(-v) : Math.round(v));
/** printf("%.1f") */
const f1 = (v: number) => v.toFixed(1);

/** The EMF print (upstream PrintEmf). */
export class PrintEmf extends PrintMetafile {
  PX2WORLD = 1;
  FixPPTCharPos = false;
  FixPPTDashLine = false;
  FixPPTGrad2Polys = false;
  FixPPTLinGrad = false;
  FixPPTPatternAsHatch = false;
  FixImageRot = false;
  et: Ptr = 0;
  eht: Ptr = 0;
  hbrush = 0;
  hbrushOld = 0;
  hpen = 0;
  /** The active clip path (upstream: static scpActive of do_clip_if_present). */
  scpActive: SPClipPath | null = null;

  /** Append a record (upstream: emf_append, g_error on failure). */
  #append(rec: Ptr, where: string): void {
    if (!rec || this.uemf.emf_append(rec, this.et, U_REC_FREE)) {
      throw new Error(`Fatal programming error in PrintEmf::${where}`);
    }
  }

  /** Read the character widths, y kern and direction that Layout::print smuggles in after the text. */
  static smuggle_adxkyrtl_out(
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
      adx.push(round(Number.parseFloat(string.slice(cptr, cptr + 7)) * scale) >>> 0);
    }
    cptr++; // skip 2nd fake terminator
    const ky = Number.parseFloat(string.slice(cptr, cptr + 7));
    cptr += 7; // advance over ky and its space
    const rtl = Number.parseInt(string.slice(cptr, cptr + 7), 10);
    return { text, adx, ky, rtl, ndx };
  }

  override setup(_mod: Print): number {
    return 1;
  }

  override begin(mod: Print, doc: SPDocument): number {
    const utf8_fn = mod.get_param_string('destination');
    const uemf = this.uemf;

    // Typically PX2WORLD is 1200/90, using inkscape's default dpi
    this.PX2WORLD = 1200.0 / convertUnit(1.0, 'in', 'px');
    this.FixPPTCharPos = mod.get_param_bool('FixPPTCharPos');
    this.FixPPTDashLine = mod.get_param_bool('FixPPTDashLine');
    this.FixPPTGrad2Polys = mod.get_param_bool('FixPPTGrad2Polys');
    this.FixPPTLinGrad = mod.get_param_bool('FixPPTLinGrad');
    this.FixPPTPatternAsHatch = mod.get_param_bool('FixPPTPatternAsHatch');
    this.FixImageRot = mod.get_param_bool('FixImageRot');

    this.abort(); // a print that did not finish
    this.et = uemf.emf_start(EMF_FILE, 1000000, 250000).et; // Initialize the et structure
    this.eht = uemf.htable_create(128, 128); // Initialize the eht structure
    this.m_tr_stack = [];
    this.scpActive = null;
    this.htextcolor_rgb = null;

    // width and height in px
    this._doc_unit_scale = doc.getDocumentScale().x;

    // initialize a few global variables
    this.hbrush = this.hbrushOld = this.hpen = 0;
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
    const inches = convertUnit(1, 'px', 'in');
    const dwInchesX = Math.fround((d?.width() ?? 0) * inches);
    const dwInchesY = Math.fround((d?.height() ?? 0) * inches);

    // dwInchesX x dwInchesY in 100th of millimeter units, 1200 dpi/25.4 -> dpmm
    const { rclBounds, rclFrame } = uemf.drawing_size_100th(
      Math.ceil(dwInchesX * 25.4 * 100),
      Math.ceil(dwInchesY * 25.4 * 100),
      1200.0 / 25.4,
    );

    // set up the reference device as 100 X A4 horizontal, (1200 dpi/25.4 -> dpmm).  Extra digits maintain dpi better in EMF
    const MMX = 216;
    const MMY = 279;
    const { szlDev, szlMm } = uemf.device_size(MMX, MMY, 1200.0 / 25.4);
    const PixelsX = szlDev.cx;
    const PixelsY = szlDev.cy;

    // set up the description:  (version string)0(file)00
    const p = utf8_fn.split(/[\\/]/).pop() ?? utf8_fn;
    const buff = `Inkscape ${INKSCAPE_VERSION} \x01${p}\x01`;
    const Description = uemf.U_Utf8ToUtf16le(buff);
    const cbDesc = 2 + uemf.wchar16len(Description); // also count the final terminator
    uemf.U_Utf16leEdit(Description, 1, 0); // swap the temporary \1 characters for nulls

    // construct the EMRHEADER record and append it to the EMF in memory
    const rec = uemf.U_EMRHEADER_set(rclBounds, rclFrame, cbDesc, Description, szlDev, szlMm, 0);
    uemf.free(Description);
    this.#append(rec, 'begin at EMRHEADER');

    // Simplest mapping mode, supply all coordinates in pixels
    this.#append(uemf.U_EMRSETMAPMODE_set(U_MM_TEXT), 'begin at EMRSETMAPMODE');

    //  In earlier versions this was used to scale from inkscape's dpi of 90 to
    //  the files 1200 dpi, taking into account PX2WORLD which was 20.  Now PX2WORLD
    //  is set so that this matrix is unitary.  The usual value of PX2WORLD is 1200/90,
    //  but might be different if the internal dpi is changed.
    const worldTransform: U_XFORM = { eM11: 1.0, eM12: 0.0, eM21: 0.0, eM22: 1.0, eDx: 0, eDy: 0 };
    this.#append(
      uemf.U_EMRMODIFYWORLDTRANSFORM_set(worldTransform, U_MWT_LEFTMULTIPLY),
      'begin at EMRMODIFYWORLDTRANSFORM',
    );

    this.#append(
      uemf.textcomment_set(`Screen=${PixelsX}x${PixelsY}px, ${MMX}x${MMY}mm`),
      'begin at textcomment_set 1',
    );
    const pb = doc.preferredBounds();
    this.#append(
      uemf.textcomment_set(
        `Drawing=${f1(pb.width())}x${f1(pb.height())}px, ${f1(convertUnit(dwInchesX, 'in', 'mm'))}x${f1(convertUnit(dwInchesY, 'in', 'mm'))}mm`,
      ),
      'begin at textcomment_set 1',
    );

    /* set some parameters, else the program that reads the EMF may default to other values */
    this.#append(uemf.U_EMRSETBKMODE_set(U_TRANSPARENT), 'begin at U_EMRSETBKMODE_set');

    this.hpolyfillmode = U_WINDING;
    this.#append(uemf.U_EMRSETPOLYFILLMODE_set(U_WINDING), 'begin at U_EMRSETPOLYFILLMODE_set');

    // Text alignment:  (only changed if RTL text is encountered )
    //   - (x,y) coordinates received by this filter are those of the point where the text
    //     actually starts, and already takes into account the text object's alignment;
    //   - for this reason, the EMF text alignment must always be TA_BASELINE|TA_LEFT.
    this.htextalignment = U_TA_BASELINE | U_TA_LEFT;
    this.#append(uemf.U_EMRSETTEXTALIGN_set(U_TA_BASELINE | U_TA_LEFT), 'begin at U_EMRSETTEXTALIGN_set');

    this.htextcolor_rgb = null;
    this.#append(uemf.U_EMRSETTEXTCOLOR_set(U_RGB(0, 0, 0)), 'begin at U_EMRSETTEXTCOLOR_set');

    this.#append(uemf.U_EMRSETROP2_set(U_R2_COPYPEN), 'begin at U_EMRSETROP2_set');

    /* miterlimit is set with eah pen, so no need to check for it changes as in WMF */
    return 0;
  }

  override finish(_mod: Print): Uint8Array | null {
    this.do_clip_if_present(null); // Terminate any open clip.
    if (!this.et) return null;

    // earlier versions had flush of fill here, but it never executed and was removed
    this.#append(this.uemf.U_EMREOF_set(this.et), 'finish'); // generate the EOF record
    this.uemf.emf_finish(this.et, this.eht); // Finalize and write out the EMF
    this.uemf.emf_free(this.et); // clean up
    this.uemf.htable_free(this.eht); // clean up
    this.et = this.eht = 0;
    return this.uemf.read_file(EMF_FILE);
  }

  /**
   * Free the EMF in memory and the handle table of a print that did not finish (not upstream:
   * there a failed print ends the program). The file is closed and removed.
   */
  abort(): void {
    if (this.et) {
      if (this.eht) this.uemf.emf_finish(this.et, this.eht); // closes the file
      this.uemf.emf_free(this.et);
      this.uemf.read_file(EMF_FILE);
    }
    if (this.eht) this.uemf.htable_free(this.eht);
    this.et = this.eht = 0;
  }

  /** fcolor is defined when gradients are being expanded, it is the color of one stripe or ring. */
  override create_brush(style: SPStyle | null, fcolor: U_COLORREF | null): number {
    const uemf = this.uemf;
    let brush = 0;
    let pixbuf = null;
    let width = 0;
    let height = 0;

    if (!this.et) return 0;

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
        hatchColor.Reserved = 0;
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
          if (this.FixPPTGrad2Polys || this.FixPPTLinGrad) return this.hold_gradient(lg, fill_mode);
          hatchColor = this.avg_stop_color(lg);
        }
      }
    }

    const lb = logbrush_set(brushStyle, hatchColor, hatchType);

    switch (fill_mode) {
      case MFDrawMode.DRAW_LINEAR_GRADIENT: // fill with average color unless gradients are converted to slices
      case MFDrawMode.DRAW_RADIAL_GRADIENT: // ditto
      case MFDrawMode.DRAW_PAINT:
      case MFDrawMode.DRAW_PATTERN: {
        // SVG text has no background attribute, so OPAQUE mode ALWAYS cancels after the next draw, otherwise it would mess up future text output.
        if (this.usebk) {
          this.#append(uemf.U_EMRSETBKCOLOR_set(bkColor), 'create_brush at U_EMRSETBKCOLOR_set');
          this.#append(uemf.U_EMRSETBKMODE_set(U_OPAQUE), 'create_brush at U_EMRSETBKMODE_set');
        }
        const r = uemf.createbrushindirect_set(this.eht, lb);
        brush = r.ih;
        this.#append(r.rec, 'create_brush at createbrushindirect_set');
        break;
      }
      case MFDrawMode.DRAW_IMAGE: {
        const colortype = U_BCBM_COLOR32;
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
        const r = uemf.createdibpatternbrushpt_set(this.eht, U_DIB_RGB_COLORS, Bmi, dib.cbPx, dib.px);
        brush = r.ih;
        this.#append(r.rec, 'create_brush at createdibpatternbrushpt_set');
        uemf.free(dib.px);
        uemf.free(Bmi); // ct will be NULL because of colortype
        break;
      }
    }

    this.hbrush = brush; // need this later for destroy_brush
    this.#append(uemf.selectobject_set(brush, this.eht), 'create_brush at selectobject_set');

    if (fmode !== this.hpolyfillmode) {
      this.hpolyfillmode = fmode;
      this.#append(uemf.U_EMRSETPOLYFILLMODE_set(fmode), 'create_brush at U_EMRSETPOLYdrawmode_set');
    }
    return 0;
  }

  override destroy_brush(): void {
    // before an object may be safely deleted it must no longer be selected
    // select in a stock object to deselect this one, the stock object should
    // never be used because we always select in a new one before drawing anything
    this.#append(this.uemf.selectobject_set(U_NULL_BRUSH, this.eht), 'destroy_brush at selectobject_set');
    if (this.hbrush) {
      this.#append(this.uemf.deleteobject_set(this.hbrush, this.eht), 'destroy_brush');
      this.hbrush = 0;
    }
  }

  override create_pen(style: SPStyle | null, transform: Affine): number {
    const uemf = this.uemf;
    let dash: number[] = [];
    let linestyle = U_PS_SOLID;
    let linecap = 0;
    let linejoin = 0;
    let px: Ptr = 0;
    let cbPx = 0;
    let Bmi: Ptr = 0;
    let elp: Ptr;

    if (!this.et) return 0;

    // set a default stroke  in case we can't figure out a better way to do it
    let brushStyle = U_BS_SOLID;
    let hatchColor = U_RGB(0, 0, 0);
    let hatchType = U_HS_HORIZONTAL;
    let bkColor = U_RGB(0, 0, 0);

    if (style) {
      const server = style.getStrokePaintServer();
      if (server instanceof SPPattern) {
        // must be paint-server
        const width = Math.trunc(server.width());
        const height = Math.trunc(server.height());
        const out = { epixbuf: null, hatchType, hatchColor, bkColor } as Parameters<
          typeof this.brush_classify
        >[2];
        this.brush_classify(server, 0, out);
        ({ hatchType, hatchColor, bkColor } = out);
        const pixbuf = out.epixbuf;
        if (pixbuf) {
          brushStyle = U_BS_DIBPATTERN;
          const colortype = U_BCBM_COLOR32;
          const dib = uemf.RGBA_to_DIB(pixbuf.data as Uint8Array, width, height, width * 4, colortype, 0, 1);
          px = dib.px;
          cbPx = dib.cbPx;
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
          Bmi = uemf.bitmapinfo_set(Bmih, dib.ct);
        } else {
          // pattern
          brushStyle = U_BS_HATCHED;
          if (this.usebk) {
            // OPAQUE mode ALWAYS cancels after the next draw, otherwise it would mess up future text output.
            this.#append(uemf.U_EMRSETBKCOLOR_set(bkColor), 'create_pen at U_EMRSETBKCOLOR_set');
            this.#append(uemf.U_EMRSETBKMODE_set(U_OPAQUE), 'create_pen at U_EMRSETBKMODE_set');
          }
          if (hatchType === -1) {
            // Not a standard hatch, so force it to something
            hatchType = U_HS_CROSS;
            hatchColor = U_RGB(0xff, 0xc3, 0xc3);
          }
        }
        if (this.FixPPTPatternAsHatch) {
          if (hatchType === -1) {
            // image or unclassified
            brushStyle = U_BS_HATCHED;
            hatchType = U_HS_DIAGCROSS;
            hatchColor = U_RGB(0xff, 0xc3, 0xc3);
          }
        }
      } else if (server instanceof SPGradient) {
        // must be a gradient
        // currently we do not do anything with gradients, the code below has no net effect.
        if (server instanceof SPLinearGradient || server instanceof SPRadialGradient) {
          server.ensureVector(); // when exporting from commandline, vector is not built
          hatchColor = this.avg_stop_color(server);
        }
      } else if (style.stroke.isColor()) {
        // test last, always seems to be set, even for other types above
        brushStyle = U_BS_SOLID;
        hatchColor = toColorRef(style.stroke.getColor());
        hatchColor.Reserved = 0;
        hatchType = U_HS_SOLIDCLR;
      }

      const p0 = new Point(0, 0).transformed(transform);
      const p1 = new Point(1, 1).transformed(transform);
      const p = p1.sub(p0);

      const scale = Math.sqrt(p.x * p.x + p.y * p.y) / Math.sqrt(2);

      if (!style.stroke_width.computed) {
        return 0; //if width is 0 do not (reset) the pen, it should already be NULL_PEN
      }
      const linewidth = Math.max(1, round(scale * style.stroke_width.computed * this.PX2WORLD) >>> 0);

      if (style.stroke_linecap.computed === 0) {
        linecap = U_PS_ENDCAP_FLAT;
      } else if (style.stroke_linecap.computed === 1) {
        linecap = U_PS_ENDCAP_ROUND;
      } else if (style.stroke_linecap.computed === 2) {
        linecap = U_PS_ENDCAP_SQUARE;
      }

      if (style.stroke_linejoin.computed === 0) {
        linejoin = U_PS_JOIN_MITER;
      } else if (style.stroke_linejoin.computed === 1) {
        linejoin = U_PS_JOIN_ROUND;
      } else if (style.stroke_linejoin.computed === 2) {
        linejoin = U_PS_JOIN_BEVEL;
      }

      const values = style.stroke_dasharray.values;
      if (values.length) {
        if (this.FixPPTDashLine) {
          // will break up line into many smaller lines.  Override gradient if that was set, cannot do both.
          brushStyle = U_BS_SOLID;
          hatchType = U_HS_HORIZONTAL;
        } else {
          if (values.some((v) => v.value > 0.00000001)) linestyle = U_PS_USERSTYLE;
          if (linestyle === U_PS_USERSTYLE) {
            dash = values.map((v) => Math.max(1, round(scale * v.value * this.PX2WORLD) >>> 0));
          }
        }
      }

      elp = uemf.extlogpen_set(
        U_PS_GEOMETRIC | linestyle | linecap | linejoin,
        linewidth,
        brushStyle,
        hatchColor,
        hatchType,
        dash,
      );
    } else {
      // if (!style)
      linejoin = 0;
      elp = uemf.extlogpen_set(linestyle, 1, U_BS_SOLID, U_RGB(0, 0, 0), U_HS_HORIZONTAL, []);
    }

    const r = uemf.extcreatepen_set(this.eht, Bmi, cbPx, px, elp);
    this.#append(r.rec, 'create_pen at extcreatepen_set');
    uemf.free(elp);
    if (Bmi) uemf.free(Bmi);
    if (px) uemf.free(px); // ct will always be NULL

    this.#append(uemf.selectobject_set(r.ih, this.eht), 'create_pen at selectobject_set');
    this.hpen = r.ih; // need this later for destroy_pen

    if (linejoin === U_PS_JOIN_MITER && style) {
      let miterlimit = style.stroke_miterlimit.value; // This is a ratio.
      if (miterlimit < 1) miterlimit = 1;
      this.#append(
        uemf.U_EMRSETMITERLIMIT_set(Math.trunc(miterlimit)),
        'create_pen at U_EMRSETMITERLIMIT_set',
      );
    }
    return 0;
  }

  /** set the current pen to the stock object NULL_PEN and then delete the defined pen object, if there is one. */
  override destroy_pen(): void {
    // before an object may be safely deleted it must no longer be selected
    this.#append(this.uemf.selectobject_set(U_NULL_PEN, this.eht), 'destroy_pen at selectobject_set');
    if (this.hpen) {
      this.#append(this.uemf.deleteobject_set(this.hpen, this.eht), 'destroy_pen');
      this.hpen = 0;
    }
  }

  /**
   * Return a Path consisting of just the corner points of the single path in a PathVector. If
   * the PathVector has more than one path, or that one path is open, or any of its segments are
   * curved, then the returned Path is empty. If the input path is already just straight lines
   * and vertices the output will be the same as the sole path in the input.
   */
  static pathv_to_simple_polygon(pathv: PathVector): { path: Path; vertices: number } {
    const bad = { path: new Path(), vertices: 0 };
    const pv = pathv_to_linear_and_cubic_beziers(pathv);
    const pit = pv[0];
    let vertices = 0;
    let first_seg = true;
    if (!pit?.closed()) return bad; // path must be closed
    if (pv.length > 1) return bad; // there may only be one path
    let P1_trail = pit.finalPoint();
    const curves = closed_curves(pit);
    if (!curves.length) return bad;
    let P1 = curves[0]!.initialPoint();
    let output: Path | null = null;
    for (const cit of curves) {
      if (!is_straight_curve(cit)) return bad;
      const P1_lead = cit.finalPoint();
      if (are_near(P1_lead, P1, 1e-5)) continue; // duplicate points at the same coordinate
      const v1 = unit_vector(P1.sub(P1_trail));
      const v2 = unit_vector(P1_lead.sub(P1));
      if (are_near(dot(v1, v2), 1.0, 1e-5)) {
        // P1 is within a straight line
        P1 = P1_lead;
        continue;
      }
      // P1 is the center point of a turn of some angle
      if (!vertices) {
        output = new Path(P1);
        output.close(pit.closed());
      }
      if (!are_near(P1, P1_trail, 1e-5)) {
        // possible for P1 to start on the end point
        output ??= new Path(P1_trail);
        if (output.empty() && !are_near(output.initialPoint(), P1_trail)) output.start(P1_trail);
        output.appendCurve(new LineSegment(output.finalPoint(), P1));
        if (first_seg) {
          vertices += 2;
          first_seg = false;
        } else {
          vertices += 1;
        }
      }
      P1_trail = P1;
      P1 = P1_lead;
    }
    return { path: output ?? new Path(), vertices };
  }

  /**
   * Returns the simplified Path (no matter what), whether it is a rectangle and the angle that
   * will rotate the side closest to horizontal onto horizontal.
   */
  static pathv_to_rect(pathv: PathVector): { path: Path; is_rect: boolean; angle: number } {
    const { path: pR, vertices } = PrintEmf.pathv_to_simple_polygon(pathv);
    let is_rect = false;
    let angle = 0;
    if (vertices === 4) {
      // or else it cannot be a rectangle
      let vertex_count = 0;
      /* Get the ends of the LAST line segment.
         Find minimum rotation to align rectangle with X,Y axes.  (Very degenerate if it is rotated 45 degrees.) */
      angle = 10.0; /* must be > than the actual angle in radians. */
      let v1 = new Point();
      for (const cit of closed_curves(pR)) {
        v1 = unit_vector(cit.finalPoint().sub(cit.initialPoint()));
        if (v1.x > 0) {
          // only check the 1 or 2 points on vectors aimed the same direction as unit X
          const ang = Math.asin(v1.y); // because component is rotation by ang of {1,0| vector
          if (Math.abs(ang) < Math.abs(angle)) angle = -ang; // y increases down, flips sign on angle
        }
      }

      /*  For increased numerical stability, snap the angle to the nearest 1/100th of a degree. */
      const convert = 36000.0 / (2.0 * Math.PI);
      angle = round(angle * convert) / convert;

      // at this stage v1 holds the last vector in the path, whichever direction it points.
      for (const cit of closed_curves(pR)) {
        const v2 = v1;
        v1 = unit_vector(cit.finalPoint().sub(cit.initialPoint()));
        // P1 is center of a turn that is not 90 degrees.  Limit comes from cos(89.9) = .001745
        if (!are_near(dot(v1, v2), 0.0, 2e-3)) break;
        vertex_count++;
      }
      if (vertex_count === 4) is_rect = true;
    }
    return { path: pR, is_rect, angle };
  }

  /**
   * Compare a vector with a rectangle's orientation (angle needed to rotate side(s) closest to
   * horizontal to exactly horizontal) and return: 0 none of the following, 1 parallel to
   * horizontal, 2 parallel to vertical, 3 antiparallel to horizontal, 4 antiparallel to vertical
   */
  static vector_rect_alignment(angle: number, vtest: Point): number {
    let stat = 0;
    const v1 = unit_vector(vtest); // unit vector to test alignment
    const v2 = new Point(1, 0).transformed(Rotate(-angle)); // unit horizontal side (sign change because Y increases DOWN)
    const v3 = new Point(0, 1).transformed(Rotate(-angle)); // unit horizontal side (sign change because Y increases DOWN)
    if (are_near(dot(v1, v2), 1.0, 1e-5)) {
      stat = 1;
    } else if (are_near(dot(v1, v2), -1.0, 1e-5)) {
      stat = 2;
    } else if (are_near(dot(v1, v3), 1.0, 1e-5)) {
      stat = 3;
    } else if (are_near(dot(v1, v3), -1.0, 1e-5)) {
      stat = 4;
    }
    return stat;
  }

  /**
   * retrieve the point at the indicated corner: 0 UL (and default), 1 UR, 2 LR, 3 LL. Needed
   * because the start can be any point, and the direction could run either clockwise or
   * counterclockwise. This should work even if the corners of the rectangle are slightly
   * displaced.
   */
  static get_pathrect_corner(pathRect: Path, angle: number, corner: number): Point {
    const curves = closed_curves(pathRect);
    let center = new Point(0, 0);
    for (const cit of curves) center = center.add(cit.initialPoint().div(4.0));

    let LR: number; // 1 if Left, 0 if Right
    let UL: number; // 1 if Lower, 0 if Upper (as viewed on screen, y coordinates increase downwards)
    switch (corner) {
      case 1: //UR
        LR = 0;
        UL = 0;
        break;
      case 2: //LR
        LR = 0;
        UL = 1;
        break;
      case 3: //LL
        LR = 1;
        UL = 1;
        break;
      default: //UL
        LR = 1;
        UL = 0;
        break;
    }

    const v1 = new Point(1, 0).transformed(Rotate(-angle)); // unit horizontal side (sign change because Y increases DOWN)
    const v2 = new Point(0, 1).transformed(Rotate(-angle)); // unit vertical side (sign change because Y increases DOWN)
    let P1 = new Point();
    for (const cit of curves) {
      P1 = cit.initialPoint();
      if (LR === (dot(P1.sub(center), v1) > 0 ? 0 : 1) && UL === (dot(P1.sub(center), v2) > 0 ? 1 : 0)) break;
    }
    return P1;
  }

  static make_trivertex(Pt: Point, uc: U_COLORREF): U_TRIVERTEX {
    return {
      x: round(Pt.x),
      y: round(Pt.y),
      Red: uc.Red << 8,
      Green: uc.Green << 8,
      Blue: uc.Blue << 8,
      Alpha: uc.Reserved << 8, // EMF will ignore this
    };
  }

  /**
   * Examine clip. If there is a (new) one then apply it. If there is one and it is the same as
   * the preceding one, leave the preceding one active. If style is null terminate the current
   * clip, if any, and return.
   */
  do_clip_if_present(style: SPStyle | null): void {
    const uemf = this.uemf;
    if (!style) {
      if (this.scpActive) {
        // clear the existing clip
        this.#append(uemf.U_EMRRESTOREDC_set(-1), 'fill at U_EMRRESTOREDC_set');
        this.scpActive = null;
      }
      return;
    }
    /* The current implementation converts only one level of clipping.  If there were more
       clips further up the stack they should be combined with the pathvector using "and".  Since this
       comes up rarely, and would involve a lot of searching (all the way up the stack for every
       draw operation), it has not yet been implemented.
    */
    /*  find the first clip_ref at object or up the stack.  There may not be one. */
    let scp: SPClipPath | null = null;
    let item = style.object instanceof SPItem ? style.object : null;
    while (item) {
      scp = item.getClipObject();
      if (scp) break;
      const parent = item.parent;
      item = parent instanceof SPItem && !(parent instanceof SPRoot) ? parent : null; // this will never be a clipping path
    }

    if (scp !== this.scpActive) {
      // change or remove the clipping
      if (this.scpActive) {
        // clear the existing clip
        this.#append(uemf.U_EMRRESTOREDC_set(-1), 'fill at U_EMRRESTOREDC_set');
        this.scpActive = null;
      }

      if (scp && item) {
        // set the new clip
        /* because of units and who knows what other transforms that might be applied above we
           need the full transform all the way to the root.
        */
        let tf = item.transform;
        for (let scan_item = item.parent; scan_item instanceof SPItem; scan_item = scan_item.parent) {
          tf = tf.multiply(scan_item.transform);
        }
        tf = tf.multiply(Scale(this._doc_unit_scale)); // Transform must be in PIXELS, no matter what the document unit is.

        /* find the clipping path */
        let combined_pathvector: PathVector = [];
        const tfc = Affine.identity(); // clipping transform, generally not the same as item transform
        for (const child of scp.children) {
          if (!(child instanceof SPItem)) break;
          if (child instanceof SPGroup) {
            combined_pathvector = PrintEmf.merge_PathVector_with_group(combined_pathvector, child, tfc);
          } else if (child instanceof SPShape) {
            combined_pathvector = PrintEmf.merge_PathVector_with_shape(combined_pathvector, child, tfc);
          }
        }

        if (combined_pathvector.length) {
          // if clipping path isn't empty, define EMF clipping record
          this.scpActive = scp; // remember for next time
          // the sole purpose of this SAVEDC is to let us clear the clipping region later.
          this.#append(uemf.U_EMRSAVEDC_set(), 'image at U_EMRSAVEDC_set');
          this.draw_pathv_to_EMF(combined_pathvector, tf);
          this.#append(
            uemf.U_EMRSELECTCLIPPATH_set(U_RGN_COPY),
            'do_clip_if_present at U_EMRSELECTCLIPPATH_set',
          );
        } else {
          this.scpActive = null; // no valid path available to draw, so no DC was saved, so no signal to restore
        }
      }
    }
  }

  static merge_PathVector_with_group(
    combined_pathvector: PathVector,
    item: SPItem,
    transform: Affine,
  ): PathVector {
    // sanity test, only a group should be passed in, return empty if something else happens
    if (!(item instanceof SPGroup)) return [];
    let new_combined_pathvector = combined_pathvector;
    const tfc = item.transform.multiply(transform);
    for (const child of item.children) {
      if (!(child instanceof SPItem)) break;
      if (child instanceof SPGroup) {
        new_combined_pathvector = PrintEmf.merge_PathVector_with_group(new_combined_pathvector, child, tfc); // could be endlessly recursive on a badly formed SVG
      } else if (child instanceof SPShape) {
        new_combined_pathvector = PrintEmf.merge_PathVector_with_shape(new_combined_pathvector, child, tfc);
      }
    }
    return new_combined_pathvector;
  }

  static merge_PathVector_with_shape(
    combined_pathvector: PathVector,
    item: SPItem,
    transform: Affine,
  ): PathVector {
    // sanity test, only a shape should be passed in, return empty if something else happens
    if (!(item instanceof SPShape)) return [];
    const tfc = item.transform.multiply(transform);
    const curve = item.curve();
    if (!curve) return [];
    const new_vect = curve.map((p) => p.transformed(tfc));
    if (!combined_pathvector.length) return new_vect;
    return sp_pathvector_boolop(
      new_vect,
      combined_pathvector,
      BooleanOp.bool_op_union,
      FillRule.fill_oddEven,
      FillRule.fill_oddEven,
    );
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
    const uemf = this.uemf;
    const tf = this.m_tr_stack.at(-1) ?? Affine.identity();

    this.do_clip_if_present(style); // If clipping is needed set it up

    this.use_fill = true;
    this.use_stroke = false;

    this.fill_transform = tf;

    let brush_stat = this.create_brush(style, null);

    /* native linear gradients are only used if the object is a rectangle AND the gradient is parallel to the sides of the object */
    let is_Rect = false;
    let angle = 0;
    let rectDir = 0;
    let pathRect = new Path();
    if (this.FixPPTLinGrad && brush_stat && this.gv.mode === MFDrawMode.DRAW_LINEAR_GRADIENT) {
      const pvr = pathv.map((p) => p.transformed(this.fill_transform));
      ({ path: pathRect, is_rect: is_Rect, angle } = PrintEmf.pathv_to_rect(pvr));
      if (is_Rect) {
        /* Gradientfill records can only be used if the gradient is parallel to the sides of the rectangle.
           That must be checked here so that we can fall back to another form of gradient fill if it is not
           the case. */
        const v = this.gv.p2.sub(this.gv.p1);
        rectDir = PrintEmf.vector_rect_alignment(angle, v.transformed(this.fill_transform));
        if (!rectDir) is_Rect = false;
      }
      if (!is_Rect && !this.FixPPTGrad2Polys) brush_stat = 0; // fall all the way back to a solid fill
    }

    if (brush_stat) {
      // only happens if the style is a gradient
      /*
          Handle gradients.  Uses modified livarot as 2geom boolops is currently broken.
          Can handle gradients with multiple stops.

          The overlap is needed to avoid antialiasing artifacts when edges are not strictly aligned on pixel boundaries.
          There is an inevitable loss of accuracy saving through an EMF file because of the integer coordinate system.
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

          if (doff >= doff_range) {
            istop++;
            if (istop >= nstops) {
              istop = nstops - 1;
              continue; // could happen on a rounding error
            }
            doff_base = doff_range;
            doff_range = stops[istop]!.offset; // next or last stop
            c1 = c2;
            c2 = toColorRef(stops[istop]!.color);
          }
        }
      } else if (this.gv.mode === MFDrawMode.DRAW_LINEAR_GRADIENT) {
        if (is_Rect) {
          /* coordinates: upper left, upper right, and lower right corners of the rectangle.
             inkscape transform already applied, but needs to be scaled to EMF coordinates. */
          const ul = PrintEmf.get_pathrect_corner(pathRect, angle, 0).mul(this.PX2WORLD);
          const ur = PrintEmf.get_pathrect_corner(pathRect, angle, 1).mul(this.PX2WORLD);
          const lr = PrintEmf.get_pathrect_corner(pathRect, angle, 2).mul(this.PX2WORLD);
          const wRect = distance(ul, ur);
          const hRect = distance(ur, lr);

          /*  The basic rectangle for all of these is placed with its UL corner at 0,0 with a size wRect,hRect.
              Apply a world transform to place/scale it into the appropriate position on the drawing.
              Actual gradientfill records are either this entire rectangle or slices of it as defined by the stops.
              This rectangle has already been transformed by tf (whatever rotation/scale) Inkscape had applied to it.
          */
          const tf2 = Rotate(-angle); // the rectangle may be drawn skewed to the coordinate system
          const tmpTransform: U_XFORM = {
            eM11: tf2.c0,
            eM12: tf2.c1,
            eM21: tf2.c2,
            eM22: tf2.c3,
            eDx: round(ul.x), // use explicit round for better stability
            eDy: round(ul.y),
          };

          this.#append(uemf.U_EMRSAVEDC_set(), 'image at U_EMRSAVEDC_set');
          this.#append(
            uemf.U_EMRMODIFYWORLDTRANSFORM_set(tmpTransform, U_MWT_LEFTMULTIPLY),
            'image at EMRMODIFYWORLDTRANSFORM',
          );

          for (; istop < nstops; istop++) {
            doff_range = stops[istop]!.offset; // next or last stop
            let outUL: Point;
            let outLR: Point;
            let gMode: number;
            if (rectDir === 1 || rectDir === 2) {
              outUL = new Point(doff_base * wRect, 0);
              outLR = new Point(doff_range * wRect, hRect);
              gMode = U_GRADIENT_FILL_RECT_H;
            } else {
              outUL = new Point(0, doff_base * hRect);
              outLR = new Point(wRect, doff_range * hRect);
              gMode = U_GRADIENT_FILL_RECT_V;
            }

            doff_base = doff_range;
            const rcb = {
              left: round(outUL.x), // use explicit round for better stability
              top: round(outUL.y),
              right: round(outLR.x),
              bottom: round(outLR.y),
            };
            c2 = toColorRef(stops[istop]!.color);

            let ut: U_TRIVERTEX[];
            if (rectDir === 2 || rectDir === 4) {
              // gradient is reversed, so swap colors
              ut = [PrintEmf.make_trivertex(outUL, c2), PrintEmf.make_trivertex(outLR, c1)];
            } else {
              ut = [PrintEmf.make_trivertex(outUL, c1), PrintEmf.make_trivertex(outLR, c2)];
            }
            c1 = c2; // for next stop
            // U_GRADIENT4: UpperLeft = 0, LowerRight = 1
            this.#append(uemf.U_EMRGRADIENTFILL_set(rcb, ut, gMode, [0, 1]), 'fill at U_EMRGRADIENTFILL_set');
          }

          this.#append(uemf.U_EMRRESTOREDC_set(-1), 'fill at U_EMRRESTOREDC_set');
        } else {
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
            pathvr = sp_pathvector_boolop(
              pathvc,
              pathv,
              BooleanOp.bool_op_inters,
              FillRule.fill_nonZero,
              frb,
            );
            this.print_pathv(pathvr, this.fill_transform); // show the intersection

            if (doff >= doff_range) {
              istop++;
              if (istop >= nstops) {
                istop = nstops - 1;
                continue; // could happen on a rounding error
              }
              doff_base = doff_range;
              doff_range = stops[istop]!.offset; // next or last stop
              c1 = c2;
              c2 = toColorRef(stops[istop]!.color);
            }
          }
        }
      } else {
        throw new Error('Fatal programming error in PrintEmf::fill, invalid gradient type detected');
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
    this.do_clip_if_present(style); // If clipping is needed set it up

    this.use_stroke = true;
    //  use_fill was set in ::fill, if it is needed

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
      this.#append(this.uemf.U_EMRSETBKMODE_set(U_TRANSPARENT), 'stroke at U_EMRSETBKMODE_set');
    }
    return 0;
  }

  /**
   * Draws simple_shapes, those with closed EMR_* primitives, like polygons, rectangles and
   * ellipses. These use whatever the current pen/brush are and need not be followed by a
   * FILLPATH or STROKEPATH. For other paths it sets a few flags and returns.
   */
  print_simple_shape(pathv: PathVector, transform: Affine): boolean {
    const uemf = this.uemf;
    const pv = pathv_to_linear_and_cubic_beziers(pathv.map((p) => p.transformed(transform)));

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

    const lpPoints: U_POINT[] = [];
    const pt = (p: Point): U_POINT => ({ x: round(p.x * this.PX2WORLD), y: round(p.y * this.PX2WORLD) });

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
      if (this.use_fill && !this.use_stroke) {
        // only fill
        this.#append(
          uemf.selectobject_set(U_NULL_PEN, this.eht),
          'print_simple_shape at selectobject_set pen',
        );
      } else if (!this.use_fill && this.use_stroke) {
        // only stroke
        this.#append(
          uemf.selectobject_set(U_NULL_BRUSH, this.eht),
          'print_simple_shape at selectobject_set brush',
        );
      }

      let rec: Ptr = 0;
      if (polygon) {
        if (rectangle) {
          rec = uemf.U_EMRRECTANGLE_set(rectl_set(lpPoints[0]!, lpPoints[2]!));
        } else {
          rec = uemf.U_EMRPOLYGON_set(U_RCL_DEF, lpPoints.slice(0, nodes));
        }
      } else if (ellipse) {
        rec = uemf.U_EMRELLIPSE_set(
          rectl_set(pointl_set(lpPoints[6]!.x, lpPoints[3]!.y), pointl_set(lpPoints[0]!.x, lpPoints[9]!.y)),
        );
      }
      this.#append(rec, 'print_simple_shape at retangle/ellipse/polygon');

      done = true;

      // replace the handle we moved above, assuming there was something set already
      if (this.use_fill && !this.use_stroke && this.hpen) {
        // only fill
        this.#append(
          uemf.selectobject_set(this.hpen, this.eht),
          'print_simple_shape at selectobject_set pen',
        );
      } else if (!this.use_fill && this.use_stroke && this.hbrush) {
        // only stroke
        this.#append(
          uemf.selectobject_set(this.hbrush, this.eht),
          'print_simple_shape at selectobject_set brush',
        );
      }
    }
    return done;
  }

  /**
   * Some parts based on win32.cpp by Lauris Kaplinski <lauris@kaplinski.com>. Limitations:
   * transparency is lost on export (apparently a limitation of the EMF format).
   */
  override image(
    _mod: Print,
    rgba_px: Uint8Array, // array of pixel values, Gdk::Pixbuf bitmap format
    w: number, // width of bitmap
    h: number, // height of bitmap
    rs: number, // row stride (normally w*4)
    tf_rect: Affine, // affine transform only used for defining location and size of rect, for all other transforms, use the one from m_tr_stack
    style: SPStyle, // provides indirect link to image object
  ): number {
    const uemf = this.uemf;
    let tf = this.m_tr_stack.at(-1) ?? Affine.identity();

    this.do_clip_if_present(style); // If clipping is needed set it up

    this.#append(uemf.U_EMRSETSTRETCHBLTMODE_set(U_COLORONCOLOR), 'image at EMRHEADER');

    const x1 = tf_rect.c4;
    const y1 = tf_rect.c5;
    const dw = w * tf_rect.c0;
    const dh = h * tf_rect.c3;
    const pLL = new Point(x1, y1);
    let pLL2 = pLL.transformed(tf); //location of LL corner in Inkscape coordinates

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

    const Dest = pointl_set(round(pLL2.x * this.PX2WORLD), round(pLL2.y * this.PX2WORLD));
    const cDest = pointl_set(round(dw * this.PX2WORLD), round(dh * this.PX2WORLD));
    const Src = pointl_set(0, 0);
    const cSrc = pointl_set(w, h);
    /* map the integer Dest coordinates back into pLL2, so that the rounded part does not destabilize the transform offset below */
    pLL2 = new Point(Dest.x, Dest.y).div(this.PX2WORLD);
    if (!this.FixImageRot) {
      /* Rotate images - some programs cannot read them in correctly if they are rotated */
      tf = tf.withoutTranslation(); // get rid of the offset in the transform
      const pLL2prime = pLL2.transformed(tf);
      const tmpTransform: U_XFORM = {
        eM11: tf.c0,
        eM12: tf.c1,
        eM21: tf.c2,
        eM22: tf.c3,
        eDx: (pLL2.x - pLL2prime.x) * this.PX2WORLD,
        eDy: (pLL2.y - pLL2prime.y) * this.PX2WORLD,
      };

      this.#append(uemf.U_EMRSAVEDC_set(), 'image at U_EMRSAVEDC_set');
      this.#append(
        uemf.U_EMRMODIFYWORLDTRANSFORM_set(tmpTransform, U_MWT_LEFTMULTIPLY),
        'image at EMRMODIFYWORLDTRANSFORM',
      );
    }
    const rec = uemf.U_EMRSTRETCHDIBITS_set(
      U_RCL_DEF, //! Bounding rectangle in device units
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
    this.#append(rec, 'image at U_EMRSTRETCHDIBITS_set');
    uemf.free(dib.px);
    uemf.free(Bmi);
    if (dib.numCt) uemf.free(dib.ct);

    if (!this.FixImageRot) this.#append(uemf.U_EMRRESTOREDC_set(-1), 'image at U_EMRRESTOREDC_set');
    return 0;
  }

  draw_pathv_to_EMF(pathv: PathVector, transform: Affine): number {
    const uemf = this.uemf;
    /*  inkscape to EMF scaling is done below, but NOT the rotation/translation transform,
        that is handled by the EMF MODIFYWORLDTRANSFORM record
    */
    const pv = pathv_to_linear_and_cubic_beziers(pathv.map((p) => p.transformed(transform)));
    const pt = (p: Point) => pointl_set(round(p.x * this.PX2WORLD), round(p.y * this.PX2WORLD));

    this.#append(uemf.U_EMRBEGINPATH_set(), 'print_pathv at U_EMRBEGINPATH_set');

    /**
     * For all Subpaths in the <path>
     */
    for (const pit of pv) {
      this.#append(uemf.U_EMRMOVETOEX_set(pt(pit.initialPoint())), 'print_pathv at U_EMRMOVETOEX_set');

      /**
       * For all segments in the subpath
       */
      for (const cit of pit.openCurves()) {
        if (is_straight_curve(cit)) {
          this.#append(uemf.U_EMRLINETO_set(pt(cit.finalPoint())), 'print_pathv at U_EMRLINETO_set');
        } else if (cit instanceof CubicBezier) {
          const points = cit.controlPoints();
          this.#append(
            uemf.U_EMRPOLYBEZIERTO_set(U_RCL_DEF, [pt(points[1]!), pt(points[2]!), pt(points[3]!)]),
            'print_pathv at U_EMRPOLYBEZIERTO_set',
          );
        } else {
          console.warn('logical error, because pathv_to_linear_and_cubic_beziers was used');
        }
      }

      if (pit.closed()) {
        // there may be multiples of this on a single path
        this.#append(uemf.U_EMRCLOSEFIGURE_set(), 'print_pathv at U_EMRCLOSEFIGURE_set');
      }
    }

    this.#append(uemf.U_EMRENDPATH_set(), 'print_pathv at U_EMRENDPATH_set'); // there may be only be one of these on a single path
    return 0;
  }

  /** may also be called with a simple_shape or an empty path, whereupon it just returns without doing anything */
  print_pathv(pathv: PathVector, transform: Affine): number {
    const uemf = this.uemf;
    this.simple_shape = this.print_simple_shape(pathv, transform);
    if (this.simple_shape || !pathv.length) {
      if (this.use_fill) this.destroy_brush(); // these must be cleared even if nothing is drawn or hbrush,hpen fill up
      if (this.use_stroke) this.destroy_pen();
      return 1;
    }

    this.draw_pathv_to_EMF(pathv, transform);

    // explicit FILL/STROKE commands are needed for each sub section of the path
    if (this.use_fill && !this.use_stroke) {
      this.#append(uemf.U_EMRFILLPATH_set(U_RCL_DEF), 'fill at U_EMRFILLPATH_set');
    } else if (this.use_fill && this.use_stroke) {
      this.#append(uemf.U_EMRSTROKEANDFILLPATH_set(U_RCL_DEF), 'stroke at U_EMRSTROKEANDFILLPATH_set');
    } else if (!this.use_fill && this.use_stroke) {
      this.#append(uemf.U_EMRSTROKEPATH_set(U_RCL_DEF), 'stroke at U_EMRSTROKEPATH_set');
    }

    // clean out brush and pen, but only after all parts of the draw complete
    if (this.use_fill) this.destroy_brush();
    if (this.use_stroke) this.destroy_pen();
    return 1;
  }

  override text(_mod: Print, text: string, p: Point, style: SPStyle): number {
    const uemf = this.uemf;
    if (!this.et || !text) return 0;

    this.do_clip_if_present(style); // If clipping is needed set it up
    let fix90n = 0;
    let hfont = 0;
    const tf = this.m_tr_stack.at(-1) ?? Affine.identity();
    let rot = (-1800.0 * Math.atan2(tf.c1, tf.c0)) / Math.PI; // 0.1 degree rotation,  - sign for MM_TEXT
    let rotb = -Math.atan2(tf.c1, tf.c0); // rotation for baseline offset for superscript/subscript, used below
    let dx: number;
    let dy: number;

    // the dx array is smuggled in like: text<nul>w1 w2 w3 ...wn<nul><nul>, where the widths are floats 7 characters wide, including the space
    const sm = PrintEmf.smuggle_adxkyrtl_out(
      text,
      this.PX2WORLD * Math.min(tf.expansionX(), tf.expansionY()),
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
      this.#append(uemf.U_EMRSETTEXTALIGN_set(textalignment), 'text at U_EMRSETTEXTALIGN_set');
    }

    const unicode_text = uemf.U_Utf8ToUtf16le(sm.text);
    //translates Unicode to NonUnicode, if possible.  If any translate, all will, and all to
    //the same font, because of code in Layout::print
    const { newfont } = uemf.UnicodeToNon(unicode_text);

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

    /*  Note that text font sizes are stored into the EMF as fairly small integers and that limits their precision.
        The EMF output files produced here have been designed so that the integer valued pt sizes
        land right on an integer value in the EMF file, so those are exact.  However, something like 18.1 pt will be
        somewhat off, so that when it is read back in it becomes 18.11 pt.  (For instance.)
    */
    const textheight = round(
      -style.font_size.computed * this.PX2WORLD * Math.min(tf.expansionX(), tf.expansionY()),
    );

    if (!hfont) {
      // Get font face name.  Use changed font name if unicode mapped to one
      // of the special fonts.
      const wfacename = uemf.U_Utf8ToUtf16le(!newfont ? font_family : uemf.FontName(newfont));

      // Scale the text to the minimum stretch. (It tends to stay within bounding rectangles even if
      // it was streteched asymmetrically.)  Few applications support text from EMF which is scaled
      // differently by height/width, so leave lfWidth alone.
      const lf = uemf.logfont_set(
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
        wfacename,
      );
      uemf.free(wfacename);

      const r = uemf.extcreatefontindirectw_set(this.eht, lf, 0);
      uemf.free(lf);
      hfont = r.ih;
      this.#append(r.rec, 'text at extcreatefontindirectw_set');
    }

    this.#append(uemf.selectobject_set(hfont, this.eht), 'text at selectobject_set');

    const rgb = style.fill.isColor() ? style.fill.getColor() : null;
    // only change the text color when it needs to be changed
    if (rgb && !this.htextcolor_rgb?.equals(rgb)) {
      this.htextcolor_rgb = rgb;
      this.#append(uemf.U_EMRSETTEXTCOLOR_set(toColorRef(rgb)), 'text at U_EMRSETTEXTCOLOR_set');
    }

    let p2 = p.transformed(tf);

    //Handle super/subscripts and vertical kerning
    p2 = p2.add(new Point(ky * Math.sin(rotb), ky * Math.cos(rotb)));

    //Conditionally handle compensation for PPT EMF import bug (affects PPT 2003-2010, at least)
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
    const rec2 = uemf.emrtext_set(
      { x: xpos, y: ypos },
      ndx,
      2,
      unicode_text,
      rtl > 0 ? U_ETO_NONE : U_ETO_RTLREADING, // RTL text, U_TA_RTLREADING should be enough, but set this one too just in case
      U_RCL_DEF,
      adx,
    );
    uemf.free(unicode_text);
    const rec = uemf.U_EMREXTTEXTOUTW_set(U_RCL_DEF, U_GM_COMPATIBLE, 1.0, 1.0, rec2);
    uemf.free(rec2);
    this.#append(rec, 'text at U_EMREXTTEXTOUTW_set');

    // Must deselect an object before deleting it.  Put the default font (back) in.
    this.#append(uemf.selectobject_set(U_DEVICE_DEFAULT_FONT, this.eht), 'text at selectobject_set');

    if (hfont) this.#append(uemf.deleteobject_set(hfont, this.eht), 'text at deleteobject_set');
    return 0;
  }

  static init(): void {
    /* EMF print */
    build_from_mem(
      `<inkscape-extension xmlns="${INKSCAPE_EXTENSION_URI}">\n` +
        '<name>Enhanced Metafile Print</name>\n' +
        '<id>org.inkscape.print.emf</id>\n' +
        '<param gui-hidden="true" name="destination" type="string"></param>\n' +
        '<param gui-hidden="true" name="textToPath" type="bool">true</param>\n' +
        '<param gui-hidden="true" name="pageBoundingBox" type="bool">true</param>\n' +
        '<param gui-hidden="true" name="FixPPTCharPos" type="bool">false</param>\n' +
        '<param gui-hidden="true" name="FixPPTDashLine" type="bool">false</param>\n' +
        '<param gui-hidden="true" name="FixPPTGrad2Polys" type="bool">false</param>\n' +
        '<param gui-hidden="true" name="FixPPTLinGrad" type="bool">false</param>\n' +
        '<param gui-hidden="true" name="FixPPTPatternAsHatch" type="bool">false</param>\n' +
        '<param gui-hidden="true" name="FixImageRot" type="bool">false</param>\n' +
        '<print/>\n' +
        '</inkscape-extension>',
      new PrintEmf(),
    );
  }
}
