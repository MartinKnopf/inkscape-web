// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/icon-preview.cpp, src/ui/dialog/icon-preview.h
/*
 * A panel showing the selection or the document as icons of several sizes.
 *
 * Authors:
 *   Jon A. Cruz
 *   Bob Jamison
 *   Other dudes from The Inkscape Organization
 *
 * Copyright (C) 2004 Bob Jamison
 * Copyright (C) 2005,2010 Jon A. Cruz
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { Preferences, type SPDocument, SPItem, type SPObject } from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { sp_export_canvas } from '../../helper/png-write.ts';

/** The sizes to show: the entries of /iconpreview/sizes/default that are shown, else 16, 24, 32, 48 and 128. */
export function icon_preview_sizes(): number[] {
  const prefs = Preferences.get();
  const sizes: number[] = [];
  for (const dir of prefs.getAllDirs('/iconpreview/sizes/default')) {
    if (prefs.getBool(`${dir}/show`, true)) {
      const size = prefs.getInt(`${dir}/value`, -1);
      if (size > 0) sizes.push(size);
    }
  }
  return sizes.length ? sizes : [16, 24, 32, 48, 128];
}

/** The label of a size: "16 x 16". */
export const icon_preview_label = (size: number): string => `${size} x ${size}`;

/**
 * Which object to preview (upstream refreshPreview): with selection only, the object held from the
 * last refresh if there is one (/iconpreview/selectionHold), else the last selected item that has
 * an id; without it the root of the document. Returns the object and the id to hold (empty: none).
 */
export function icon_preview_target(
  desktop: SPDesktop,
  selection_only: boolean,
  held_id: string,
): { target: SPObject | null; id: string } {
  const doc = desktop.getDocument();
  if (!selection_only) return { target: doc.getRoot(), id: '' };
  const hold = Preferences.get().getBool('/iconpreview/selectionHold', true);
  let target: SPObject | null = hold && held_id ? doc.getObjectById(held_id) : null;
  let id = target ? held_id : '';
  if (!target) {
    for (const item of desktop.getSelection().items()) {
      const item_id = item.getId();
      if (item_id) {
        id = item_id;
        target = item;
      }
    }
  }
  return { target, id };
}

/** Where a preview of the size psize is drawn (upstream sp_icon_doc_icon). */
export interface IconGeometry {
  /** The scale from the document (px) to the icon. */
  scale: number;
  /** The square of the document (px) that fills the icon. */
  area: Rect;
  /** The part of the icon (icon px) that the object covers; the rest is background. */
  visible: Rect;
}

/**
 * The scale, document area and visible part of the icon of size psize for the object with the
 * visual bounds dbox: the bounds scaled to fit, rounded outwards to whole pixels and centered.
 */
export function icon_geometry(dbox: Rect, psize: number): IconGeometry {
  const outwards = (r: Rect): Rect =>
    new Rect(
      new Point(Math.floor(r.left()), Math.floor(r.top())),
      new Point(Math.ceil(r.right()), Math.ceil(r.bottom())),
    );
  let ibox = outwards(dbox);
  let sf = 1;
  const block = Math.max(ibox.width(), ibox.height());
  if (block !== psize) {
    sf = psize / block;
    ibox = outwards(new Rect(dbox.min().mul(sf), dbox.max().mul(sf)));
  }
  const width = ibox.width();
  const height = ibox.height();
  const dx = Math.trunc((psize - width) / 2);
  const dy = Math.trunc((psize - height) / 2);
  const min = new Point(ibox.left() - dx, ibox.top() - dy);
  const area = new Rect(min, new Point(min.x + psize, min.y + psize));
  const ua = ibox.intersect(area) ?? ibox;
  return {
    scale: sf,
    area: new Rect(area.min().mul(1 / sf), area.max().mul(1 / sf)),
    visible: new Rect(ua.min().sub(min), ua.max().sub(min)),
  };
}

/**
 * Render the object into a psize x psize canvas over the background of the page: the document in
 * the box of the object, scaled to fit. Null if the object has no bounds.
 */
export async function render_icon(
  doc: SPDocument,
  target: SPObject,
  psize: number,
): Promise<HTMLCanvasElement | null> {
  if (!(target instanceof SPItem)) return null;
  doc.ensureUpToDate();
  // Find bbox in document. This is in document coordinates, i.e. pixels.
  const dbox = target.parent ? target.documentVisualBounds() : doc.preferredBounds();
  if (!dbox) return null;
  const { area, visible } = icon_geometry(dbox, psize);
  const bg = doc.getNamedView().getBackgroundColor();
  const canvas = await sp_export_canvas(doc, area, psize, psize, { background: bg });
  // Outside the box of the object only the background shows.
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, psize, psize);
    ctx.rect(visible.left(), visible.top(), visible.width(), visible.height());
    ctx.clip('evenodd');
    ctx.fillStyle = `rgba(${Math.round(bg.get(0) * 255)}, ${Math.round(bg.get(1) * 255)}, ${Math.round(bg.get(2) * 255)}, ${bg.getOpacity()})`;
    ctx.clearRect(0, 0, psize, psize);
    ctx.fillRect(0, 0, psize, psize);
    ctx.restore();
  }
  return canvas;
}
