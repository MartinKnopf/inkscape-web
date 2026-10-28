// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/style/marker-combo-box.cpp, src/ui/widget/style/marker-combo-box.h, src/helper/stock-items.cpp, src/ui/widget/stroke-style.cpp
/*
 * Combobox for selecting markers: the logic behind the marker selectors of Fill and Stroke >
 * Stroke style, and the stock marker library (share/markers/markers.svg).
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Maximilian Albert <maximilian.albert@gmail.com>
 *   John Cliff <simarilius@yahoo.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2002 Lauris Kaplinski
 * Copyright 2004 John Cliff
 */
import {
  C_,
  DocumentUndo,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  SPDocument,
  SPMarker,
  SPMarkerLoc,
  SPShape,
  spReprCssAttrNew,
  spReprCssChangeRecursive,
  spReprCssSetProperty,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../../desktop.ts';

/** The marker locations of the three selectors, with their CSS property (the combo id upstream). */
export const MARKER_PROPERTIES = {
  [SPMarkerLoc.SP_MARKER_LOC_START]: 'marker-start',
  [SPMarkerLoc.SP_MARKER_LOC_MID]: 'marker-mid',
  [SPMarkerLoc.SP_MARKER_LOC_END]: 'marker-end',
} as const;

export type MarkerSelectorLoc = keyof typeof MARKER_PROPERTIES;

/** Parse the stock marker library (the text of share/markers/markers.svg). */
export function loadStockMarkers(svgText: string): SPDocument | null {
  return SPDocument.createNewDocFromMem(svgText);
}

/** The markers of the stock library, in document order. */
export function stockMarkers(stockDoc: SPDocument): SPMarker[] {
  const result: SPMarker[] = [];
  const visit = (o: { children: readonly unknown[] }) => {
    for (const c of o.children) {
      if (c instanceof SPMarker) result.push(c);
      else visit(c as { children: readonly unknown[] });
    }
  };
  visit(stockDoc.getRoot());
  return result;
}

/**
 * Copy the stock marker id from stockDoc into the defs of document (upstream get_stock_item with
 * stock = true, which always copies). The copy gets inkscape:isstock and inkscape:collect.
 * TODO: reuse the copy of the marker in defs (inkscape:stockid), recoloring of stock markers
 * (/options/markers/colorStockMarkers, sp_marker_fork_if_necessary), sp_validate_marker.
 */
export function get_stock_marker(document: SPDocument, stockDoc: SPDocument, id: string): SPMarker | null {
  const obj = stockDoc.getObjectById(id);
  const defs = document.getDefs();
  if (!(obj instanceof SPMarker) || !defs) return null;
  const repr = obj.getRepr().duplicate(document.getReprDoc());
  defs.getRepr().appendChild(repr);
  const copied = document.getObjectByRepr(repr);
  if (!(copied instanceof SPMarker)) return null;
  copied.setAttribute('inkscape:isstock', 'true');
  copied.setAttribute('inkscape:collect', 'always');
  return copied;
}

/**
 * Set the marker at loc of the selected shapes to the stock marker id, or remove it for null
 * (upstream StrokeStyle::markerSelectCB with get_active_marker_uri).
 */
export function setMarker(
  desktop: SPDesktop,
  loc: MarkerSelectorLoc,
  stockDoc: SPDocument,
  id: string | null,
): void {
  const document = desktop.getDocument();
  let marker = '';
  if (id !== null) {
    const mark = get_stock_marker(document, stockDoc, id);
    const markId = mark?.getId();
    if (!markId) return;
    marker = `url(#${markId})`;
  }

  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, MARKER_PROPERTIES[loc], marker || 'none');
  for (const item of desktop.getSelection().items()) {
    if (!(item instanceof SPShape)) continue;
    spReprCssChangeRecursive(item.getRepr(), css, 'style');
    item.requestModified(SP_OBJECT_MODIFIED_FLAG);
    item.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
    // perform update to make sure any previously referenced markers are released,
    // so they can be collected by DocumentUndo::done collect orphans
    document.ensureUpToDate();
  }
  DocumentUndo.done(document, C_('Undo', 'Set markers'), 'dialog-fill-and-stroke');
}

/**
 * The marker at loc of the first selected shape: its stock id (inkscape:stockid) or its id, or
 * null if it has none. undefined if no shape is selected.
 */
export function queryMarker(desktop: SPDesktop, loc: MarkerSelectorLoc): string | null | undefined {
  const shape = desktop
    .getSelection()
    .items()
    .find((i) => i instanceof SPShape);
  if (!(shape instanceof SPShape)) return undefined;
  const marker = shape._marker[loc];
  if (!marker) return null;
  return marker.getAttribute('inkscape:stockid') ?? marker.getId();
}
