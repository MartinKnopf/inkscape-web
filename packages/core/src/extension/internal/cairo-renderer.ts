// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/cairo-renderer.cpp, src/extension/internal/cairo-renderer.h, src/libnrtype/Layout-TNG-Output.cpp
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
import {
  Affine,
  intersect,
  type OptRect,
  Point,
  type Rect,
  Rotate,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { SPAttr } from '../../attributes.ts';
import { ink_css_blend_to_cairo_operator } from '../../display/cairo-utils.ts';
import type { SPDocument } from '../../document.ts';
import { SPContentUnits } from '../../enums.ts';
import { PangoStretch, PangoStyle } from '../../libnrtype/font-factory.ts';
import type { FontInstance } from '../../libnrtype/font-instance.ts';
import { InputStreamTextSource, type Layout } from '../../libnrtype/Layout-TNG.ts';
import { SPClipPath } from '../../object/sp-clippath.ts';
import { SPFlowtext } from '../../object/sp-flowtext.ts';
import { SPImage } from '../../object/sp-image.ts';
import { i2anc_affine, SPItem } from '../../object/sp-item.ts';
import { SPGroup } from '../../object/sp-item-group.ts';
import { SPMarker } from '../../object/sp-marker.ts';
import type { SPMask } from '../../object/sp-mask.ts';
import type { SPPage } from '../../object/sp-page.ts';
import { SPRoot } from '../../object/sp-root.ts';
import { SPShape } from '../../object/sp-shape.ts';
import { SPSymbol } from '../../object/sp-symbol.ts';
import { SPText } from '../../object/sp-text.ts';
import { SPUse } from '../../object/sp-use.ts';
import { SP_ASPECT_MEET, SP_ASPECT_SLICE, SPAspect } from '../../object/viewbox.ts';
import type { SPStyle } from '../../style.ts';
import { SPBlendMode, SPPaintOrderLayer, SPPaintOrigin } from '../../style-enums.ts';
import { SPIPaint } from '../../style-internal.ts';
import { convertUnit } from '../../svg/svg-length.ts';
import type { RgbaImage } from '../../trace/imagemap-gdk.ts';
import { CAIRO_MIME_TYPE_JPEG, type CairoHandle, cairoBackend } from './cairo-backend.ts';
import {
  CairoClipMode,
  type CairoGlyphInfo,
  CairoPaintOrder,
  type CairoPixbuf,
  CairoRenderContext,
  CairoRenderMode,
} from './cairo-render-context.ts';

/** The font of a face for CairoRendererHooks.loadFont (CSS values). */
export interface FontDescription {
  /** CSS font-family list. */
  family: string;
  /** Numeric weight, 1 to 1000. */
  weight: number;
  style: 'normal' | 'italic' | 'oblique';
  /** CSS font-stretch keyword. */
  stretch: string;
  /** Font size in px. */
  size?: number;
  /** CSS font-variant keyword. */
  variant?: string;
}

const STRETCH_KEYWORDS = [
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'normal',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
];

/** The CSS description of the font of a face. */
function font_description(font: FontInstance): FontDescription {
  const d = font.get_descr();
  return {
    family: d.family,
    weight: d.weight,
    style:
      d.style === PangoStyle.PANGO_STYLE_ITALIC
        ? 'italic'
        : d.style === PangoStyle.PANGO_STYLE_OBLIQUE
          ? 'oblique'
          : 'normal',
    stretch: STRETCH_KEYWORDS[d.stretch] ?? STRETCH_KEYWORDS[PangoStretch.PANGO_STRETCH_NORMAL]!,
  };
}

/**
 * What the renderer needs from the platform. Upstream gets it from fontconfig, gdk-pixbuf and
 * its own rasterizer; in the browser the editor provides it. Without a hook the feature is
 * skipped (text without a font file is drawn as a bitmap when generateBitmap exists).
 */
export interface CairoRendererHooks {
  /** The font file for a font (upstream: fontconfig finds the file of the PangoFont). */
  loadFont?(font: FontDescription): Promise<{ data: Uint8Array; index?: number } | null>;
  /** The decoded pixels of an image that cairo cannot decode itself (PNG it can). */
  loadImage?(image: SPImage): Promise<RgbaImage | null>;
  /**
   * Upstream sp_generate_internal_bitmap(): the items rendered into a bitmap of the area
   * (document coordinates) at dpi, as the screen shows them (with filters).
   */
  generateBitmap?(
    doc: SPDocument,
    area: Rect,
    dpi: number,
    items: readonly SPItem[],
  ): Promise<RgbaImage | null>;
}

/** A class used for rendering via a CairoRenderContext (upstream CairoRenderer). */
export class CairoRenderer {
  readonly hooks: CairoRendererHooks;
  /** Font faces by font (upstream: CairoRenderContext::_font_table); null: no font file. */
  readonly #fonts = new Map<string | object, Promise<CairoHandle>>();
  /** Decoded images by href. */
  readonly #images = new Map<string, Promise<CairoPixbuf | null>>();

  constructor(hooks: CairoRendererHooks = {}) {
    this.hooks = hooks;
  }

  createContext(): CairoRenderContext {
    return new CairoRenderContext(this);
  }

  /** Free the fonts and images (upstream: they belong to the context and the SPImages). */
  dispose(): void {
    const c = cairoBackend();
    for (const font of this.#fonts.values()) void font.then((f) => f && c.fontFaceDestroy(f));
    for (const image of this.#images.values()) void image.then((pb) => pb && c.surfaceDestroy(pb.surface));
    this.#fonts.clear();
    this.#images.clear();
  }

  /**
   * The cairo font face of a face of the layout; 0 if there is no font file. The data of the
   * face comes from the text module, else from hooks.loadFont.
   */
  fontFace(font: FontInstance): Promise<CairoHandle> {
    const data = font.face?.fontData?.();
    const d = font_description(font);
    const key = data ? data : JSON.stringify([d.family, d.weight, d.style, d.stretch]);
    let face = this.#fonts.get(key);
    if (!face) {
      face = (async () => {
        const file = data ?? (await this.hooks.loadFont?.(d).catch(() => null));
        return file ? cairoBackend().ftFontFaceCreate(file.data, file.index ?? 0) : 0;
      })();
      this.#fonts.set(key, face);
    }
    return face;
  }

  /** The pixels of an image (upstream SPImage::pixbuf); null if they cannot be decoded. */
  pixbuf(image: SPImage): Promise<CairoPixbuf | null> {
    const pb = image.pixbuf;
    if (!pb) return Promise.resolve(null);
    let result = this.#images.get(pb.href);
    if (!result) {
      result = this.#decode(image);
      this.#images.set(pb.href, result);
    }
    return result;
  }

  async #decode(image: SPImage): Promise<CairoPixbuf | null> {
    const c = cairoBackend();
    const pb = image.pixbuf!;
    const bytes = data_uri_bytes(pb.href);
    let surface: CairoHandle = 0;
    if (bytes && pb.mime_type === 'image/png') surface = c.imageSurfaceFromPng(bytes);
    if (!surface || c.surfaceStatus(surface) !== 0) {
      if (surface) c.surfaceDestroy(surface);
      const rgba = await this.hooks.loadImage?.(image).catch(() => null);
      if (!rgba) return null;
      surface = c.imageSurfaceFromRgba(rgba.data, rgba.width, rgba.height);
    }
    // PDF and PS embed the JPEG file as it is (upstream Pixbuf keeps it as mime data).
    if (bytes && pb.mime_type === 'image/jpeg') c.surfaceSetMimeData(surface, CAIRO_MIME_TYPE_JPEG, bytes);
    return { width: c.imageSurfaceGetWidth(surface), height: c.imageSurfaceGetHeight(surface), surface };
  }

  /** A bitmap of the items (sp_generate_internal_bitmap); null without the hook. */
  async generateBitmap(
    doc: SPDocument,
    area: Rect,
    dpi: number,
    items: readonly SPItem[],
  ): Promise<CairoPixbuf | null> {
    const rgba = await this.hooks.generateBitmap?.(doc, area, dpi, items).catch(() => null);
    if (!rgba) return null;
    const surface = cairoBackend().imageSurfaceFromRgba(rgba.data, rgba.width, rgba.height);
    return { width: rgba.width, height: rgba.height, surface };
  }

  /**
   * Initializes the CairoRenderContext according to the specified SPDocument. A set*Target
   * function can only be called on the context before setupDocument.
   */
  setupDocument(ctx: CairoRenderContext, doc: SPDocument, _base: SPItem | null = null): boolean {
    // PLEASE note when making changes to the boundingbox and transform calculation, corresponding changes should be made to LaTeXTextRenderer::setupDocument !!!

    // Most pages will ignore this setup, but we still want to initialise something useful.
    const d = doc.getDimensions();
    let px_to_ctx_units = 1.0;
    if (ctx._vector_based_target) {
      // convert from px to pt
      px_to_ctx_units = convertUnit(1, 'px', 'pt');
    }

    const width = d.x * px_to_ctx_units;
    const height = d.y * px_to_ctx_units;

    ctx.setMetadata(doc);

    return ctx.setupSurface(width, height);
  }

  /** Traverses the object tree and invokes the render methods. */
  async renderItem(
    ctx: CairoRenderContext,
    item: SPItem,
    origin: SPItem | null = null,
    page: SPPage | null = null,
  ): Promise<void> {
    ctx.pushState();
    ctx.setStateForItem(item);

    const state = ctx.getCurrentState();
    ctx.setStateNeedsLayer(state.mask !== null || state.clip_path !== null || state.opacity !== 1.0);
    const style = item.style;
    let blend = false;
    if (
      item instanceof SPGroup &&
      style.mix_blend_mode.set &&
      style.mix_blend_mode.value !== SPBlendMode.SP_CSS_BLEND_NORMAL
    ) {
      // Force the creation of a new layer
      ctx.setStateNeedsLayer(true);
      blend = true;
    }
    // Draw item on a temporary surface so a mask, clip-path, or opacity can be applied to it.
    if (state.need_layer) {
      ctx.setStateMergeOpacity(false);
      ctx.pushLayer();
    }

    ctx.transform(item.transform);

    await this._doRender(item, ctx, origin, page);

    if (ctx.getCurrentState().need_layer) {
      if (blend) {
        await ctx.popLayer(ink_css_blend_to_cairo_operator(style.mix_blend_mode.value)); // This applies clipping/masking
      } else {
        await ctx.popLayer(); // This applies clipping/masking
      }
    }
    ctx.popState();
  }

  /** Handle multiple pages, pushing each out to cairo as needed using renderItem(). */
  async renderPages(ctx: CairoRenderContext, doc: SPDocument, stretch_to_fit: boolean): Promise<boolean> {
    const pages = doc.getPageManager().getPages();
    if (pages.length === 0) {
      // Output the page bounding box as already set up in the initial setupDocument.
      await this.renderItem(ctx, doc.getRoot());
      return true;
    }

    for (const page of pages) {
      ctx.pushState();
      if (!(await this.renderPage(ctx, doc, page, stretch_to_fit))) return false;
      // Create a page dest for any anchor tags that link to this page.
      const id = page.getId();
      if (id && ctx._is_pdf) {
        ctx.destBegin(id);
        ctx.destEnd();
      }

      if (!ctx.finishPage()) {
        console.warn("Couldn't render page in output!");
        return false;
      }
      ctx.popState();
    }
    return true;
  }

  async renderPage(
    ctx: CairoRenderContext,
    doc: SPDocument,
    page: SPPage,
    stretch_to_fit: boolean,
  ): Promise<boolean> {
    // Calculate exact page rectangle in PostScript points:
    const scale = Scale(doc.getDocumentScale());
    const unit_conversion = Scale(convertUnit(1, 'px', 'pt'));

    const rect = page.getBleed();
    const exact_rect = rect.transformed(scale.multiply(unit_conversion));
    const final_dims = compute_final_page_dimensions(exact_rect);
    const final_width = final_dims.x;
    const final_height = final_dims.y;

    if (stretch_to_fit) {
      // Calculate distortion from rounding (only really matters for small paper sizes):
      const distortion = Scale(final_width / exact_rect.width(), final_height / exact_rect.height());

      // Scale the drawing a tiny bit so that it still fills the rounded page:
      ctx.transform(scale.multiply(distortion));
    } else {
      ctx.transform(scale);
    }

    const root = doc.getRoot();
    ctx.transform(root.transform);
    ctx.nextPage(final_width, final_height, page.label());

    // Set up page transformation which pushes objects back into the 0,0 location
    ctx.transform(Translate(rect.corner(0)).inverse());

    for (const child of page.getOverlappingItems(false, true, false)) {
      ctx.pushState();

      // This process does not return layers, so those affines are added manually.
      for (const anc of child.ancestorList(true)) {
        if (anc instanceof SPItem && anc !== child && anc !== root) ctx.transform(anc.transform);
      }

      // Render the page into the context in the new location.
      await this.renderItem(ctx, child, null, page);
      ctx.popState();
    }
    return true;
  }

  /** Decide whether the given item should be rendered as a bitmap. */
  static _shouldRasterize(ctx: CairoRenderContext, item: SPItem): boolean {
    // rasterize filtered items as per user setting
    // however, clipPaths ignore any filters, so do *not* rasterize
    // TODO: might apply to some degree to masks with filtered elements as well;
    //       we need to figure out where in the stack it would be safe to rasterize
    if (ctx.getFilterToBitmap() && !isInClipPath(item)) {
      if (item instanceof SPUse) {
        for (let i: SPItem | null = item; i; i = i instanceof SPUse ? i.child : null) {
          if (isFiltered(i)) return true;
        }
        return false;
      }
      return isFiltered(item);
    }
    return false;
  }

  /** Render a single item in a fully set up context. */
  async _doRender(
    item: SPItem,
    ctx: CairoRenderContext,
    origin: SPItem | null = null,
    page: SPPage | null = null,
  ): Promise<void> {
    // Check item's visibility
    if (item.isHidden() || has_hidder_filter(item)) return;

    if (CairoRenderer._shouldRasterize(ctx, item)) {
      await sp_asbitmap_render(item, ctx, page);
    } else {
      await sp_item_invoke_render(item, ctx, origin, page);
    }
  }

  /** Apply an SVG clip path. */
  async applyClipPath(ctx: CairoRenderContext, cp: SPClipPath | null): Promise<void> {
    if (!cp) return;

    const saved_mode = ctx.getRenderMode();
    ctx.setRenderMode(CairoRenderMode.RENDER_MODE_CLIP);

    let saved_ctm: Affine | null = null;
    const clip_bbox = ctx.getCurrentState().item_bbox;
    if (cp.clippath_units() === SPContentUnits.SP_CONTENT_UNITS_OBJECTBOUNDINGBOX && clip_bbox) {
      let t = new Affine(clip_bbox.width(), 0, 0, clip_bbox.height(), clip_bbox.left(), clip_bbox.top());
      t = t.multiply(ctx.getCurrentState().transform);
      saved_ctm = ctx.getTransform();
      ctx.setTransform(t);
    }

    for (const child of cp.children) {
      if (child instanceof SPItem) {
        // combine transform of the item in clippath and the item using clippath:
        const tempmat = child.transform.multiply(ctx.getCurrentState().item_transform);

        // render this item in clippath
        ctx.pushState();
        ctx.transform(tempmat);
        ctx.setStateForItem(child);
        await this._doRender(child, ctx);
        ctx.popState();
      }
    }

    // do clipping only if this was the first call to applyClipPath
    if (
      ctx.getClipMode() === CairoClipMode.CLIP_MODE_PATH &&
      saved_mode === CairoRenderMode.RENDER_MODE_NORMAL
    ) {
      cairoBackend().clip(ctx._cr);
    }

    if (saved_ctm) ctx.setTransform(saved_ctm);

    ctx.setRenderMode(saved_mode);
  }

  /** Apply an SVG mask. */
  async applyMask(ctx: CairoRenderContext, mask: SPMask | null): Promise<void> {
    if (!mask) return;

    // TODO: should the bbox be transformed if maskUnits != userSpaceOnUse ?
    const mask_bbox = ctx.getCurrentState().item_bbox;
    if (mask.mask_content_units() === SPContentUnits.SP_CONTENT_UNITS_OBJECTBOUNDINGBOX && mask_bbox) {
      let t = new Affine(mask_bbox.width(), 0, 0, mask_bbox.height(), mask_bbox.left(), mask_bbox.top());
      t = t.multiply(ctx.getCurrentState().transform);
      ctx.setTransform(t);
    }

    // Clip mask contents... but...
    // The mask's bounding box is the "geometric bounding box" which doesn't allow for
    // filters which extend outside the bounding box. So don't clip.

    ctx.pushState();
    for (const child of mask.children) {
      if (child instanceof SPItem) await this.renderItem(ctx, child);
    }
    ctx.popState();
  }
}

/**
 * Compute the final page dimensions in the resulting PS or PDF.
 *
 * Cairo PS and PDF surfaces only work with integer dimensions, taking ceil() of the doubles
 * passed as arguments. To work around this limitation, we want to "lie" about page dimensions.
 *
 * -> If the page dimension is very very slightly larger than an integer (within an epsilon),
 *    we snap it to that integer. This can happen due to rounding errors in transforms.
 * -> Otherwise, we round the page dimension up to the next integer.
 */
export function compute_final_page_dimensions(page_rect: Rect): Point {
  const EPSILON = 1e-6;
  const dim = (v: number) => {
    const floor_size = Math.floor(v);
    return v > floor_size + EPSILON ? floor_size + 1.0 : floor_size;
  };
  return new Point(dim(page_rect.width()), dim(page_rect.height()));
}

/**
 * A helper class to manage the temporary rewriting of styles needed to support context-fill
 * and context-stroke values for fill and stroke paints. restore() puts the old values back.
 */
class ContextPaintManager {
  readonly #old_fill: SPIPaint | null = null;
  readonly #old_stroke: SPIPaint | null = null;

  constructor(
    readonly target_style: SPStyle,
    style_origin: SPItem,
  ) {
    const copy = (destination: SPIPaint, paint: SPIPaint): SPIPaint => {
      // Keep a copy of the old paint
      const old = new SPIPaint(SPAttr.FILL);
      old.assign(destination);
      destination.assign(paint);
      return old;
    };
    const origin = style_origin.style;
    const fill_origin = target_style.fill.paintOrigin;
    if (fill_origin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL) {
      this.#old_fill = copy(target_style.fill, origin.getFillOrStroke(true));
    } else if (fill_origin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE) {
      this.#old_fill = copy(target_style.fill, origin.getFillOrStroke(false));
    }

    const stroke_origin = target_style.stroke.paintOrigin;
    if (stroke_origin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL) {
      this.#old_stroke = copy(target_style.stroke, origin.getFillOrStroke(true));
    } else if (stroke_origin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE) {
      this.#old_stroke = copy(target_style.stroke, origin.getFillOrStroke(false));
    }
  }

  /** Restore rewritten paints (upstream destructor). */
  restore(): void {
    if (this.#old_fill) {
      this.target_style.fill.assign(this.#old_fill);
      this.#old_fill.dropHref();
    }
    if (this.#old_stroke) {
      this.target_style.stroke.assign(this.#old_stroke);
      this.#old_stroke.dropHref();
    }
  }
}

async function sp_shape_render(
  shape: SPShape,
  ctx: CairoRenderContext,
  origin: SPItem | null,
): Promise<void> {
  const pathv = shape.curve();
  if (!pathv || pathv.length === 0) return;

  const pbox = shape.geometricBounds();
  const style = shape.style;
  const context_fs_manager = origin ? new ContextPaintManager(style, origin) : null;
  try {
    const layer = style.paint_order.layer;
    const { SP_CSS_PAINT_ORDER_NORMAL: NORMAL, SP_CSS_PAINT_ORDER_FILL: FILL } = SPPaintOrderLayer;
    const { SP_CSS_PAINT_ORDER_STROKE: STROKE, SP_CSS_PAINT_ORDER_MARKER: MARKER } = SPPaintOrderLayer;

    if (layer[0] === NORMAL || (layer[0] === FILL && layer[1] === STROKE)) {
      await ctx.renderPathVector(pathv, style, pbox, CairoPaintOrder.STROKE_OVER_FILL);
    } else if (layer[0] === STROKE && layer[1] === FILL) {
      await ctx.renderPathVector(pathv, style, pbox, CairoPaintOrder.FILL_OVER_STROKE);
    } else if (layer[0] === STROKE && layer[1] === MARKER) {
      await ctx.renderPathVector(pathv, style, pbox, CairoPaintOrder.STROKE_ONLY);
    } else if (layer[0] === FILL && layer[1] === MARKER) {
      await ctx.renderPathVector(pathv, style, pbox, CairoPaintOrder.FILL_ONLY);
    }

    // Render markers
    const has_stroke = style.stroke_width.computed > 0;
    if (shape.hasMarkers() && has_stroke) {
      for (const [, marker, tr] of shape.get_markers()) {
        const marker_item = marker.children.find((c): c is SPItem => c instanceof SPItem);
        if (marker_item) {
          const old_tr = marker_item.transform;
          marker_item.transform = old_tr.multiply(marker.c2p).multiply(tr);
          // Marker's context-fill/context-stroke always refer to shape.
          try {
            await ctx.getRenderer().renderItem(ctx, marker_item, shape);
          } finally {
            marker_item.transform = old_tr;
          }
        }
      }
    }

    if (layer[1] === FILL && layer[2] === STROKE) {
      await ctx.renderPathVector(pathv, style, pbox, CairoPaintOrder.STROKE_OVER_FILL);
    } else if (layer[1] === STROKE && layer[2] === FILL) {
      await ctx.renderPathVector(pathv, style, pbox, CairoPaintOrder.FILL_OVER_STROKE);
    } else if (layer[2] === STROKE && layer[1] === MARKER) {
      await ctx.renderPathVector(pathv, style, pbox, CairoPaintOrder.STROKE_ONLY);
    } else if (layer[2] === FILL && layer[1] === MARKER) {
      await ctx.renderPathVector(pathv, style, pbox, CairoPaintOrder.FILL_ONLY);
    }
  } finally {
    context_fs_manager?.restore();
  }
}

async function sp_group_render(
  group: SPGroup,
  ctx: CairoRenderContext,
  origin: SPItem | null = null,
  page: SPPage | null = null,
): Promise<void> {
  const renderer = ctx.getRenderer();
  for (const obj of group.children) {
    if (obj instanceof SPItem) await renderer.renderItem(ctx, obj, origin, page);
  }
}

async function sp_use_render(use: SPUse, ctx: CairoRenderContext, page: SPPage | null): Promise<void> {
  let translated = false;
  const renderer = ctx.getRenderer();

  if ((use.x._set && use.x.computed !== 0) || (use.y._set && use.y.computed !== 0)) {
    // FIXME: This translation sometimes isn't in the correct units; e.g.
    // x="0" y="42" has a different effect than transform="translate(0,42)".
    ctx.pushState();
    ctx.transform(Translate(use.x.computed, use.y.computed));
    translated = true;
  }

  if (use.child) {
    // Padding in the use object as the origin here ensures markers
    // are rendered with their correct context-fill.
    await renderer.renderItem(ctx, use.child, use, page);
  }

  if (translated) ctx.popState();
}

/**
 * Upstream Layout::showGlyphs(CairoRenderContext*): the glyphs of the layout with their
 * transforms. Glyphs of one span with the same font matrix go out together. Returns false if
 * a font file is missing.
 */
async function layout_show_glyphs(layout: Layout, ctx: CairoRenderContext): Promise<boolean> {
  const renderer = ctx.getRenderer();
  interface Run {
    face: CairoHandle;
    font_matrix: Affine;
    glyphs: CairoGlyphInfo[];
    style: SPStyle;
  }
  const runs: Run[] = [];
  const glyphs = layout._glyphs;
  for (let glyph_index = 0; glyph_index < glyphs.length; ) {
    const glyph = glyphs[glyph_index]!;
    if (layout._characters[glyph.in_character]!.in_glyph === -1) {
      // invisible glyphs
      const same_character = glyph.in_character;
      while (glyph_index < glyphs.length && glyphs[glyph_index]!.in_character === same_character)
        glyph_index++;
      continue;
    }
    const span = layout._charSpan(layout._characters[glyph.in_character]!);
    const text_source = layout._input_stream[span.in_input_stream_item];
    if (!(text_source instanceof InputStreamTextSource) || !span.font) {
      glyph_index++;
      continue;
    }
    const face = await renderer.fontFace(span.font);
    if (!face) return false;
    let glyph_matrix = layout.glyphTransform(glyph);
    const font_matrix = new Affine(glyph_matrix.c0, glyph_matrix.c1, glyph_matrix.c2, glyph_matrix.c3, 0, 0);
    // try to output as many characters as possible in one go
    const this_span_index = layout._characters[glyph.in_character]!.in_span;
    const first_index = glyph_index;
    const glyphtext: CairoGlyphInfo[] = [];
    do {
      const same_character = glyphs[glyph_index]!.in_character;
      while (glyph_index < glyphs.length && glyphs[glyph_index]!.in_character === same_character) {
        if (glyph_index !== first_index) glyph_matrix = layout.glyphTransform(glyphs[glyph_index]!);
        // this is the translation for x,y-offset
        glyphtext.push({ index: glyphs[glyph_index]!.glyph, x: glyph_matrix.c4, y: glyph_matrix.c5 });
        glyph_index++;
      }
    } while (
      glyph_index < glyphs.length &&
      layout._path_fitted === null &&
      font_matrix.multiply(glyph_matrix.inverse()).withoutTranslation().isIdentity() &&
      layout._characters[glyphs[glyph_index]!.in_character]!.in_span === this_span_index
    );
    if (!span.font.face) {
      // Without the text module the layout's glyphs are the code points: map them to the font file.
      const indices = cairoBackend().ftFontFaceGlyphIndices(
        face,
        Uint32Array.from(glyphtext, (g) => g.index),
      );
      glyphtext.forEach((g, i) => {
        g.index = indices[i] ?? 0;
      });
    }
    // remove vertical flip
    runs.push({
      face,
      font_matrix: Scale(1, -1).multiply(font_matrix),
      glyphs: glyphtext,
      style: text_source.style,
    });
  }

  // The second pass is used to draw fill over stroke in a way that doesn't
  // cause some glyph chunks to be painted over others.
  let second_pass = false;
  for (let pass = 0; pass <= Number(second_pass); pass++) {
    for (const run of runs) {
      const opacity = run.style.opacity.as_double();
      if (opacity !== 1.0) {
        ctx.pushState();
        ctx.setStateForStyle(run.style);
        ctx.pushLayer();
      }
      if (run.glyphs.length > 0) {
        second_pass =
          (await ctx.renderGlyphtext(run.face, run.font_matrix, run.glyphs, run.style, pass === 1)) ||
          second_pass;
      }
      if (opacity !== 1.0) {
        await ctx.popLayer();
        ctx.popState();
      }
    }
  }
  return true;
}

async function sp_text_render(
  text: SPText | SPFlowtext,
  ctx: CairoRenderContext,
  page: SPPage | null,
): Promise<void> {
  if (await layout_show_glyphs(text.layout, ctx)) return;
  // No font file (the browser may not give access to local fonts): draw the text as a bitmap.
  if (!ctx._is_omittext && ctx.getRenderMode() === CairoRenderMode.RENDER_MODE_NORMAL) {
    await sp_asbitmap_render(text, ctx, page);
  }
}

async function sp_image_render(image: SPImage, ctx: CairoRenderContext): Promise<void> {
  if (!image.pixbuf) return;
  let width = image.width.computed;
  let height = image.height.computed;
  if (width <= 0.0 || height <= 0.0) return;

  const pb = await ctx.getRenderer().pixbuf(image);
  if (!pb) return;

  const w = pb.width;
  const h = pb.height;
  let x = image.x.computed;
  let y = image.y.computed;

  if (image.vb.aspect_align !== SPAspect.SP_ASPECT_NONE) {
    ({ x, y, width, height } = calculatePreserveAspectRatio(
      image.vb.aspect_align,
      image.vb.aspect_clip,
      w,
      h,
      x,
      y,
      width,
      height,
    ));
  }

  if (image.vb.aspect_clip === SP_ASPECT_SLICE && !ctx.getCurrentState().has_overflow) {
    ctx.addClippingRect(image.x.computed, image.y.computed, image.width.computed, image.height.computed);
  }

  const transform = Scale(width / w, height / h).multiply(Translate(x, y));
  await ctx.renderImage(pb, transform, image.style);
}

async function sp_symbol_render(
  symbol: SPSymbol,
  ctx: CairoRenderContext,
  origin: SPItem | null,
  page: SPPage | null,
): Promise<void> {
  if (!symbol.cloned) return;

  /* Cloned <symbol> is actually renderable */
  ctx.pushState();
  ctx.transform(symbol.c2p);
  await sp_group_render(symbol, ctx, origin, page);
  ctx.popState();
}

async function sp_root_render(root: SPRoot, ctx: CairoRenderContext): Promise<void> {
  if (!ctx.getCurrentState().has_overflow && root.parent) {
    ctx.addClippingRect(root.x.computed, root.y.computed, root.width.computed, root.height.computed);
  }
  ctx.pushState();
  ctx.setStateForItem(root);
  ctx.transform(root.c2p);
  await sp_group_render(root, ctx);
  ctx.popState();
}

/**
 * This function converts the item to a raster image and includes the image into the cairo
 * renderer. It is only used for filters and then only when rendering filters as bitmaps is
 * requested (and here also for text without a font file).
 */
async function sp_asbitmap_render(item: SPItem, ctx: CairoRenderContext, page: SPPage | null): Promise<void> {
  // The code was adapted from sp_selection_create_bitmap_copy in selection-chemistry.cpp

  // Calculate resolution
  let res = ctx.getBitmapResolution();
  if (res === 0) res = convertUnit(1, 'in', 'px');

  // Get the bounding box of the selection in document coordinates.
  const bbox: OptRect = intersect(
    item.documentVisualBounds(),
    page ? page.getDocumentRect() : item.document.preferredBounds(),
  );

  // no bbox, e.g. empty group or item not overlapping its page
  if (!bbox) return;

  // The width and height of the bitmap in pixels
  const width = Math.ceil(bbox.width() * convertUnit(res, 'px', 'in'));
  const height = Math.ceil(bbox.height() * convertUnit(res, 'px', 'in'));

  if (width === 0 || height === 0) return;

  // Scale to exactly fit integer bitmap inside bounding box
  const scale_x = bbox.width() / width;
  const scale_y = bbox.height() / height;

  // Location of bounding box in document coordinates.
  let shift_x = bbox.left();
  let shift_y = bbox.top();

  // For default 96 dpi, snap bitmap to pixel grid
  if (res === convertUnit(1, 'in', 'px')) {
    shift_x = Math.round(shift_x);
    shift_y = Math.round(shift_y);
  }

  // Calculate the matrix that will be applied to the image so that it exactly overlaps the source objects

  // Matrix to put bitmap in correct place on document
  const t_on_document = Scale(scale_x, scale_y).multiply(Translate(shift_x, shift_y));

  // ctx matrix already includes item transformation. We must substract.
  const t_item = i2anc_affine(item, null);
  const t = t_on_document.multiply(t_item.inverse());

  // Do the export
  const area = bbox.transformed(Affine.identity());
  const pb = await ctx.getRenderer().generateBitmap(item.document, area, res, [item]);

  if (pb) {
    await ctx.renderImage(pb, t, item.style);
    cairoBackend().surfaceDestroy(pb.surface);
  }
}

async function sp_item_invoke_render(
  item: SPItem,
  ctx: CairoRenderContext,
  origin: SPItem | null,
  page: SPPage | null,
): Promise<void> {
  // Test to see if the objects would be invisible on this page and hide them if so.
  if (page && !origin && !page.itemOnPage(item, false, false)) return;

  // TODO: SPAnchor (links and their destinations): the core has no SPAnchor yet.
  if (item instanceof SPRoot) {
    await sp_root_render(item, ctx);
  } else if (item instanceof SPSymbol) {
    await sp_symbol_render(item, ctx, origin, page);
  } else if (item instanceof SPShape) {
    await sp_shape_render(item, ctx, origin);
  } else if (item instanceof SPUse) {
    await sp_use_render(item, ctx, page);
  } else if (item instanceof SPText || item instanceof SPFlowtext) {
    await sp_text_render(item, ctx, page);
  } else if (item instanceof SPImage) {
    await sp_image_render(item, ctx);
  } else if (item instanceof SPMarker) {
    // Marker contents shouldn't be rendered, even outside of <defs>.
  } else if (item instanceof SPGroup) {
    await sp_group_render(item, ctx, origin, page);
  }
}

/** Upstream SPItem::isFiltered(). */
function isFiltered(item: SPItem): boolean {
  return item.style.getFilter() !== null;
}

/** Upstream SPItem::isInClipPath(). */
function isInClipPath(item: SPItem): boolean {
  for (let p = item.parent; p; p = p.parent) {
    if (p instanceof SPClipPath) return true;
  }
  return false;
}

/** Upstream has_hidder_filter() of filter-chemistry.cpp. */
function has_hidder_filter(item: SPItem): boolean {
  return item.style.getFilter()?.getId()?.startsWith('selectable_hidder_filter') ?? false;
}

/** The bytes of a data: URI; null for other URLs. */
function data_uri_bytes(uri: string): Uint8Array | null {
  const m = /^data:[^,]*?(;base64)?,/i.exec(uri);
  if (!m) return null;
  const data = uri.slice(m[0].length);
  try {
    if (!m[1]) return new TextEncoder().encode(decodeURIComponent(data));
    const bin = atob(data.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Upstream calculatePreserveAspectRatio(): the placed viewport (x, y, width, height). */
export function calculatePreserveAspectRatio(
  aspect_align: SPAspect,
  aspect_clip: number,
  vp_width: number,
  vp_height: number,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  if (aspect_align === SPAspect.SP_ASPECT_NONE) return { x, y, width, height };

  const scalex = width / vp_width;
  const scaley = height / vp_height;
  const scale = aspect_clip === SP_ASPECT_MEET ? Math.min(scalex, scaley) : Math.max(scalex, scaley);
  const new_width = vp_width * scale;
  const new_height = vp_height * scale;
  /* Now place viewbox to requested position */
  switch (aspect_align) {
    case SPAspect.SP_ASPECT_XMIN_YMIN:
      break;
    case SPAspect.SP_ASPECT_XMID_YMIN:
      x -= 0.5 * (new_width - width);
      break;
    case SPAspect.SP_ASPECT_XMAX_YMIN:
      x -= 1.0 * (new_width - width);
      break;
    case SPAspect.SP_ASPECT_XMIN_YMID:
      y -= 0.5 * (new_height - height);
      break;
    case SPAspect.SP_ASPECT_XMID_YMID:
      x -= 0.5 * (new_width - width);
      y -= 0.5 * (new_height - height);
      break;
    case SPAspect.SP_ASPECT_XMAX_YMID:
      x -= 1.0 * (new_width - width);
      y -= 0.5 * (new_height - height);
      break;
    case SPAspect.SP_ASPECT_XMIN_YMAX:
      y -= 1.0 * (new_height - height);
      break;
    case SPAspect.SP_ASPECT_XMID_YMAX:
      x -= 0.5 * (new_width - width);
      y -= 1.0 * (new_height - height);
      break;
    case SPAspect.SP_ASPECT_XMAX_YMAX:
      x -= 1.0 * (new_width - width);
      y -= 1.0 * (new_height - height);
      break;
    default:
      break;
  }
  return { x, y, width: new_width, height: new_height };
}
