// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/helper/png-write.cpp, src/helper/png-write.h
/*
 * PNG file format utilities
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Whoever wrote this example in libpng documentation
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { type Colors, type SPDocument, type SPObject, SVG_NS_URI, saveBuf } from '@inkscape-web/core';
import type { Rect } from '@inkscape-web/geom';
import { rgbaCss } from '../ui/widget/canvas.ts';

/** The largest side of a bitmap that canvases support. */
export const MAX_BITMAP_SIZE = 16384;

/** Elements that never draw, whatever their ids: they are not hidden by the selection filter. */
const NON_GRAPHIC = new Set(['defs', 'metadata', 'title', 'desc', 'style', 'namedview', 'script']);

export interface RenderOptions {
  /** Background color, painted under the drawing; null or fully transparent for none. */
  background?: Colors.Color | null;
  /** Only draw these objects (and their children); everything else is hidden. */
  only?: readonly SPObject[] | null;
}

/**
 * The SVG source that draws the area (document coordinates, px) of doc in a width x height
 * bitmap. The document is serialized as it is and nested in an outer svg that has the area as
 * viewBox. The rendering is done by the browser from the document, not from the display tree,
 * so Inkscape features that the browser does not know are not drawn.
 * TODO: the display tree (LPE and SVG2 conversions), fonts of text, filters in px units.
 */
export function render_svg_source(
  doc: SPDocument,
  area: Rect,
  width: number,
  height: number,
  only: readonly SPObject[] | null = null,
): string {
  const parsed = new DOMParser().parseFromString(saveBuf(doc.rdoc, SVG_NS_URI), 'image/svg+xml');
  const root = parsed.documentElement;
  const dims = doc.getDimensions();
  // The nested document keeps its viewBox and so its user units; it is placed at the origin
  // with the size of the page in px, and its content outside the page stays visible.
  root.setAttribute('x', '0');
  root.setAttribute('y', '0');
  root.setAttribute('width', String(dims.x));
  root.setAttribute('height', String(dims.y));
  root.setAttribute('overflow', 'visible');
  if (only) hide_all_except(root, new Set(only.map((o) => o.getId()).filter((id): id is string => !!id)));
  const inner = new XMLSerializer().serializeToString(root);
  const viewBox = `${area.left()} ${area.top()} ${area.width()} ${area.height()}`;
  return `<svg xmlns="${SVG_NS_URI}" width="${width}" height="${height}" viewBox="${viewBox}">${inner}</svg>`;
}

/**
 * Hide the elements that are not in ids, do not contain one and are not inside one (upstream:
 * the "Hide all except selected" option of the export dialog).
 */
function hide_all_except(root: Element, ids: ReadonlySet<string>): void {
  const visit = (el: Element, inside: boolean): boolean => {
    const keep = inside || ids.has(el.getAttribute('id') ?? '');
    let has_kept = keep;
    for (const child of [...el.children]) has_kept = visit(child, keep) || has_kept;
    if (!has_kept && el !== root && !NON_GRAPHIC.has(el.localName)) {
      el.setAttribute('style', `${el.getAttribute('style') ?? ''};display:none`);
    }
    return has_kept;
  };
  visit(root, false);
}

/**
 * Draw the area (document coordinates, px) of doc into a new width x height canvas, over the
 * background (upstream sp_export_png_file draws with the Cairo renderer to a PNG file).
 */
export async function sp_export_canvas(
  doc: SPDocument,
  area: Rect,
  width: number,
  height: number,
  options: RenderOptions = {},
): Promise<HTMLCanvasElement> {
  if (!(width >= 1 && height >= 1 && width <= MAX_BITMAP_SIZE && height <= MAX_BITMAP_SIZE)) {
    throw new RangeError(`bitmap size ${width} x ${height} is not supported`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d canvas context');
  const bg = options.background;
  if (bg && bg.getOpacity() > 0) {
    ctx.fillStyle = rgbaCss(bg.toRGBA());
    ctx.fillRect(0, 0, width, height);
  }
  const svg = render_svg_source(doc, area, width, height, options.only ?? null);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image(width, height);
    img.src = url;
    await img.decode();
    ctx.drawImage(img, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return canvas;
}

/** A PNG file of the area of doc (see sp_export_canvas()). */
export async function sp_export_png_blob(
  doc: SPDocument,
  area: Rect,
  width: number,
  height: number,
  options: RenderOptions = {},
): Promise<Blob> {
  const canvas = await sp_export_canvas(doc, area, width, height, options);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}
