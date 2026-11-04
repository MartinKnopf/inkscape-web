// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/cairo-render-context.cpp, src/extension/internal/cairo-render-context.h
/*
 * Rendering with Cairo.
 *
 * Author:
 *   Miklos Erdelyi <erdelyim@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006 Miklos Erdelyi
 */
import { Affine, type OptRect, type PathVector, Point, Scale } from '@inkscape-web/geom';
import {
  feed_pathvector_to_cairo,
  ink_cairo_pattern_add_color_stop,
  ink_cairo_pattern_set_matrix,
  ink_cairo_set_hairline,
  ink_cairo_set_source_color,
  ink_cairo_transform,
  ink_css_blend_to_cairo_operator,
  ink_matrix_to_2geom,
  ink_matrix_to_cairo,
} from '../../display/cairo-utils.ts';
import type { SPDocument } from '../../document.ts';
import type { SPClipPath } from '../../object/sp-clippath.ts';
import { SPFlowtext } from '../../object/sp-flowtext.ts';
import { SPGradient } from '../../object/sp-gradient.ts';
import { SPImage } from '../../object/sp-image.ts';
import { SPItem } from '../../object/sp-item.ts';
import { SPLinearGradient } from '../../object/sp-linear-gradient.ts';
import type { SPMask } from '../../object/sp-mask.ts';
import type { SPPaintServer } from '../../object/sp-paint-server.ts';
import { SPGradientSpread, SPGradientUnits } from '../../object/sp-paint-server-data.ts';
import { PatternUnits, SPPattern } from '../../object/sp-pattern.ts';
import { SPRadialGradient } from '../../object/sp-radial-gradient.ts';
import { SPText } from '../../object/sp-text.ts';
import type { SPStyle } from '../../style.ts';
import {
  SPBlendMode,
  SPImageRendering,
  SPOverflow,
  SPPaintOrderLayer,
  SPStrokeCapType,
  SPStrokeJoinType,
  SPWindRule,
} from '../../style-enums.ts';
import { convertUnit } from '../../svg/svg-length.ts';
import type { Node } from '../../xml/node.ts';
import {
  CAIRO_STATUS_SUCCESS,
  CAIRO_TAG_DEST,
  CAIRO_TAG_LINK,
  type CairoBackend,
  CairoContent,
  CairoExtend,
  CairoFillRule,
  CairoFilter,
  CairoFormat,
  type CairoHandle,
  CairoLineCap,
  CairoLineJoin,
  CairoOperator,
  CairoPdfMetadata,
  cairoBackend,
} from './cairo-backend.ts';
import type { CairoRenderer } from './cairo-renderer.ts';

/** Holds info for rendering a glyph. */
export interface CairoGlyphInfo {
  index: number;
  x: number;
  y: number;
}

/** A decoded bitmap for renderImage (upstream Inkscape::Pixbuf). */
export interface CairoPixbuf {
  width: number;
  height: number;
  /** An image surface that holds the pixels (the context does not destroy it). */
  surface: CairoHandle;
}

export interface CairoRenderState {
  /** whether fill/stroke opacity can be mul'd with item opacity */
  merge_opacity: boolean;
  /** whether object is masked, clipped, and/or has a non-zero opacity */
  need_layer: boolean;
  has_overflow: boolean;
  /** whether the parent's ctm should be applied */
  parent_has_userspace: boolean;
  has_filtereffect: boolean;
  opacity: number;
  /** this item's item->transform, for correct clipping */
  item_transform: Affine;
  clip_path: SPClipPath | null;
  mask: SPMask | null;
  /**
   * The geometric bounding box of the item, for clip paths and masks in objectBoundingBox
   * units. Upstream reads it from the last view of the clip path or mask (get_last_bbox()).
   */
  item_bbox: OptRect;
  /** the current transform matrix */
  transform: Affine;
}

function newState(): CairoRenderState {
  return {
    merge_opacity: true,
    need_layer: false,
    has_overflow: false,
    parent_has_userspace: false,
    has_filtereffect: false,
    opacity: 1.0,
    item_transform: Affine.identity(),
    clip_path: null,
    mask: null,
    item_bbox: null,
    transform: Affine.identity(),
  };
}

/** cairo_surface_type_t of the targets. */
export enum CairoSurfaceType {
  IMAGE = 0,
  PDF = 1,
  PS = 2,
}

export enum CairoPaintOrder {
  STROKE_OVER_FILL,
  FILL_OVER_STROKE,
  FILL_ONLY,
  STROKE_ONLY,
}

export enum CairoRenderMode {
  RENDER_MODE_NORMAL,
  RENDER_MODE_CLIP,
}

export enum CairoClipMode {
  CLIP_MODE_PATH,
  CLIP_MODE_MASK,
}

enum OmitTextPageState {
  EMPTY,
  GRAPHIC_ON_TOP,
  NEW_PAGE_ON_GRAPHIC,
}

/** Metadata to set on the cairo surface (if the surface supports it). */
interface CairoRenderContextMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  copyright: string;
  creator: string;
  cdate: string;
  mdate: string;
}

/**
 * The version written into the PDF creator field (upstream
 * Inkscape::version_string_without_revision). The app sets it.
 */
export const inkscape_version = { string: '1.5' };

/**
 * A render context for Cairo (upstream CairoRenderContext): a cairo surface (PDF, PS or image)
 * with a stack of render states. The CairoRenderer walks the object tree and calls it.
 *
 * Differences from upstream: PDF and PS targets write into memory instead of a file
 * (getOutput() after finish()); the methods that render paint servers are async, because
 * patterns render items (see CairoRenderer).
 */
export class CairoRenderContext {
  _width = 0.0;
  _height = 0.0;
  _dpi = 72;
  _pdf_level = 1;
  _ps_level = 1;
  _bitmapresolution = 72;

  _is_valid = false;
  _eps = false;
  _is_texttopath = false;
  _is_omittext = false;
  _is_show_page = false;
  _is_filtertobitmap = false;
  // If both ps and pdf are false, then we are printing.
  _is_pdf = false;
  _is_ps = false;

  _vector_based_target = false;
  _omittext_state = OmitTextPageState.EMPTY;

  /** Whether a PDF or PS target is set (upstream: the FILE handle). */
  _stream = false;
  /** The file data of a PDF or PS target after finish(). */
  _output: Uint8Array | null = null;

  /** Cairo context */
  _cr: CairoHandle = 0;
  _surface: CairoHandle = 0;
  _target = CairoSurfaceType.IMAGE;
  _target_format = CairoFormat.ARGB32;

  _state_stack: CairoRenderState[] = [];
  _renderer: CairoRenderer;

  _render_mode = CairoRenderMode.RENDER_MODE_NORMAL;
  _clip_mode = CairoClipMode.CLIP_MODE_MASK;

  _metadata: CairoRenderContextMetadata = {
    title: '',
    author: '',
    subject: '',
    keywords: '',
    copyright: '',
    creator: '',
    cdate: '',
    mdate: '',
  };

  /** Constructor is for CairoRenderer.createContext() only. */
  constructor(renderer: CairoRenderer) {
    this._renderer = renderer;
    this._addState();
  }

  get #c(): CairoBackend {
    return cairoBackend();
  }

  /** Free the cairo objects (upstream destructor). */
  _freeResources(): void {
    const c = this.#c;
    if (this._cr) {
      c.destroy(this._cr);
      this._cr = 0;
    }
    if (this._surface) {
      c.surfaceDestroy(this._surface);
      this._surface = 0;
    }
  }

  destroy(): void {
    this._freeResources();
  }

  getRenderer(): CairoRenderer {
    return this._renderer;
  }

  getCurrentState(): CairoRenderState {
    return this._state_stack[this._state_stack.length - 1]!;
  }

  getParentState(): CairoRenderState {
    // if this is the root node just return it
    if (this._state_stack.length === 1) return this.getCurrentState();
    return this._state_stack[this._state_stack.length - 2]!;
  }

  setStateForStyle(style: SPStyle): void {
    // only opacity & overflow is stored for now
    const state = this.getCurrentState();
    state.opacity = style.opacity.as_double();
    state.has_overflow = style.overflow.set && style.overflow.value !== SPOverflow.SP_CSS_OVERFLOW_VISIBLE;
    state.has_filtereffect = style.filter.set;

    if (style.fill.isPaintserver() || style.stroke.isPaintserver()) state.merge_opacity = false;

    // disable rendering of opacity if there's a stroke on the fill
    if (state.merge_opacity && !style.fill.isNone() && !style.stroke.isNone()) state.merge_opacity = false;
  }

  setStateForItem(item: SPItem): void {
    this.setStateForStyle(item.style);

    const state = this.getCurrentState();
    state.clip_path = item.getClipObject();
    state.mask = item.getMaskObject();
    state.item_transform = item.transform;
    if (state.clip_path || state.mask) state.item_bbox = item.geometricBounds();

    // If parent_has_userspace is true the parent state's transform
    // has to be used for the mask's/clippath's context.
    // This is so because we use the image's/(flow)text's transform for positioning
    // instead of explicitly specifying it and letting the renderer do the
    // transformation before rendering the item.
    if (item instanceof SPText || item instanceof SPFlowtext || item instanceof SPImage) {
      state.parent_has_userspace = true;
    }
  }

  setStateNeedsLayer(state_needs_layer: boolean): void {
    this.getCurrentState().need_layer = state_needs_layer;
  }

  setStateMergeOpacity(state_merge_opacity: boolean): void {
    this.getCurrentState().merge_opacity = state_merge_opacity;
  }

  /**
   * Creates a new render context which will be compatible with the given context's Cairo surface.
   */
  createSimilar(width: number, height: number): CairoRenderContext {
    const c = this.#c;
    const new_context = this._renderer.createContext();
    new_context._surface = c.surfaceCreateSimilar(
      c.getTarget(this._cr),
      CairoContent.COLOR_ALPHA,
      Math.ceil(width),
      Math.ceil(height),
    );
    new_context._cr = c.create(new_context._surface);
    new_context._width = width;
    new_context._height = height;
    new_context._is_valid = true;
    return new_context;
  }

  setImageTarget(format: CairoFormat): boolean {
    // format cannot be set on an already initialized surface
    if (this._is_valid) return false;
    switch (format) {
      case CairoFormat.ARGB32:
      case CairoFormat.RGB24:
      case CairoFormat.A8:
      case CairoFormat.A1:
        this._target_format = format;
        this._target = CairoSurfaceType.IMAGE;
        return true;
      default:
        return false;
    }
  }

  _setVectorTarget(type: CairoSurfaceType): boolean {
    this._target = type;
    this._vector_based_target = true;
    this._stream = true;
    return true;
  }

  /** Render to PDF (upstream: to the file utf8_fn; here getOutput() returns the data). */
  setPdfTarget(): boolean {
    return this._setVectorTarget(CairoSurfaceType.PDF);
  }

  /** Render to PostScript (upstream: to the file utf8_fn; here getOutput() returns the data). */
  setPsTarget(): boolean {
    return this._setVectorTarget(CairoSurfaceType.PS);
  }

  setPSLevel(level: number): void {
    this._ps_level = level;
    this._is_pdf = false;
    this._is_ps = true;
  }

  setPDFLevel(level: number): void {
    this._pdf_level = level;
    this._is_pdf = true;
    this._is_ps = false;
  }

  setEPS(eps: boolean): void {
    this._eps = eps;
  }
  setTextToPath(texttopath: boolean): void {
    this._is_texttopath = texttopath;
  }
  setOmitText(omittext: boolean): void {
    this._is_omittext = omittext;
  }
  setFilterToBitmap(filtertobitmap: boolean): void {
    this._is_filtertobitmap = filtertobitmap;
  }
  getFilterToBitmap(): boolean {
    return this._is_filtertobitmap;
  }
  setBitmapResolution(resolution: number): void {
    this._bitmapresolution = resolution;
  }
  getBitmapResolution(): number {
    return this._bitmapresolution;
  }
  getTextToPath(): boolean {
    return this._is_texttopath;
  }

  getSurface(): CairoHandle {
    return this._surface;
  }

  /** The PNG file of the surface (upstream saveAsPng() writes a file). */
  saveAsPng(): Uint8Array {
    return this.#c.surfaceWriteToPng(this._surface);
  }

  /** The PDF or PS file data, after finish(). */
  getOutput(): Uint8Array | null {
    return this._output;
  }

  setRenderMode(mode: CairoRenderMode): void {
    this._render_mode = mode;
  }
  getRenderMode(): CairoRenderMode {
    return this._render_mode;
  }

  setClipMode(mode: CairoClipMode): void {
    this._clip_mode = mode;
  }
  getClipMode(): CairoClipMode {
    return this._clip_mode;
  }

  pushLayer(): void {
    const c = this.#c;
    c.pushGroup(this._cr);

    // clear buffer
    if (!this._vector_based_target) {
      c.save(this._cr);
      c.setOperator(this._cr, CairoOperator.CLEAR);
      c.paint(this._cr);
      c.restore(this._cr);
    }
  }

  async popLayer(composite: CairoOperator = CairoOperator.CLEAR): Promise<void> {
    const c = this.#c;
    const cr = this._cr;
    const opacity = this.getCurrentState().opacity;

    /*
     At this point, the Cairo source is ready. A Cairo mask must be created if required.
     Care must be taken of transformatons as Cairo, like PS and PDF, treats clip paths and
     masks independently of the objects they effect while in SVG the clip paths and masks
     are defined relative to the objects they are attached to.
     Notes:
     1. An SVG object may have both a clip path and a mask!
     2. An SVG clip path can be composed of an object with a clip path. This is not handled properly.
     3. An SVG clipped or masked object may be first drawn off the page and then translated onto
        the page (document). This is also not handled properly.
     4. The code converts all SVG masks to bitmaps. This shouldn't be necessary.
     5. Cairo expects a mask to use only the alpha channel. SVG masks combine the RGB luminance with
        alpha. This is handled here by doing a pixel by pixel conversion.
    */

    const clip_path = this.getCurrentState().clip_path;
    let mask = this.getCurrentState().mask;
    if (clip_path || mask) {
      let clip_mask: CairoHandle = 0;
      let clip_ctx: CairoRenderContext | null = null;

      // Apply any clip path first (before masking)
      if (clip_path) {
        if (this._render_mode === CairoRenderMode.RENDER_MODE_CLIP) mask = null; // disable mask when performing nested clipping

        if (this._vector_based_target) {
          this.setClipMode(CairoClipMode.CLIP_MODE_PATH); // Vector
          if (!mask) {
            c.popGroupToSource(cr);
            await this._renderer.applyClipPath(this, clip_path); // Uses cairo_clip()
            if (opacity === 1.0) c.paint(cr);
            else c.paintWithAlpha(cr, opacity);
          }
        } else {
          // setup a new rendering context
          const cctx = this._renderer.createContext();
          clip_ctx = cctx;
          cctx.setImageTarget(CairoFormat.A8);
          cctx.setClipMode(CairoClipMode.CLIP_MODE_MASK); // Raster
          // This code ties the clipping to the document coordinates. It doesn't allow
          // for a clipped object initially drawn off the page and then translated onto
          // the page.
          if (!cctx.setupSurface(this._width, this._height)) {
            cctx.destroy();
            return;
          }

          // clear buffer
          c.save(cctx._cr);
          c.setOperator(cctx._cr, CairoOperator.CLEAR);
          c.paint(cctx._cr);
          c.restore(cctx._cr);

          // If a mask won't be applied set opacity too. (The clip is represented by a solid Cairo mask.)
          c.setSourceRgba(cctx._cr, 1.0, 1.0, 1.0, mask ? 1.0 : opacity);

          // It must be copied before pushState and stored after.
          const item_transform = this.getItemTransform();
          // apply the clip path
          cctx.pushState();
          cctx.setItemTransform(item_transform);
          cctx.getCurrentState().item_bbox = this.getCurrentState().item_bbox;
          await this._renderer.applyClipPath(cctx, clip_path);
          cctx.popState();

          clip_mask = cctx.getSurface();

          if (!mask) {
            c.popGroupToSource(cr);
            if (composite !== CairoOperator.CLEAR) c.setOperator(cr, composite);
            c.maskSurface(cr, clip_mask, 0, 0);
          }
        }
      }

      // Apply any mask second
      if (mask) {
        // create rendering context for mask
        const mask_ctx = this._renderer.createContext();

        if (!mask_ctx.setupSurface(this._width, this._height)) {
          mask_ctx.destroy();
          clip_ctx?.destroy();
          return;
        }

        // Mask should start black, but it is created white.
        c.setSourceRgba(mask_ctx._cr, 0.0, 0.0, 0.0, 1.0);
        c.rectangle(mask_ctx._cr, 0, 0, this._width, this._height);
        c.fill(mask_ctx._cr);
        this.setRenderMode(CairoRenderMode.RENDER_MODE_NORMAL);

        // copy the correct CTM to mask context
        const state = this.getCurrentState();
        mask_ctx.setTransform(
          state.parent_has_userspace
            ? state.item_transform.multiply(this.getParentState().transform)
            : state.transform,
        );
        mask_ctx.getCurrentState().item_bbox = state.item_bbox;

        // render mask contents to mask_ctx
        await this._renderer.applyMask(mask_ctx, mask);

        // composite with clip mask
        if (clip_path && this._clip_mode === CairoClipMode.CLIP_MODE_MASK && clip_mask) {
          c.maskSurface(mask_ctx._cr, clip_mask, 0, 0);
        }

        const mask_image = mask_ctx.getSurface();
        const width = c.imageSurfaceGetWidth(mask_image);
        const height = c.imageSurfaceGetHeight(mask_image);
        const stride = c.imageSurfaceGetStride(mask_image);
        const pixels = c.imageSurfaceGetData(mask_image);

        // In SVG, the rgb channels as well as the alpha channel is used in masking.
        // In Cairo, only the alpha channel is used thus requiring this conversion.
        // SVG specifies that RGB be converted to alpha using luminance-to-alpha.
        // Notes: This calculation assumes linear RGB values. VERIFY COLOR SPACE!
        // The incoming pixel values already include alpha, fill-opacity, etc.,
        // however, opacity must still be applied.
        if (pixels) {
          const coeff_r = 0.2125 / 255.0;
          const coeff_g = 0.7154 / 255.0;
          const coeff_b = 0.0721 / 255.0;
          const view = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
          for (let row = 0; row < height; row++) {
            for (let i = 0; i < width; i++) {
              const at = row * stride + 4 * i;
              const pixel = view.getUint32(at, true);
              const lum_alpha =
                ((pixel & 0x00ff0000) >>> 16) * coeff_r +
                ((pixel & 0x0000ff00) >>> 8) * coeff_g +
                (pixel & 0x000000ff) * coeff_b;
              // lum_alpha can be slightly greater than 1 due to rounding errors...
              // but this should be OK since it doesn't matter what the lower
              // six hexadecimal numbers of *pixel are.
              view.setUint32(at, Math.trunc(0xff000000 * Math.min(lum_alpha * opacity, 1)) >>> 0, true);
            }
          }
          c.imageSurfaceSetData(mask_image, pixels);
        }

        c.popGroupToSource(cr);
        if (composite !== CairoOperator.CLEAR) c.setOperator(cr, composite);
        if (this._clip_mode === CairoClipMode.CLIP_MODE_PATH && clip_path) {
          // we have to do the clipping after cairo_pop_group_to_source
          await this._renderer.applyClipPath(this, clip_path);
        }

        {
          // Transformations are applied when rendering the mask, so
          // do not apply them again when applying the mask.
          const old_transform = c.getMatrix(cr);
          c.identityMatrix(cr);
          // apply the mask onto the layer
          c.maskSurface(cr, mask_image, 0, 0);
          c.setMatrix(cr, old_transform);
        }
        mask_ctx.destroy();
      }
      clip_ctx?.destroy();
    } else {
      // No clip path or mask
      c.popGroupToSource(cr);
      if (composite !== CairoOperator.CLEAR) c.setOperator(cr, composite);
      if (opacity === 1.0) c.paint(cr);
      else c.paintWithAlpha(cr, opacity);
    }
  }

  tagBegin(l: string): void {
    this.#c.tagBegin(this._cr, CAIRO_TAG_LINK, l);
  }

  tagEnd(): void {
    this.#c.tagEnd(this._cr, CAIRO_TAG_LINK);
  }

  destBegin(l: string): void {
    this.#c.tagBegin(this._cr, CAIRO_TAG_DEST, `name='${l}'`);
  }

  destEnd(): void {
    this.#c.tagEnd(this._cr, CAIRO_TAG_DEST);
  }

  addClipPath(pv: PathVector, fill_rule: SPWindRule): void {
    // here it should be checked whether the current clip winding changed
    // so we could switch back to masked clipping
    this.#c.setFillRule(
      this._cr,
      fill_rule === SPWindRule.SP_WIND_RULE_EVENODD ? CairoFillRule.EVEN_ODD : CairoFillRule.WINDING,
    );
    this.addPathVector(pv);
  }

  addClippingRect(x: number, y: number, width: number, height: number): void {
    this.#c.rectangle(this._cr, x, y, width, height);
    this.#c.clip(this._cr);
  }

  /**
   * Creates the cairo_surface_t for the context with the given width, height and with the
   * currently set target surface type. Also sets supported metadata on the surface.
   */
  setupSurface(width: number, height: number): boolean {
    // Is the surface already set up?
    if (this._is_valid) return true;

    if (this._vector_based_target && !this._stream) return false;

    this._width = width;
    this._height = height;

    const c = this.#c;
    let surface: CairoHandle = 0;
    switch (this._target) {
      case CairoSurfaceType.IMAGE:
        surface = c.imageSurfaceCreate(this._target_format, Math.ceil(width), Math.ceil(height));
        break;
      case CairoSurfaceType.PDF:
        surface = c.pdfSurfaceCreate(width, height);
        c.pdfSurfaceRestrictToVersion(surface, this._pdf_level);
        break;
      case CairoSurfaceType.PS:
        surface = c.psSurfaceCreate(width, height);
        if (c.surfaceStatus(surface) !== CAIRO_STATUS_SUCCESS) {
          c.surfaceDestroy(surface);
          return false;
        }
        c.psSurfaceRestrictToLevel(surface, this._ps_level);
        c.psSurfaceSetEps(surface, this._eps);
        break;
      default:
        return false;
    }

    this._setSurfaceMetadata(surface);

    return this._finishSurfaceSetup(surface, Affine.identity());
  }

  /** Set the cairo_surface_t from an external source. */
  setSurfaceTarget(surface: CairoHandle, is_vector: boolean, ctm: Affine | null = null): boolean {
    if (this._is_valid || !surface) return false;
    this._vector_based_target = is_vector;
    return this._finishSurfaceSetup(surface, ctm);
  }

  /** Extract metadata from the document and store it in the context. */
  setMetadata(doc: SPDocument): void {
    const title = rdf_get_work_entity(doc, 'title');
    if (title) this._metadata.title = title;
    const author = rdf_get_work_entity(doc, 'creator');
    if (author) this._metadata.author = author;
    const subject = rdf_get_work_entity(doc, 'description');
    if (subject) this._metadata.subject = subject;
    const keywords = rdf_get_work_entity(doc, 'subject');
    if (keywords) this._metadata.keywords = keywords;
    const copyright = rdf_get_work_entity(doc, 'rights');
    if (copyright) this._metadata.copyright = copyright;

    // creator
    this._metadata.creator = `Inkscape ${inkscape_version.string} (https://inkscape.org)`;
    // cdate (only used for for reproducible builds hack): SOURCE_DATE_EPOCH does not exist here.
    // mdate (currently unused)
  }

  _finishSurfaceSetup(surface: CairoHandle, ctm: Affine | null = null): boolean {
    const c = this.#c;
    if (!surface) return false;
    if (c.surfaceStatus(surface) !== CAIRO_STATUS_SUCCESS) {
      c.surfaceDestroy(surface);
      return false;
    }

    this._cr = c.create(surface);
    if (c.status(this._cr) !== CAIRO_STATUS_SUCCESS) return false;
    if (ctm) c.setMatrix(this._cr, ink_matrix_to_cairo(ctm));
    this._surface = surface;

    if (this._vector_based_target) {
      c.scale(this._cr, convertUnit(1, 'px', 'pt'), convertUnit(1, 'px', 'pt'));
    } else if (c.surfaceGetContent(this._surface) !== CairoContent.ALPHA) {
      // set background color on non-alpha surfaces
      // TODO: bgcolor should be derived from SPDocument (see IconImpl)
      c.setSourceRgba(this._cr, 1.0, 1.0, 1.0, 1.0);
      c.rectangle(this._cr, 0, 0, this._width, this._height);
      c.fill(this._cr);
    }

    this._is_valid = true;
    return true;
  }

  _setSurfaceMetadata(surface: CairoHandle): void {
    const c = this.#c;
    const m = this._metadata;
    switch (this._target) {
      case CairoSurfaceType.PDF:
        if (m.title) c.pdfSurfaceSetMetadata(surface, CairoPdfMetadata.TITLE, m.title);
        if (m.author) c.pdfSurfaceSetMetadata(surface, CairoPdfMetadata.AUTHOR, m.author);
        if (m.subject) c.pdfSurfaceSetMetadata(surface, CairoPdfMetadata.SUBJECT, m.subject);
        if (m.keywords) c.pdfSurfaceSetMetadata(surface, CairoPdfMetadata.KEYWORDS, m.keywords);
        if (m.creator) c.pdfSurfaceSetMetadata(surface, CairoPdfMetadata.CREATOR, m.creator);
        if (m.cdate) c.pdfSurfaceSetMetadata(surface, CairoPdfMetadata.CREATE_DATE, m.cdate);
        if (m.mdate) c.pdfSurfaceSetMetadata(surface, CairoPdfMetadata.MOD_DATE, m.mdate);
        break;
      case CairoSurfaceType.PS:
        if (m.title) c.psSurfaceDscComment(surface, `%%Title: ${m.title}`);
        if (m.copyright) c.psSurfaceDscComment(surface, `%%Copyright: ${m.copyright}`);
        break;
      default:
        break;
    }
  }

  /** Each page that's made should call finishPage to complete it. */
  finishPage(): boolean {
    if (!this._vector_based_target) return false;
    const c = this.#c;

    // Protect against finish() showing one too many pages.
    if (!this._is_show_page) {
      c.showPage(this._cr);
      this._is_show_page = true;
    }

    const status = c.status(this._cr);
    if (status !== CAIRO_STATUS_SUCCESS) {
      console.error(`error while rendering page: ${c.statusToString(status)}`);
      return false;
    }
    return true;
  }

  /** When writing multiple pages, resize the next page. */
  nextPage(width: number, height: number, label: string | null): boolean {
    if (!this._vector_based_target) return false;
    const c = this.#c;

    this._width = width;
    this._height = height;
    this._is_show_page = false;

    if (this._is_pdf) {
      c.pdfSurfaceSetSize(this._surface, width, height);
      if (label) c.pdfSurfaceSetPageLabel(this._surface, label);
    }
    if (this._is_ps) {
      c.psSurfaceSetSize(this._surface, width, height);
    }

    const status = c.surfaceStatus(this._surface);
    if (status !== CAIRO_STATUS_SUCCESS) {
      console.error(`error while sizing page: ${c.statusToString(status)}`);
      return false;
    }
    return true;
  }

  finish(finish_surface = true): boolean {
    const c = this.#c;
    if (this._vector_based_target && !this._is_show_page && finish_surface) c.showPage(this._cr);

    let status = c.status(this._cr);
    if (status !== CAIRO_STATUS_SUCCESS)
      console.error(`error while rendering output: ${c.statusToString(status)}`);

    c.destroy(this._cr);
    this._cr = 0;

    if (finish_surface) c.surfaceFinish(this._surface);
    status = c.surfaceStatus(this._surface);
    if (this._vector_based_target && this._stream) {
      this._output = c.surfaceTakeOutput(this._surface);
      this._stream = false;
    }
    c.surfaceDestroy(this._surface);
    this._surface = 0;

    this._is_valid = false;
    return status === CAIRO_STATUS_SUCCESS;
  }

  transform(transform: Affine): void {
    // Cairo internally does not like object transforms that can not be inverted
    if (Math.abs(transform.det()) < 1e-6) return;

    ink_cairo_transform(this._cr, transform);

    // store new CTM
    this.getCurrentState().transform = this.getTransform();
  }

  setTransform(transform: Affine): void {
    ink_cairo_transform(this._cr, transform);
    this.getCurrentState().transform = transform;
  }

  setItemTransform(transform: Affine): void {
    this.getCurrentState().item_transform = transform;
  }

  getTransform(): Affine {
    return ink_matrix_to_2geom(this.#c.getMatrix(this._cr));
  }

  getItemTransform(): Affine {
    const state = this.getCurrentState();
    if (state.parent_has_userspace) return this.getParentTransform().multiply(state.item_transform);
    return state.item_transform;
  }

  getParentTransform(): Affine {
    return this.getParentState().transform;
  }

  pushState(): void {
    this.#c.save(this._cr);
    // copy current state's transform
    const current_transform = this.getCurrentState().transform;
    this._addState().transform = current_transform;
  }

  popState(): void {
    this.#c.restore(this._cr);
    this._state_stack.pop();
  }

  _addState(): CairoRenderState {
    const state = newState();
    this._state_stack.push(state);
    return state;
  }

  async _createPatternPainter(paintserver: SPPaintServer, pbox: OptRect): Promise<CairoHandle> {
    const c = this.#c;
    const pat = paintserver as SPPattern;

    let ps2user = Affine.identity();
    let pcs2dev = Affine.identity();

    const x = pat.x();
    const y = pat.y();
    const width = pat.width();
    const height = pat.height();
    let bbox_width_scaler: number;
    let bbox_height_scaler: number;

    if (pbox && pat.patternUnits() === PatternUnits.UNITS_OBJECTBOUNDINGBOX) {
      bbox_width_scaler = pbox.width();
      bbox_height_scaler = pbox.height();
      ps2user = ps2user.withTranslation(
        new Point(x * bbox_width_scaler + pbox.left(), y * bbox_height_scaler + pbox.top()),
      );
    } else {
      bbox_width_scaler = 1.0;
      bbox_height_scaler = 1.0;
      ps2user = ps2user.withTranslation(new Point(x, y));
    }

    // apply pattern transformation
    ps2user = ps2user.multiply(pat.getTransform());
    const ori = ps2user.translation();

    // create pattern contents coordinate system
    const view_box = pat.viewbox();
    if (view_box) {
      const w = width * bbox_width_scaler;
      const h = height * bbox_height_scaler;
      const sx = w / view_box.width();
      const sy = h / view_box.height();
      pcs2dev = new Affine(sx, 0, 0, sy, -view_box.left() * sx, -view_box.top() * sy);
    } else if (pbox && pat.patternContentUnits() === PatternUnits.UNITS_OBJECTBOUNDINGBOX) {
      pcs2dev = new Affine(pbox.width(), 0, 0, pbox.height(), 0, 0);
    }

    // Calculate the size of the surface which has to be created
    const SUBPIX_SCALE = 100;
    // Cairo requires an integer pattern surface width/height.
    // Subtract 0.5 to prevent small rounding errors from increasing pattern size by one pixel.
    // Multiply by SUBPIX_SCALE to allow for less than a pixel precision
    const surface_width = Math.max(Math.ceil(SUBPIX_SCALE * bbox_width_scaler * width - 0.5), 1);
    const surface_height = Math.max(Math.ceil(SUBPIX_SCALE * bbox_height_scaler * height - 0.5), 1);
    // create new rendering context
    const pattern_ctx = this.createSimilar(surface_width, surface_height);

    // adjust the size of the painted pattern to fit exactly the created surface
    // this has to be done because of the rounding to obtain an integer pattern surface width/height
    const scale_width = surface_width / (bbox_width_scaler * width);
    const scale_height = surface_height / (bbox_height_scaler * height);
    if (scale_width !== 1.0 || scale_height !== 1.0 || this._vector_based_target) {
      pcs2dev = pcs2dev.multiply(Scale(SUBPIX_SCALE, SUBPIX_SCALE));
      ps2user = ps2user.multiply(Scale(1.0 / SUBPIX_SCALE, 1.0 / SUBPIX_SCALE));
    }

    // despite scaling up/down by subpixel scaler, the origin point of the pattern must be the same
    ps2user = ps2user.withTranslation(ori);

    pattern_ctx.setTransform(pcs2dev);
    pattern_ctx.pushState();

    // render the items (upstream shows them in a drawing first)
    for (let pat_i: SPPattern | null = pat; pat_i; pat_i = pat_i.ref.getObject() as SPPattern | null) {
      if (pat_i.hasItemChildren()) {
        // find the first one with item children
        for (const child of pat_i.children) {
          if (child instanceof SPItem) await this._renderer.renderItem(pattern_ctx, child);
        }
        break; // do not go further up the chain if children are found
      }
    }

    pattern_ctx.popState();

    // setup a cairo_pattern_t
    const pattern_surface = pattern_ctx.getSurface();
    const result = c.patternCreateForSurface(pattern_surface);
    c.patternSetExtend(result, CairoExtend.REPEAT);

    // set pattern transformation
    ink_cairo_pattern_set_matrix(result, ps2user.inverse());

    pattern_ctx.destroy();
    return result;
  }

  async _createPatternForPaintServer(
    paintserver: SPPaintServer,
    pbox: OptRect,
    alpha: number,
  ): Promise<CairoHandle> {
    const c = this.#c;
    let pattern: CairoHandle = 0;
    let apply_bbox2user = false;

    if (paintserver instanceof SPLinearGradient) {
      const lg = paintserver;
      lg.ensureVector(); // when exporting from commandline, vector is not built

      let p1 = new Point(lg.x1.computed, lg.y1.computed);
      let p2 = new Point(lg.x2.computed, lg.y2.computed);
      if (pbox && lg.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX) {
        // convert to userspace
        const bbox2user = new Affine(pbox.width(), 0, 0, pbox.height(), pbox.left(), pbox.top());
        p1 = p1.transformed(bbox2user);
        p2 = p2.transformed(bbox2user);
      }

      // create linear gradient pattern
      pattern = c.patternCreateLinear(p1.x, p1.y, p2.x, p2.y);

      // add stops
      for (const stop of lg.vector.stops) {
        if (stop.color) ink_cairo_pattern_add_color_stop(pattern, stop.offset, stop.color.withOpacity(alpha));
      }
    } else if (paintserver instanceof SPRadialGradient) {
      const rg = paintserver;
      rg.ensureVector(); // when exporting from commandline, vector is not built

      const cx = rg.cx.computed;
      const cy = rg.cy.computed;
      const fx = rg.fx.computed;
      const fy = rg.fy.computed;
      const r = rg.r.computed;
      const fr = rg.fr.computed;
      if (pbox && rg.getUnits() === SPGradientUnits.SP_GRADIENT_UNITS_OBJECTBOUNDINGBOX)
        apply_bbox2user = true;

      // create radial gradient pattern
      pattern = c.patternCreateRadial(fx, fy, fr, cx, cy, r);

      // add stops
      for (const stop of rg.vector.stops) {
        if (stop.color) ink_cairo_pattern_add_color_stop(pattern, stop.offset, stop.color.withOpacity(alpha));
      }
    } else if (paintserver instanceof SPPattern) {
      pattern = await this._createPatternPainter(paintserver, pbox);
    } else {
      // TODO: mesh gradients (DrawingMeshGradient::create_pattern) and hatches.
      return 0;
    }

    if (pattern && paintserver instanceof SPGradient) {
      const g = paintserver;

      // set extend type
      switch (g.fetchSpread()) {
        case SPGradientSpread.SP_GRADIENT_SPREAD_REPEAT:
          c.patternSetExtend(pattern, CairoExtend.REPEAT);
          break;
        case SPGradientSpread.SP_GRADIENT_SPREAD_REFLECT: // not supported by cairo-pdf yet
          c.patternSetExtend(pattern, CairoExtend.REFLECT);
          break;
        case SPGradientSpread.SP_GRADIENT_SPREAD_PAD: // not supported by cairo-pdf yet
          c.patternSetExtend(pattern, CairoExtend.PAD);
          break;
        default:
          c.patternSetExtend(pattern, CairoExtend.NONE);
          break;
      }

      // apply gradient transformation
      let pattern_matrix = g.gradientTransform_set ? g.gradientTransform : Affine.identity();
      if (apply_bbox2user && pbox) {
        // convert to userspace
        pattern_matrix = pattern_matrix.multiply(
          new Affine(pbox.width(), 0, 0, pbox.height(), pbox.left(), pbox.top()),
        );
      }
      // Inverse because Cairo expects a userspace->patternspace matrix
      ink_cairo_pattern_set_matrix(pattern, pattern_matrix.inverse());
    }

    return pattern;
  }

  _mergedOpacity(source_opacity: number): number {
    const state = this.getCurrentState();
    return state.merge_opacity ? source_opacity * state.opacity : source_opacity;
  }

  async _setFillStyle(style: SPStyle, pbox: OptRect): Promise<void> {
    const c = this.#c;
    const alpha = this._mergedOpacity(style.fill_opacity.as_double());
    const paint_server = style.getFillPaintServer();
    if (style.fill.isContext()) {
      // Do nothing. These are valid values but if not inside a <use> or <marker> element do nothing.
    } else if (paint_server?.isValid()) {
      const pattern = await this._createPatternForPaintServer(paint_server, pbox, alpha);
      if (pattern) {
        c.setSource(this._cr, pattern);
        c.patternDestroy(pattern);
      }
    } else if (style.fill.isColor()) {
      ink_cairo_set_source_color(this._cr, style.fill.getColor().withOpacity(alpha));
    } else {
      // unset fill is black
      c.setSourceRgba(this._cr, 0, 0, 0, alpha);
    }
  }

  async _setStrokeStyle(style: SPStyle, pbox: OptRect): Promise<void> {
    const c = this.#c;
    const cr = this._cr;
    const alpha = this._mergedOpacity(style.stroke_opacity.as_double());
    const paint_server = style.getStrokePaintServer();
    if (style.stroke.isContext()) {
      // Do nothing. These are valid values but if not inside a <use> or <marker> element do nothing.
    } else if (style.stroke.isColor() || (style.stroke.isPaintserver() && !paint_server?.isValid())) {
      ink_cairo_set_source_color(cr, style.stroke.getColor().withOpacity(alpha));
    } else if (paint_server) {
      const pattern = await this._createPatternForPaintServer(paint_server, pbox, alpha);
      if (pattern) {
        c.setSource(cr, pattern);
        c.patternDestroy(pattern);
      }
    }

    const dash_values = style.stroke_dasharray.values;
    if (dash_values.length > 0 && dash_values.every((d) => d.value >= 0 && Number.isFinite(d.value))) {
      c.setDash(
        cr,
        Float64Array.from(dash_values, (d) => d.value),
        style.stroke_dashoffset.value,
      );
    } else {
      c.setDash(cr, new Float64Array(0), 0.0); // disable dashing
    }

    // This allows hairlines to be drawn properly in PDF, PS, Win32-Print, etc.
    if (style.stroke_extensions.hairline) {
      ink_cairo_set_hairline(cr);
    } else {
      c.setLineWidth(cr, style.stroke_width.computed);
    }

    // set line join type
    let join = CairoLineJoin.MITER;
    switch (style.stroke_linejoin.computed) {
      case SPStrokeJoinType.SP_STROKE_LINEJOIN_ROUND:
        join = CairoLineJoin.ROUND;
        break;
      case SPStrokeJoinType.SP_STROKE_LINEJOIN_BEVEL:
        join = CairoLineJoin.BEVEL;
        break;
    }
    c.setLineJoin(cr, join);

    // set line cap type
    let cap = CairoLineCap.BUTT;
    switch (style.stroke_linecap.computed) {
      case SPStrokeCapType.SP_STROKE_LINECAP_ROUND:
        cap = CairoLineCap.ROUND;
        break;
      case SPStrokeCapType.SP_STROKE_LINECAP_SQUARE:
        cap = CairoLineCap.SQUARE;
        break;
    }
    c.setLineCap(cr, cap);
    c.setMiterLimit(cr, Math.max(1, style.stroke_miterlimit.value));
  }

  async _prepareRenderGraphic(): Promise<void> {
    // Only PDFLaTeX supports importing a single page of a graphics file,
    // so only PDF backend gets interleaved text/graphics
    if (
      this._is_omittext &&
      this._omittext_state === OmitTextPageState.NEW_PAGE_ON_GRAPHIC &&
      this._target === CairoSurfaceType.PDF &&
      this._render_mode !== CairoRenderMode.RENDER_MODE_CLIP
    ) {
      // better set this immediately (not sure if masks applied during "popLayer" could call
      // this function, too, triggering the same code again in error
      this._omittext_state = OmitTextPageState.GRAPHIC_ON_TOP;

      // As we can not emit the page in the middle of a layer (aka group) - it will not be fully painted yet! -
      // the following basically mirrors the calls in CairoRenderer::renderItem (but in reversed order)
      // - first traverse all saved states in reversed order (i.e. from deepest nesting to the top)
      //   and apply clipping / masking to layers on the way (this is done in popLayer)
      // - then emit the page using cairo_show_page()
      // - finally restore the previous state with proper transforms and appropriate layers again
      const c = this.#c;
      const original_stack = this._state_stack.map((s) => ({ ...s }));

      while (this._state_stack.length > 1) {
        if (this.getCurrentState().need_layer) await this.popLayer();
        c.restore(this._cr);
        this._state_stack.pop();
      }

      c.showPage(this._cr);

      for (let i = 1; i < original_stack.length; i++) {
        this._state_stack.push(original_stack[i]!);
        c.save(this._cr);
        if (this.getCurrentState().need_layer) this.pushLayer();
        this.setTransform(this.getCurrentState().transform);
      }
    }
    this._omittext_state = OmitTextPageState.GRAPHIC_ON_TOP;
  }

  _prepareRenderText(): void {
    // Only PDFLaTeX supports importing a single page of a graphics file,
    // so only PDF backend gets interleaved text/graphics
    if (
      this._is_omittext &&
      this._target === CairoSurfaceType.PDF &&
      this._omittext_state === OmitTextPageState.GRAPHIC_ON_TOP
    ) {
      this._omittext_state = OmitTextPageState.NEW_PAGE_ON_GRAPHIC;
    }
  }

  /**
   * We need CairoPaintOrder as markers are rendered in a separate step and may be rendered
   * in between fill and stroke.
   */
  async renderPathVector(
    pathv: PathVector,
    style: SPStyle,
    pbox: OptRect,
    order: CairoPaintOrder = CairoPaintOrder.STROKE_OVER_FILL,
  ): Promise<boolean> {
    const c = this.#c;
    const cr = this._cr;
    await this._prepareRenderGraphic();

    if (this._render_mode === CairoRenderMode.RENDER_MODE_CLIP) {
      if (this._clip_mode === CairoClipMode.CLIP_MODE_PATH) {
        this.addClipPath(pathv, style.fill_rule.computed);
      } else {
        this.setPathVector(pathv);
        c.setFillRule(
          cr,
          style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD
            ? CairoFillRule.EVEN_ODD
            : CairoFillRule.WINDING,
        );
        if (style.mix_blend_mode.set && style.mix_blend_mode.value) {
          c.setOperator(cr, ink_css_blend_to_cairo_operator(style.mix_blend_mode.value));
        }
        c.fill(cr);
      }
      return true;
    }

    const no_fill =
      style.fill.isNone() ||
      style.fill.isContext() ||
      style.fill_opacity.value === 0 ||
      order === CairoPaintOrder.STROKE_ONLY;
    const no_stroke =
      style.stroke.isNone() ||
      style.stroke.isContext() ||
      (!style.stroke_extensions.hairline && style.stroke_width.computed < 1e-9) ||
      style.stroke_opacity.value === 0 ||
      order === CairoPaintOrder.FILL_ONLY;

    if (no_fill && no_stroke) return true;

    const state = this.getCurrentState();
    let need_layer =
      !state.merge_opacity &&
      !state.need_layer &&
      (state.opacity !== 1.0 || state.clip_path !== null || state.mask !== null);
    let blend = false;
    if (style.mix_blend_mode.set && style.mix_blend_mode.value !== SPBlendMode.SP_CSS_BLEND_NORMAL) {
      need_layer = true;
      blend = true;
    }
    if (!need_layer) c.save(cr);
    else this.pushLayer();

    if (!no_fill) {
      c.setFillRule(
        cr,
        style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD
          ? CairoFillRule.EVEN_ODD
          : CairoFillRule.WINDING,
      );
    }

    this.setPathVector(pathv);

    if (!no_fill && (order === CairoPaintOrder.STROKE_OVER_FILL || order === CairoPaintOrder.FILL_ONLY)) {
      await this._setFillStyle(style, pbox);
      if (no_stroke) c.fill(cr);
      else c.fillPreserve(cr);
    }

    if (!no_stroke) {
      await this._setStrokeStyle(style, pbox);
      if (no_fill || order === CairoPaintOrder.STROKE_OVER_FILL) c.stroke(cr);
      else c.strokePreserve(cr);
    }

    if (!no_fill && order === CairoPaintOrder.FILL_OVER_STROKE) {
      await this._setFillStyle(style, pbox);
      c.fill(cr);
    }

    if (need_layer) {
      if (blend) await this.popLayer(ink_css_blend_to_cairo_operator(style.mix_blend_mode.value));
      else await this.popLayer();
    } else {
      c.restore(cr);
    }

    return true;
  }

  async renderImage(pb: CairoPixbuf, image_transform: Affine, style: SPStyle | null): Promise<boolean> {
    if (this._render_mode === CairoRenderMode.RENDER_MODE_CLIP) return true;
    const c = this.#c;
    const cr = this._cr;

    await this._prepareRenderGraphic();

    const w = pb.width;
    const h = pb.height;

    // TODO: reenable merge_opacity if useful

    const image_surface = pb.surface;
    if (c.surfaceStatus(image_surface) !== CAIRO_STATUS_SUCCESS) return false;

    c.save(cr);

    // scaling by width & height is not needed because it will be done by Cairo
    this.transform(image_transform);

    c.setSourceSurface(cr, image_surface, 0.0, 0.0);

    // set clip region so that the pattern will not be repeated (bug in Cairo-PDF)
    if (this._vector_based_target) {
      c.newPath(cr);
      c.rectangle(cr, 0, 0, w, h);
      c.clip(cr);
    }

    // Cairo filter method will be mapped to PS/PDF 'interpolate' true/false).
    // See cairo-pdf-surface.c
    if (style) {
      // See: http://www.w3.org/TR/SVG/painting.html#ImageRenderingProperty
      //      https://drafts.csswg.org/css-images-3/#the-image-rendering
      //
      // CSS 3 defines:
      //   'optimizeSpeed' as alias for "pixelated"
      //   'optimizeQuality' as alias for "smooth"
      switch (style.image_rendering.computed) {
        case SPImageRendering.SP_CSS_IMAGE_RENDERING_OPTIMIZESPEED:
        case SPImageRendering.SP_CSS_IMAGE_RENDERING_PIXELATED:
        // we don't have an implementation for crisp-edges, but it should *not* smooth or blur
        case SPImageRendering.SP_CSS_IMAGE_RENDERING_CRISPEDGES:
          c.patternSetFilter(c.getSource(cr), CairoFilter.NEAREST);
          break;
        default:
          c.patternSetFilter(c.getSource(cr), CairoFilter.BEST);
          break;
      }
    }

    if (style?.mix_blend_mode.set && style.mix_blend_mode.value) {
      c.setOperator(cr, ink_css_blend_to_cairo_operator(style.mix_blend_mode.value));
    }

    c.paint(cr);

    c.restore(cr);
    return true;
  }

  _showGlyphs(cr: CairoHandle, glyphtext: readonly CairoGlyphInfo[], path: boolean): number {
    const glyphs: number[] = [];
    for (const it_info of glyphtext) {
      // skip glyphs which the font does not have (upstream PANGO_GLYPH_EMPTY and PANGO_GLYPH_UNKNOWN_FLAG)
      if (it_info.index === 0) continue;
      glyphs.push(it_info.index, it_info.x, it_info.y);
    }
    const data = Float64Array.from(glyphs);
    if (path) this.#c.glyphPath(cr, data);
    else this.#c.showGlyphs(cr, data);
    return glyphs.length / 3;
  }

  /**
   * Called by Layout-TNG-Output, this function decides how to apply styles and
   * write out the final shapes of a set of glyphs to the target.
   *
   * font - The cairo font face to use (upstream: a PangoFont).
   * font_matrix - The specific text transform to apply to these glyphs.
   * glyphtext - A list of glyphs to write or render out.
   * style - The style from the span or text node in context.
   * second_pass - True if this is being called in a second pass.
   *
   * Returns true if a second pass is required for fill over stroke paint order.
   */
  async renderGlyphtext(
    font: CairoHandle,
    font_matrix: Affine,
    glyphtext: readonly CairoGlyphInfo[],
    style: SPStyle,
    second_pass = false,
  ): Promise<boolean> {
    const c = this.#c;
    const cr = this._cr;
    this._prepareRenderText();
    if (this._is_omittext) return false;

    c.save(cr);
    c.setFontFace(cr, font);

    // set the given font matrix
    c.setFontMatrix(cr, ink_matrix_to_cairo(font_matrix));

    if (this._render_mode === CairoRenderMode.RENDER_MODE_CLIP) {
      if (this._clip_mode === CairoClipMode.CLIP_MODE_MASK) {
        c.setFillRule(
          cr,
          style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD
            ? CairoFillRule.EVEN_ODD
            : CairoFillRule.WINDING,
        );
        this._showGlyphs(cr, glyphtext, false);
      } else {
        // just add the glyph paths to the current context
        this._showGlyphs(cr, glyphtext, true);
      }
      c.restore(cr);
      return false;
    }

    if (style.mix_blend_mode.set && style.mix_blend_mode.value) {
      c.setOperator(cr, ink_css_blend_to_cairo_operator(style.mix_blend_mode.value));
    }

    const fill = style.fill.isColor() || style.fill.isPaintserver();
    const stroke = style.stroke.isColor() || style.stroke.isPaintserver();
    if (!fill && !stroke) {
      c.restore(cr);
      return false;
    }

    // Text never has markers, and no-fill doesn't matter.
    const stroke_over_fill =
      style.paint_order.get_order(SPPaintOrderLayer.SP_CSS_PAINT_ORDER_STROKE) >
        style.paint_order.get_order(SPPaintOrderLayer.SP_CSS_PAINT_ORDER_FILL) ||
      !fill ||
      !stroke;

    const fill_pass = fill && stroke_over_fill !== second_pass;
    const stroke_pass = stroke && !second_pass;

    if (fill_pass) {
      await this._setFillStyle(style, null);
      this._showGlyphs(cr, glyphtext, this._is_texttopath);
      if (this._is_texttopath) c.fillPreserve(cr);
    }

    // Stroke paths are generated for texttopath AND glyph output
    // because PDF text output doesn't support stroke and fill
    if (stroke_pass) {
      // And now we don't have a path to stroke, so make one.
      if (!this._is_texttopath || !fill_pass) {
        c.newPath(cr);
        this._showGlyphs(cr, glyphtext, true);
      }
      await this._setStrokeStyle(style, null);
      c.stroke(cr);
    }

    c.restore(cr);
    return !stroke_over_fill && !second_pass;
  }

  /* Helper functions */

  setPathVector(pv: PathVector): void {
    this.#c.newPath(this._cr);
    this.addPathVector(pv);
  }

  addPathVector(pv: PathVector): void {
    feed_pathvector_to_cairo(this._cr, pv);
  }
}

/**
 * The text of a Dublin Core entity of the document's work metadata (upstream
 * rdf_get_work_entity on rdf_find_entity(name)): dc:title, dc:creator/cc:Agent/dc:title, ...
 */
export function rdf_get_work_entity(doc: SPDocument, name: string): string | null {
  const find = (node: Node | null, test: (n: string) => boolean) => {
    for (let child = node?.firstChild() ?? null; child; child = child.next()) {
      if (child.type() === 'element' && test(child.name())) return child;
    }
    return null;
  };
  const textOf = (node: Node | null): string => {
    let s = '';
    for (let child = node?.firstChild() ?? null; child; child = child.next()) {
      s += child.type() === 'text' ? (child.content() ?? '') : textOf(child);
    }
    return s;
  };
  const metadata = find(doc.rroot, (n) => n === 'svg:metadata');
  const rdf = find(metadata, (n) => n === 'rdf:RDF');
  const work = find(rdf, (n) => n === 'cc:Work');
  const entity = find(work, (n) => n === `dc:${name}`);
  if (!entity) return null;
  // Agents (creator, rights) hold their name in cc:Agent/dc:title; bags (subject) in rdf:li.
  const agent = find(entity, (n) => n === 'cc:Agent');
  if (agent) return textOf(find(agent, (n) => n === 'dc:title')).trim() || null;
  const bag = find(entity, (n) => n === 'rdf:Bag');
  if (bag) {
    const items: string[] = [];
    for (let li = bag.firstChild(); li; li = li.next())
      if (li.type() === 'element') items.push(textOf(li).trim());
    return items.filter(Boolean).join(', ') || null;
  }
  return textOf(entity).trim() || null;
}
