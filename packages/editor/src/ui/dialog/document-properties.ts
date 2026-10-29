// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/document-properties.cpp, src/ui/dialog/document-properties.h
/*
 * Document properties dialog: the operations of its page tab (size of the current page,
 * scale, viewBox, colors, border, checkerboard, display unit) and its grids
 * tab. The widgets are in apps/web.
 *
 * Authors:
 *   bulia byak <buliabyak@users.sf.net>
 *   Bryce W. Harrington <bryce@bryceharrington.org>
 *   Gustav Broberg <broberg@kth.se>
 *   Jon Phillips <jon@rejon.org>
 *   Ralf Stephan <ralf@ark.in-berlin.de> (Gtkmm)
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006-2008 Johan Engelen
 * Copyright (C) 2000 - 2008 Authors
 */
import {
  C_,
  type Colors,
  convertUnit,
  DocumentUndo,
  findPaperSize,
  GridType,
  type ObjectSet,
  type PaperSize,
  type SPDocument,
  SPGrid,
  type SPPage,
} from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';

/** The dialog key of the Document Properties dialog. */
export const DOCUMENT_PROPERTIES_DIALOG = 'DocumentProperties';

/** The units the page size can use (the SVG length units that are absolute). */
export const PAGE_UNITS = ['px', 'pt', 'pc', 'mm', 'cm', 'in'] as const;

/** The page size as the root element states it. */
export interface PageSize {
  width: number;
  height: number;
  unit: string;
}

/**
 * The selected page of a multipage document when it is not the viewport page: the page
 * size controls act on it. null when they act on the document size.
 */
export function current_page(doc: SPDocument): SPPage | null {
  const page = doc.getPageManager().getSelected();
  return page && !page.isViewportPage() ? page : null;
}

/**
 * The size of the current page: the root width and height with their units (relative sizes
 * are given in px, upstream getWidth(), getHeight()), or the selected page that is not the
 * viewport page, in the unit of the root width.
 */
export function getPageSize(doc: SPDocument): PageSize {
  const { root } = doc;
  const unit = (len: typeof root.width) => (len.isAbsolute() ? len.getUnit().abbr : 'px');
  const page = current_page(doc);
  if (page) {
    const rect = page.getDesktopRect();
    const u = unit(root.width);
    return {
      width: convertUnit(rect.width(), 'px', u),
      height: convertUnit(rect.height(), 'px', u),
      unit: u,
    };
  }
  const pick = (len: typeof root.width, vb: number | null) => {
    if (len.isAbsolute()) return len.value;
    return vb ?? len.computed;
  };
  const vb = root.viewBox_set ? root.viewBox : null;
  const width = pick(root.width, vb?.width() ?? null);
  const height = pick(root.height, vb?.height() ?? null);
  return { width, height, unit: unit(root.width) };
}

/** True if the page is wider than high. */
export function isLandscape(size: PageSize): boolean {
  return size.width > size.height;
}

/** The preset that matches the page size, in either orientation. */
export function matchingPaperSize(size: PageSize): PaperSize | null {
  return findPaperSize(size.width, size.height, size.unit);
}

/**
 * Set the size of the current page (upstream set_document_dimensions). Without pages, or for
 * the viewport page, this is the document size: the viewBox follows, so the document scale
 * stays, and the viewport page follows the document. Another selected page is resized; a
 * new unit then becomes the unit of the document size.
 */
export function set_document_dimensions(doc: SPDocument, width: number, height: number, unit: string): void {
  if (!(width > 0) || !(height > 0)) return;
  const page = current_page(doc);
  if (page) {
    const old = getPageSize(doc);
    if (old.unit !== unit) {
      const dims = doc.getDimensions();
      doc.setWidthAndHeight(
        convertUnit(dims.x, 'px', unit),
        unit,
        convertUnit(dims.y, 'px', unit),
        unit,
        true,
      );
    }
    doc.getPageManager().resizePage(page, convertUnit(width, unit, 'px'), convertUnit(height, unit, 'px'));
  } else {
    doc.setWidthAndHeight(width, unit, height, unit, true);
    doc.getNamedView().updateViewPort();
  }
  DocumentUndo.done(doc, C_('Undo', 'Set page size'));
}

/**
 * Fit the first page to the selection, or to the content without one (upstream
 * signal_resize_to_fit of the page properties).
 */
export function resize_to_fit(doc: SPDocument, selection: ObjectSet): void {
  const page_manager = doc.getPageManager();
  page_manager.selectPageIndex(0);
  // fit page to selection or content, if there's no selection
  page_manager.fitToSelection(selection);
  DocumentUndo.done(doc, C_('Undo', 'Resize page to fit'), 'tool-pages');
}

/** Choose a preset, keeping the current orientation and unit (the unit of the preset). */
export function set_paper_size(doc: SPDocument, paper: PaperSize, landscape: boolean): void {
  const [small, large] =
    paper.width < paper.height ? [paper.width, paper.height] : [paper.height, paper.width];
  set_document_dimensions(doc, landscape ? large : small, landscape ? small : large, paper.unit);
}

/** Swap width and height. */
export function set_orientation(doc: SPDocument, landscape: boolean): void {
  const size = getPageSize(doc);
  if (isLandscape(size) === landscape || size.width === size.height) return;
  set_document_dimensions(doc, size.height, size.width, size.unit);
}

export function set_viewbox_pos(doc: SPDocument, x: number, y: number): void {
  const box = doc.getViewBox();
  doc.setViewBox(Rect.fromXywh(x, y, box.width(), box.height()));
  DocumentUndo.done(doc, C_('Undo', 'Set viewbox position'));
}

export function set_viewbox_size(doc: SPDocument, width: number, height: number): void {
  if (!(width > 0) || !(height > 0)) return;
  const box = doc.getViewBox();
  doc.setViewBox(Rect.fromXywh(box.left(), box.top(), width, height));
  DocumentUndo.done(doc, C_('Undo', 'Set viewbox size'));
}

/**
 * The document scale as a ratio of document size and viewBox size, or null if there is none
 * (see upstream get_document_scale_helper). 1 for width="100mm" viewBox="0 0 100 100".
 */
export function get_document_scale(doc: SPDocument): { x: number; y: number } | null {
  const { root } = doc;
  if (!root.width._set || !root.height._set || !root.width.isAbsolute() || !root.height.isAbsolute()) {
    return null;
  }
  if (root.viewBox_set) {
    const vw = root.viewBox.width();
    const vh = root.viewBox.height();
    return vw > 0 && vh > 0 ? { x: root.width.value / vw, y: root.height.value / vh } : null;
  }
  const w = root.width.computed;
  const h = root.height.computed;
  return w > 0 && h > 0 ? { x: root.width.value / w, y: root.height.value / h } : null;
}

/** Set the document scale: the viewBox gets the size of the root divided by scale (upstream set_document_scale). */
export function set_document_scale(doc: SPDocument, scale: number): void {
  if (!(scale > 0)) return;
  const { root } = doc;
  const box = doc.getViewBox();
  doc.setViewBox(Rect.fromXywh(box.left(), box.top(), root.width.value / scale, root.height.value / scale));
  DocumentUndo.done(doc, C_('Undo', 'Set page scale'));
}

// Colors and flags in the namedview. Colors merge their undo steps by key (upstream maybeDone).

export function set_desk_color(doc: SPDocument, color: Colors.Color): void {
  doc.getNamedView().setDeskColor(color);
  doc.setModifiedSinceSave();
  DocumentUndo.maybeDone(doc, 'document-color-desk', C_('Undo', 'Desk color'));
}

export function set_background_color(doc: SPDocument, color: Colors.Color): void {
  doc.getNamedView().setPageColor(color);
  doc.setModifiedSinceSave();
  DocumentUndo.maybeDone(doc, 'document-color-background', C_('Undo', 'Background color'));
}

export function set_border_color(doc: SPDocument, color: Colors.Color): void {
  doc.getNamedView().setBorderColor(color);
  doc.setModifiedSinceSave();
  DocumentUndo.maybeDone(doc, 'document-color-border', C_('Undo', 'Border color'));
}

export function set_checkerboard(doc: SPDocument, on: boolean): void {
  doc.getNamedView().setCheckerboard(on);
  doc.setModifiedSinceSave();
  DocumentUndo.done(doc, C_('Undo', 'Toggle checkerboard'));
}

export function set_show_border(doc: SPDocument, on: boolean): void {
  doc.getNamedView().setShowBorder(on);
  doc.setModifiedSinceSave();
  DocumentUndo.done(doc, C_('Undo', 'Toggle page border'));
}

export function set_show_shadow(doc: SPDocument, on: boolean): void {
  doc.getNamedView().getRepr().setAttributeBoolean('inkscape:showpageshadow', on);
  doc.setModifiedSinceSave();
  DocumentUndo.done(doc, C_('Undo', 'Toggle page shadow'));
}

/** Show the big page labels below the pages (labelstyle). */
export function set_label_style(doc: SPDocument, below: boolean): void {
  doc.getNamedView().setLabelStyleBelow(below);
  doc.setModifiedSinceSave();
  DocumentUndo.done(doc, C_('Undo', 'Toggle page label style'));
}

/** Set the display unit (inkscape:document-units). */
export function set_display_unit(doc: SPDocument, unit: string): void {
  doc.getNamedView().setDisplayUnit(unit);
  doc.setModifiedSinceSave();
  DocumentUndo.done(doc, C_('Undo', 'Changed default display unit'));
}

// Grids tab. Origin and spacing are shown in the unit of the grid; the grid
// stores them in user units.

/** Add a grid to the namedview (upstream onNewGrid). TODO: axonometric and modular grids in the UI. */
export function grid_new(doc: SPDocument, type = GridType.RECTANGULAR): SPGrid | null {
  const grid = SPGrid.create_new(doc, doc.getNamedView().getRepr(), type);
  DocumentUndo.done(doc, C_('Undo', 'Create new grid'), 'document-properties');
  return grid;
}

export function grid_remove(grid: SPGrid): void {
  const doc = grid.document;
  grid.deleteObject();
  DocumentUndo.done(doc, C_('Undo', 'Remove grid'), 'document-properties');
}

/** A value in the unit of grid, in user units of the document along dim. */
function toUser(grid: SPGrid, v: number, dim: 'x' | 'y'): number {
  return convertUnit(v, grid.getUnit(), 'px') / grid.document.getDocumentScale()[dim];
}
/** A value in user units, in the unit of grid. */
function fromUser(grid: SPGrid, v: number, dim: 'x' | 'y'): number {
  return convertUnit(v * grid.document.getDocumentScale()[dim], 'px', grid.getUnit());
}

/** The origin in the unit of the grid. */
export function grid_get_origin(grid: SPGrid): Point {
  const o = grid.getOrigin();
  return new Point(fromUser(grid, o.x, 'x'), fromUser(grid, o.y, 'y'));
}
/** The spacing in the unit of the grid. */
export function grid_get_spacing(grid: SPGrid): Point {
  const s = grid.getSpacing();
  return new Point(fromUser(grid, s.x, 'x'), fromUser(grid, s.y, 'y'));
}

/** Set the origin, in the unit of the grid. */
export function grid_set_origin(grid: SPGrid, origin: Point): void {
  grid.setOrigin(new Point(toUser(grid, origin.x, 'x'), toUser(grid, origin.y, 'y')));
  DocumentUndo.done(grid.document, C_('Undo', 'Change grid dimensions'), 'show-grid');
}

/** Set the spacing, in the unit of the grid. */
export function grid_set_spacing(grid: SPGrid, spacing: Point): void {
  if (!(spacing.x > 0 && spacing.y > 0)) return;
  grid.setSpacing(new Point(toUser(grid, spacing.x, 'x'), toUser(grid, spacing.y, 'y')));
  DocumentUndo.done(grid.document, C_('Undo', 'Change grid dimensions'), 'show-grid');
}

/** Set the unit of the grid; origin and spacing keep their size. */
export function grid_set_unit(grid: SPGrid, unit: string): void {
  grid.setUnit(unit);
  DocumentUndo.done(grid.document, C_('Undo', 'Change grid units'), 'show-grid');
}

/** Set the color of the minor or the major lines; the steps of a drag merge. */
export function grid_set_color(grid: SPGrid, color: Colors.Color, major: boolean): void {
  if (major) grid.setMajorColor(color);
  else grid.setMinorColor(color);
  DocumentUndo.maybeDone(grid.document, 'grid-color', C_('Undo', 'Change grid color'), 'show-grid');
}

/** Show a major line every interval lines. */
export function grid_set_major_line_interval(grid: SPGrid, interval: number): void {
  if (!(interval >= 1)) return;
  grid.setMajorLineInterval(interval);
  DocumentUndo.done(grid.document, C_('Undo', 'Change grid number of lines'), 'show-grid');
}

/** Set a flag of the grid: enabled, visible, dotted or snap to visible lines only. */
export function grid_set_flag(
  grid: SPGrid,
  flag: 'enabled' | 'visible' | 'dotted' | 'snapvisiblegridlinesonly',
  on: boolean,
): void {
  grid.getRepr().setAttributeBoolean(flag, on);
  DocumentUndo.done(grid.document, '', 'show-grid');
}
