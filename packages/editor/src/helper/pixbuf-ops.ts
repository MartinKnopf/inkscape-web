// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/helper/pixbuf-ops.cpp, src/helper/pixbuf-ops.h
/*
 * Helpers for SPItem -> gdk_pixbuf related stuff
 *
 * Authors:
 *   John Cliff <simarilius@yahoo.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2008 John Cliff
 */
import type { RgbaImage, SPDocument, SPItem } from '@inkscape-web/core';
import type { Rect } from '@inkscape-web/geom';
import { MAX_BITMAP_SIZE, sp_export_canvas } from './png-write.ts';

/**
 * Render the items (all items when empty) of the area (document coordinates, px) at dpi into a
 * bitmap (upstream sp_generate_internal_bitmap). The browser draws the document, so filters
 * look as on the canvas. Returns null if the bitmap would be too large.
 */
export async function sp_generate_internal_bitmap(
  doc: SPDocument,
  area: Rect,
  dpi: number,
  items: readonly SPItem[] = [],
): Promise<RgbaImage | null> {
  const width = Math.ceil((area.width() * dpi) / 96);
  const height = Math.ceil((area.height() * dpi) / 96);
  if (width < 1 || height < 1 || width > MAX_BITMAP_SIZE || height > MAX_BITMAP_SIZE) return null;
  const canvas = await sp_export_canvas(doc, area, width, height, { only: items.length ? items : null });
  return canvas.getContext('2d')?.getImageData(0, 0, width, height) ?? null;
}
