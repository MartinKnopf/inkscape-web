// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/document-properties.cpp, src/ui/dialog/document-properties.h
/*
 * Document properties dialog: the operations of its page tab (page size,
 * scale, viewBox, colors, border, checkerboard, display unit). The widgets
 * are in apps/web.
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
  DocumentUndo,
  findPaperSize,
  type PaperSize,
  type SPDocument,
} from '@inkscape-web/core';
import { Rect } from '@inkscape-web/geom';

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

/** Root width and height with their units; relative sizes are given in px (upstream getWidth(), getHeight()). */
export function getPageSize(doc: SPDocument): PageSize {
  const { root } = doc;
  const unit = (len: typeof root.width) => (len.isAbsolute() ? len.getUnit().abbr : 'px');
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
 * Set the page size (upstream set_document_dimensions). The viewBox follows,
 * so the document scale stays.
 */
export function set_document_dimensions(doc: SPDocument, width: number, height: number, unit: string): void {
  if (!(width > 0) || !(height > 0)) return;
  doc.setWidthAndHeight(width, unit, height, unit, true);
  DocumentUndo.done(doc, C_('Undo', 'Set page size'));
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

/** Set the display unit (inkscape:document-units). */
export function set_display_unit(doc: SPDocument, unit: string): void {
  doc.getNamedView().setDisplayUnit(unit);
  doc.setModifiedSinceSave();
  DocumentUndo.done(doc, C_('Undo', 'Changed default display unit'));
}
