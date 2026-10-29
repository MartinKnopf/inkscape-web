// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/export.cpp, src/ui/dialog/export.h, src/ui/dialog/export-single.cpp, src/ui/dialog/export-single.h
/*
 * Export dialog (single image): the logic of the areas, sizes and export hints.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Anshudhar Kumar Singh <anshudhar2001@gmail.com>
 *
 * Copyright (C) 1999-2007, 2021 Authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 */
import { C_, Colors, DocumentUndo, type SPDocument, type SPObject, type SPPage } from '@inkscape-web/core';
import { type OptRect, Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { type RenderOptions, sp_export_png_blob } from '../../helper/png-write.ts';

/** The dialog key of the Export dialog. */
export const EXPORT_DIALOG = 'Export';

/** Digits after the decimal point of the area coordinates. */
export const EXPORT_COORD_PRECISION = 3;
/** The dpi of one bitmap pixel per px (upstream DPI_BASE, Inkscape::Util::Quantity::convert(1, "in", "px")). */
export const DPI_BASE = 96;
/** The smallest bitmap side in pixels. */
export const SP_EXPORT_MIN_SIZE = 1.0;
/** The preference path of the area and its values (upstream selection_names). */
export const EXPORT_AREA_PREF = '/dialogs/export/exportarea/value';

/** The export areas in the order of the buttons (upstream selection_mode). */
export const EXPORT_AREAS = ['drawing', 'page', 'selection', 'custom'] as const;
export type ExportArea = (typeof EXPORT_AREAS)[number];

/** The area to export, in desktop px, and the resolution (upstream: the values of the spin buttons). */
export interface ExportGeometry {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dpi: number;
}

/** The size of the bitmap in pixels for the geometry (upstream: bmwidth and bmheight of areaXChange/areaYChange). */
export function export_bitmap_size(g: ExportGeometry): { width: number; height: number } {
  return {
    width: Math.floor(((g.x1 - g.x0) * g.dpi) / DPI_BASE + 0.5),
    height: Math.floor(((g.y1 - g.y0) * g.dpi) / DPI_BASE + 0.5),
  };
}

/**
 * Keep the sides of the area at least SP_EXPORT_MIN_SIZE pixels (upstream areaXChange and areaYChange,
 * which are the same for both axes). `changed` says which of the start, the end or the length of the
 * side was set by the user; `length` is its value then. The result has the other values consistent.
 */
function side_change(
  v0: number,
  v1: number,
  dpi: number,
  changed: 'start' | 'end' | 'length',
  length: number,
): [number, number] {
  const min = (SP_EXPORT_MIN_SIZE * DPI_BASE) / dpi;
  switch (changed) {
    case 'start':
      if (((v1 - v0) * dpi) / DPI_BASE < SP_EXPORT_MIN_SIZE) v0 = v1 - min;
      break;
    case 'end':
      if (((v1 - v0) * dpi) / DPI_BASE < SP_EXPORT_MIN_SIZE) v1 = v0 + min;
      break;
    case 'length':
      if ((length * dpi) / DPI_BASE < SP_EXPORT_MIN_SIZE) length = min;
      v1 = v0 + length;
      break;
  }
  return [v0, v1];
}

/** The geometry after the left (x0), right (x1) or width of the area was set to a new value. */
export function area_x_change(g: ExportGeometry, type: 'x0' | 'x1' | 'width', value: number): ExportGeometry {
  const changed = type === 'x0' ? 'start' : type === 'x1' ? 'end' : 'length';
  const [x0, x1] = side_change(
    type === 'x0' ? value : g.x0,
    type === 'x1' ? value : g.x1,
    g.dpi,
    changed,
    value,
  );
  return { ...g, x0, x1 };
}

/** The geometry after the top (y0), bottom (y1) or height of the area was set to a new value. */
export function area_y_change(
  g: ExportGeometry,
  type: 'y0' | 'y1' | 'height',
  value: number,
): ExportGeometry {
  const changed = type === 'y0' ? 'start' : type === 'y1' ? 'end' : 'length';
  const [y0, y1] = side_change(
    type === 'y0' ? value : g.y0,
    type === 'y1' ? value : g.y1,
    g.dpi,
    changed,
    value,
  );
  return { ...g, y0, y1 };
}

/**
 * The geometry after the dpi, the bitmap width or the bitmap height was set (upstream dpiChange).
 * The bitmap sizes follow from the area and the dpi, see export_bitmap_size().
 */
export function dpi_change(
  g: ExportGeometry,
  type: 'dpi' | 'bmwidth' | 'bmheight',
  value: number,
): ExportGeometry {
  if (type === 'dpi') return { ...g, dpi: value };
  const bm = Math.max(value, SP_EXPORT_MIN_SIZE);
  const length = type === 'bmwidth' ? g.x1 - g.x0 : g.y1 - g.y0;
  return { ...g, dpi: (bm * DPI_BASE) / length };
}

/**
 * The area to export for an area button, in desktop coordinates (upstream refreshArea). The
 * selection falls back to the drawing, and that to the page, when it is empty. The page is the
 * selected page of a multipage document. null for custom.
 */
export function export_area_bounds(desktop: SPDesktop, area: ExportArea): OptRect {
  if (area === 'custom') return null;
  const doc = desktop.getDocument();
  if (area === 'selection' && !desktop.getSelection().isEmpty()) {
    const bbox = desktop.getSelection().visualBounds();
    if (bbox) return bbox;
  }
  if (area === 'selection' || area === 'drawing') {
    const bbox = doc.getRoot().desktopVisualBounds();
    if (bbox) return bbox;
  }
  return (
    doc.getPageManager().getSelected()?.getDesktopRect() ??
    doc.preferredBounds().transformed(desktop.doc2dt())
  );
}

/**
 * The object whose export hints belong to the area (upstream onExport): the first selected
 * item, the selected page, or the root.
 */
export function export_hint_target(desktop: SPDesktop, area: ExportArea): SPObject | null {
  const doc = desktop.getDocument();
  if (area === 'selection') return desktop.getSelection().firstItem() ?? null;
  if (area === 'page') return doc.getPageManager().getSelected() ?? doc.getRoot();
  return doc.getRoot();
}

/** The export filename and dpi saved on an object (upstream SPObject::getExportFilename and getExportDpi). */
export function get_export_hints(obj: SPObject): { filename: string; dpi: number } {
  const repr = obj.getRepr();
  return {
    filename: repr.attribute('inkscape:export-filename') ?? '',
    dpi: Number.parseFloat(repr.attribute('inkscape:export-xdpi') ?? '') || 0,
  };
}

/**
 * Save the export filename and dpi on an object (upstream SPObject::setExportFilename and
 * setExportDpi). TODO: make the filename relative to the document (optimizePath).
 */
export function set_export_hints(obj: SPObject, filename: string, dpi: number): void {
  const repr = obj.getRepr();
  repr.setAttributeOrRemoveIfEmpty('inkscape:export-filename', filename);
  if (!dpi) {
    repr.removeAttribute('inkscape:export-xdpi');
    repr.removeAttribute('inkscape:export-ydpi');
  } else {
    repr.setAttributeSvgDouble('inkscape:export-xdpi', dpi);
    repr.setAttributeSvgDouble('inkscape:export-ydpi', dpi);
  }
}

/** The file name without a directory and with the extension ext: name.png for name.svg (upstream appendExtensionToFilename). */
export function with_extension(filename: string, ext: string): string {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const dot = filename.lastIndexOf('.');
  const stem = dot > slash + 1 ? filename.slice(0, dot) : filename;
  return `${stem}${ext}`;
}

/**
 * The file name suggested for an export (upstream loadExportHints and Export::defaultFilename): the
 * name saved on the target (or for a selection without one, the id of the first item), else the
 * name of the document, else "bitmap"; with the extension ext.
 */
export function export_filename(desktop: SPDesktop, area: ExportArea, ext: string): string {
  const doc = desktop.getDocument();
  const target = export_hint_target(desktop, area);
  const hint = target ? get_export_hints(target).filename : '';
  if (hint) return with_extension(hint, ext);
  if (area === 'selection') {
    const id = desktop.getSelection().firstItem()?.getId();
    if (id) return `${id}${ext}`;
  }
  const page = doc.getPageManager().getSelected();
  if (area === 'page' && page) return `${page.getLabel()}${ext}`;
  return with_extension(doc.documentFilename ?? 'bitmap', ext);
}

/** The dpi saved for the area, or 0 (upstream loadExportHints). */
export function export_hint_dpi(desktop: SPDesktop, area: ExportArea): number {
  const target = export_hint_target(desktop, area);
  return target ? get_export_hints(target).dpi : 0;
}

/** The background color of the export saved on the namedview (upstream get_export_bg_color), default transparent white. */
export function get_export_bg_color(doc: SPDocument): Colors.Color {
  return (
    Colors.Color.parse(doc.getNamedView().getAttribute('inkscape:export-bgcolor')) ??
    new Colors.Color(0xffffff00)
  );
}

/** Save the background color of the export on the namedview (upstream set_export_bg_color). */
export function set_export_bg_color(doc: SPDocument, color: Colors.Color): void {
  doc.getNamedView().setAttribute('inkscape:export-bgcolor', color.toString());
}

/**
 * Render the area in px (desktop coordinates) to a PNG with the bitmap size width x height
 * (upstream Export::exportRaster with the PNG output). selected_only hides the other objects.
 */
export function export_raster(desktop: SPDesktop, g: ExportGeometry, options: RenderOptions): Promise<Blob> {
  const area = new Rect(new Point(g.x0, g.y0), new Point(g.x1, g.y1)).transformed(desktop.dt2doc());
  const { width, height } = export_bitmap_size(g);
  return sp_export_png_blob(desktop.getDocument(), area, width, height, options);
}

/** One page to export: the page, its area in desktop px, its file name and dpi (from its hints, or the defaults). */
export interface PageExport {
  page: SPPage;
  geometry: ExportGeometry;
  filename: string;
}

/**
 * The exports of the given pages, each as its own PNG (upstream: the pages of the batch export,
 * and the multiple pages of the single export). The name and dpi come from the export hints of
 * each page, else the page label and dpi.
 */
export function page_exports(pages: readonly SPPage[], dpi: number, ext: string): PageExport[] {
  return pages.map((page) => {
    const hints = get_export_hints(page);
    const r = page.getDesktopRect();
    return {
      page,
      geometry: { x0: r.left(), y0: r.top(), x1: r.right(), y1: r.bottom(), dpi: hints.dpi || dpi },
      filename: with_extension(hints.filename || page.getLabel(), ext),
    };
  });
}

/**
 * After a successful export, save the filename and dpi on the target of the area with an undo
 * step (upstream onExport: "Set Export Options").
 */
export function save_export_hints(desktop: SPDesktop, area: ExportArea, filename: string, dpi: number): void {
  const target = export_hint_target(desktop, area);
  if (!target) return;
  set_export_hints(target, filename, dpi);
  DocumentUndo.done(desktop.getDocument(), C_('Undo', 'Set Export Options'), 'export');
}
