// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/print.cpp, src/print.h, src/libnrtype/Layout-TNG-Output.cpp Layout::print
/*
 * Frontend to printing
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Kees Cook <kees@outflux.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * This code is in public domain
 *
 * The walk over the items is upstream SPItem::invoke_print() with the print() methods of
 * SPRoot, SPGroup, SPShape, SPUse, SPSymbol, SPImage, SPText and SPFlowtext (src/object/).
 */
import {
  Direction,
  InputStreamTextSource,
  type Layout,
  SP_SCALE24_MAX,
  SPAttr,
  type SPDocument,
  SPFlowtext,
  SPGroup,
  SPImage,
  SPIPaint,
  SPItem,
  type SPObject,
  SPPaintOrigin,
  SPRoot,
  SPShape,
  type SPStyle,
  SPSymbol,
  SPText,
  SPUse,
} from '@inkscape-web/core';
import {
  type Affine,
  type OptRect,
  type PathVector,
  Point,
  Rect,
  Rotate,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import type { Print } from './extension/print.ts';

/** RGBA pixels of an image. */
export interface PrintImagePixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** The state of a print (upstream SPPrintContext). */
export class SPPrintContext {
  /** The item whose style the context-fill and context-stroke of markers refer to. */
  context_item: SPItem | null = null;
  /**
   * The Unicode to non-Unicode font translation of the text (upstream CanUTN() and
   * SingleUnicodeToNon() of util-string/symbol-convert, which the EMF and WMF prints set up).
   */
  canUTN: () => boolean = () => false;
  singleUnicodeToNon: (c: number) => number = () => 0;

  /**
   * images: the decoded pixels of the images of the document (upstream: SPImage::pixbuf);
   * the browser decodes images asynchronously, so they are decoded before the print starts.
   */
  constructor(
    readonly module: Print,
    readonly images: ReadonlyMap<SPImage, PrintImagePixels> = new Map(),
  ) {}

  bind(transform: Affine, opacity: number): number {
    return this.module.bind(transform, opacity);
  }
  release(): number {
    return this.module.release();
  }
  fill(pathv: PathVector, ctm: Affine, style: SPStyle, pbox: OptRect, dbox: OptRect, bbox: OptRect): number {
    return this.module.fill(pathv, ctm, style, pbox, dbox, bbox);
  }
  stroke(
    pathv: PathVector,
    ctm: Affine,
    style: SPStyle,
    pbox: OptRect,
    dbox: OptRect,
    bbox: OptRect,
  ): number {
    return this.module.stroke(pathv, ctm, style, pbox, dbox, bbox);
  }
  image_R8G8B8A8_N(
    px: Uint8Array,
    w: number,
    h: number,
    rs: number,
    transform: Affine,
    style: SPStyle,
  ): number {
    return this.module.image(px, w, h, rs, transform, style);
  }
  text(text: string, p: Point, style: SPStyle): number {
    return this.module.text(text, p, style);
  }
}

/**
 * Decode the images of the document for the print (load: the decoder of the app). The print
 * itself is synchronous.
 */
export async function load_print_images(
  doc: SPDocument,
  load: ((image: SPImage) => Promise<PrintImagePixels | null>) | undefined,
): Promise<Map<SPImage, PrintImagePixels>> {
  const images = new Map<SPImage, PrintImagePixels>();
  if (!load) return images;
  const found: SPImage[] = [];
  const walk = (o: SPObject) => {
    if (o instanceof SPImage && o.pixbuf) found.push(o);
    for (const c of o.children) walk(c);
  };
  walk(doc.getRoot());
  await Promise.all(
    found.map(async (image) => {
      const pixels = await load(image).catch(() => null);
      if (pixels) images.set(image, pixels);
    }),
  );
  return images;
}

/** Print the item if it is visible, with its transform and opacity (upstream SPItem::invoke_print). */
export function invoke_print(item: SPItem, ctx: SPPrintContext): void {
  if (item.isHidden()) return;
  if (!item.transform.isIdentity() || item.style.opacity.value !== SP_SCALE24_MAX) {
    ctx.bind(item.transform, item.style.opacity.as_double());
    print_item(item, ctx);
    ctx.release();
  } else {
    print_item(item, ctx);
  }
}

/** The print() method of the item type. */
function print_item(item: SPItem, ctx: SPPrintContext): void {
  if (item instanceof SPRoot) {
    ctx.bind(item.c2p, 1.0);
    print_group(item, ctx);
    ctx.release();
  } else if (item instanceof SPSymbol) {
    if (item.cloned) {
      // Cloned <symbol> is actually renderable
      ctx.bind(item.vb.c2p, 1.0);
      print_group(item, ctx);
      ctx.release();
    }
  } else if (item instanceof SPGroup) {
    print_group(item, ctx);
  } else if (item instanceof SPShape) {
    print_shape(item, ctx);
  } else if (item instanceof SPUse) {
    if (item.has_xy_offset()) ctx.bind(Translate(item.x.computed, item.y.computed), 1.0);
    if (item.child) invoke_print(item.child, ctx);
    if (item.has_xy_offset()) ctx.release();
  } else if (item instanceof SPImage) {
    print_image(item, ctx);
  } else if (item instanceof SPText || item instanceof SPFlowtext) {
    const pbox = item.geometricBounds();
    const bbox = item.desktopVisualBounds();
    const dbox = new Rect(new Point(0, 0), item.document.getDimensions());
    const ctm = item.i2dtAffine();
    layout_print(item.layout, ctx, pbox, dbox, bbox, ctm);
  }
}

/** Upstream SPGroup::print. */
function print_group(group: SPGroup, ctx: SPPrintContext): void {
  for (const child of group.children) {
    if (child instanceof SPItem) invoke_print(child, ctx);
  }
}

/** Use the paint of the context item for context-fill and context-stroke; returns the restore function. */
function apply_context_paint(style: SPStyle, context_item: SPItem): () => void {
  const restore: (() => void)[] = [];
  const set = (destination: SPIPaint, paint: SPIPaint) => {
    const old = new SPIPaint(SPAttr.FILL);
    old.assign(destination);
    destination.assign(paint);
    restore.push(() => destination.assign(old));
  };
  const origin = context_item.style;
  if (style.fill.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE)
    set(style.fill, origin.stroke);
  else if (style.fill.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL)
    set(style.fill, origin.fill);
  if (style.stroke.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_STROKE)
    set(style.stroke, origin.stroke);
  else if (style.stroke.paintOrigin === SPPaintOrigin.SP_CSS_PAINT_ORIGIN_CONTEXT_FILL)
    set(style.stroke, origin.fill);
  return () => {
    for (const r of restore.reverse()) r();
  };
}

/** Upstream SPShape::print. */
function print_shape(shape: SPShape, ctx: SPPrintContext): void {
  const pathv = shape.curve();
  if (!pathv?.length) return;

  /* fixme: Think (Lauris) */
  const pbox = shape.geometricBounds();
  const bbox = shape.desktopVisualBounds();
  const dbox = new Rect(new Point(0, 0), shape.document.getDimensions());

  const i2dt = shape.i2dtAffine();

  // Upstream copies the style for the context paint; here the paints are set and restored.
  const style = shape.style;
  const restore = ctx.context_item ? apply_context_paint(style, ctx.context_item) : null;
  try {
    if (!style.fill.isNone()) ctx.fill(pathv, i2dt, style, pbox, dbox, bbox);
    if (!style.stroke.isNone()) ctx.stroke(pathv, i2dt, style, pbox, dbox, bbox);
  } finally {
    restore?.();
  }

  for (const [, marker, tr] of shape.get_markers()) {
    const marker_item = marker.children.find((c): c is SPItem => c instanceof SPItem);
    if (marker_item) {
      const old_tr = marker_item.transform;
      marker_item.transform = old_tr.multiply(marker.c2p).multiply(tr);
      // Marker's context-fill/context-stroke refer to the shape.
      ctx.context_item = shape;
      try {
        invoke_print(marker_item, ctx);
      } finally {
        marker_item.transform = old_tr;
      }
    }
  }

  // Clear any context item used in the above markers.
  ctx.context_item = null;
}

/** Upstream SPImage::print. */
function print_image(image: SPImage, ctx: SPPrintContext): void {
  const pb = ctx.images.get(image);
  if (pb && image.width.computed > 0.0 && image.height.computed > 0.0) {
    const px = pb.data instanceof Uint8Array ? pb.data : new Uint8Array(pb.data.buffer);
    const w = pb.width;
    const h = pb.height;
    const rs = w * 4;

    // The size of the decoded image may differ from the size of the pixbuf.
    const sx = (image.sx * (image.pixbuf?.width() ?? w)) / w;
    const sy = (image.sy * (image.pixbuf?.height() ?? h)) / h;
    const t = Scale(sx, sy).multiply(Translate(image.ox, image.oy));
    ctx.image_R8G8B8A8_N(px, w, h, rs, t, image.style);
  }
}

/** One width or float in the smuggled text: 7 characters (sprintf " %6f", cut at 7). */
function smuggle_float(v: number): string {
  return ` ${v.toFixed(6)}`.slice(0, 7).padEnd(7, '0');
}

/**
 * The text with the character widths, the y kern and the direction for the EMF driver
 * (ignored by others): text<nul>ndx w1 w2 ...wn<nul> ky rtl<nul><nul> (upstream
 * smuggle_adxkyrtl_in).
 */
export function smuggle_adxkyrtl_in(string: string, adx: readonly number[], ky: number, rtl: number): string {
  let s = `${string}\0${String(adx.length).padStart(7, '0')}`;
  for (const w of adx) s += smuggle_float(w);
  s += '\0';
  s += smuggle_float(ky);
  s += ` ${String(Math.trunc(rtl)).padStart(6, ' ')}`.slice(0, 7);
  return `${s}\0\0`;
}

/**
 * Print the text of a layout (upstream Layout::print): as glyph outlines when the print
 * module wants text as paths, else as strings with the character widths.
 */
export function layout_print(
  layout: Layout,
  ctx: SPPrintContext,
  pbox: OptRect,
  dbox: OptRect,
  bbox: OptRect,
  ctm: Affine,
): void {
  const canUTN = () => ctx.canUTN();
  const singleUnicodeToNon = (c: number) => ctx.singleUnicodeToNon(c);
  const text_to_path = ctx.module.textToPath();
  const MAX_DX = 2048;

  if (!layout._input_stream.length) return;
  if (!layout._glyphs.length) return; // yes, this can happen.
  if (text_to_path || layout._path_fitted) {
    for (const glyph of layout._glyphs) {
      if (layout._characters[glyph.in_character]!.in_glyph === -1) continue; //invisible glyphs
      const span = layout._charSpan(layout._characters[glyph.in_character]!);
      const pv = span.font?.PathVector(glyph.glyph);
      const text_source = layout._input_stream[span.in_input_stream_item];
      if (pv && text_source instanceof InputStreamTextSource) {
        const glyph_matrix = layout.glyphTransform(glyph);
        const temp_pv = pv.map((p) => p.transformed(glyph_matrix));
        if (!text_source.style.fill.isNone()) ctx.fill(temp_pv, ctm, text_source.style, pbox, dbox, bbox);
        if (!text_source.style.stroke.isNone()) ctx.stroke(temp_pv, ctm, text_source.style, pbox, dbox, bbox);
      }
    }
    return;
  }

  /* index by characters, referencing glyphs and spans only as needed  */
  const doUTN = canUTN(); // Unicode to Nonunicode translation enabled if true
  const block_progression = layout._blockProgression();
  let oldtarget = 0;
  let hold_dx: number[] = [];
  let rtl = 1.0; // 1 L->R, -1 R->L, constant across a span. 1.0 for t->b b->t???

  for (let char_index = 0; char_index < layout._characters.length; ) {
    let text_string = ''; // accumulate text for record in this
    const g_pos = new Point(0, 0); // all strings are output at (0,0) because we do the translation using the matrix
    let glyph_index = layout._characters[char_index]!.in_glyph;
    if (glyph_index === -1) {
      // if the character maps to an invisible glyph we cannot know its geometry, so skip it and move on
      char_index++;
      continue;
    }
    const ky = layout._glyphs[glyph_index]!.y; // For smuggling y kern value for span // same value for all positions in a span
    let span_index = layout._characters[char_index]!.in_span;
    const span = layout._spans[span_index]!;
    let char_x = 0.0;
    const text_source = layout._input_stream[span.in_input_stream_item];
    if (!(text_source instanceof InputStreamTextSource)) {
      char_index++;
      continue;
    }
    // the code points of the span, from the first character of the span on
    let text_iter = span.input_stream_first_character + (char_index - first_char_of_span(layout, span_index));
    const glyph = layout._glyphs[glyph_index]!;
    const chunk = layout._chunks[span.in_chunk]!;
    const line = layout._spanLine(span);
    const m = Scale(1.0, -1.0).multiply(Rotate(glyph.rotation));
    const char_xpos = chunk.left_x + span.x_start + layout._characters[glyph.in_character]!.x;
    let glyph_matrix: Affine;
    if (block_progression === Direction.LEFT_TO_RIGHT || block_progression === Direction.RIGHT_TO_LEFT) {
      // since we're outputting character codes, not glyphs, we want the character x
      glyph_matrix = m.withTranslation(new Point(line.baseline_y + span.baseline_shift, char_xpos));
    } else {
      glyph_matrix = m.withTranslation(new Point(char_xpos, line.baseline_y + span.baseline_shift));
    }
    switch (span.direction) {
      case Direction.TOP_TO_BOTTOM:
      case Direction.BOTTOM_TO_TOP:
      case Direction.LEFT_TO_RIGHT:
        rtl = 1.0;
        break;
      case Direction.RIGHT_TO_LEFT:
        rtl = -1.0;
        break;
    }
    if (doUTN) oldtarget = singleUnicodeToNon(text_source.chars[text_iter] ?? 0); // this should only ever be with a 1:1 glyph:character situation

    // accumulate a record to write
    let lc_index = char_index;
    const hold_iisi = layout._spans[span_index]!.in_input_stream_item;
    let newtarget = 0;
    for (;;) {
      glyph_index = layout._characters[lc_index]!.in_glyph;
      if (glyph_index === -1) {
        // end of a line within a paragraph, for instance
        lc_index++;
        break;
      }

      // always append if here
      text_string += String.fromCodePoint(text_source.chars[text_iter] ?? 0xfffd);

      // figure out char widths, used by EMF, not currently used elsewhere
      let cwidth: number;
      if (lc_index === layout._glyphs[glyph_index]!.in_character) {
        // Glyph width is used only for the first character, these may be 0
        cwidth = rtl * layout._glyphs[glyph_index]!.advance; // advance might be zero
      } else {
        cwidth = 0;
      }
      char_x += cwidth;
      if (hold_dx.length < MAX_DX) {
        hold_dx.push(Math.abs(cwidth));
      } else {
        // silently truncate any text line silly enough to be longer than MAX_DX
        lc_index = layout._characters.length;
        break;
      }

      // conditions that prevent this character from joining the record
      lc_index++;
      if (lc_index >= layout._characters.length) break; // nothing more to process, so it must be the end of the record
      text_iter++;
      if (doUTN) newtarget = singleUnicodeToNon(text_source.chars[text_iter] ?? 0); // this should only ever be with a 1:1 glyph:character situation
      if (newtarget !== oldtarget) break; // change in unicode to nonunicode translation status
      // MUST exit on any major span change, but not on some little events, like a font substitution event irrelevant for the file save
      const next_span_index = layout._characters[lc_index]!.in_span;
      if (span_index !== next_span_index) {
        /* on major changes break out of loop.
           1st case usually indicates an entire input line has been processed (out of several in a paragraph)
           2nd case usually indicates that a format change within a line (font/size/color/etc) is present.
        */
        if (hold_iisi !== layout._spans[next_span_index]!.in_input_stream_item) break; // major change, font, size, color, etc, must exit
        if (Math.abs(char_x - layout._spans[next_span_index]!.x_start) >= 1e-4) break; // xkerning change
        if (ky !== layout._glyphs[layout._characters[lc_index]!.in_glyph]?.y) break; // ykerning change
        /*
           None of the above?  Then this is a minor "pangito", update span_index and keep going.
           The font used by the display may have failed over, but print does not care and can continue to use
           whatever was specified in the XML.
        */
        span_index = next_span_index;
        text_iter = layout._spans[span_index]!.input_stream_first_character;
      }
    }
    // write it
    ctx.bind(glyph_matrix, 1.0);

    // the dx array is smuggled through to the EMF driver (ignored by others) as:
    //    text<nul>w1 w2 w3 ...wn<nul><nul>
    // where the widths are floats 7 characters wide, including the space
    const smuggle_string = smuggle_adxkyrtl_in(text_string, hold_dx, ky, rtl);
    ctx.text(smuggle_string, g_pos, text_source.style);
    ctx.release();
    hold_dx = [];
    char_index = lc_index;
  }
}

/** The index of the first character of the span (the characters of a span are consecutive). */
function first_char_of_span(layout: Layout, span_index: number): number {
  return layout._characters.findIndex((c) => c.in_span === span_index);
}
