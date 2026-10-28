// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/swatches.cpp, src/ui/dialog/swatches.h, src/ui/dialog/color-item.cpp, src/ui/dialog/color-item.h
/*
 * Authors:
 *   Jon A. Cruz
 *   John Bintz
 *   Abhishek Sharma
 *   PBS <pbs3141@gmail.com>
 *
 * Copyright (C) 2005 Jon A. Cruz
 * Copyright (C) 2008 John Bintz
 * Copyright (C) 2022 PBS
 */
import {
  C_,
  Colors,
  DocumentUndo,
  Preferences,
  type SPDocument,
  SPGradient,
  type SPObject,
  SPStyle,
  spReprCssAttrNew,
  spReprCssSetProperty,
  spReprCssSetPropertyString,
} from '@inkscape-web/core';
import type { SPDesktop } from '../../desktop.ts';
import {
  QueryStyleProperty,
  QueryStyleResult,
  sp_desktop_query_style,
  sp_desktop_set_style,
} from '../../desktop-style.ts';
import type { PaletteFileData } from './global-palettes.ts';

/** The id of the palette of the gradient swatches of the document (upstream auto_id). */
export const AUTO_PALETTE_ID = 'Auto';

/** The preference path of the palette bar of the window. */
export const EMBEDDED_SWATCHES_PATH = '/embedded/swatches';
/** The preference path of the Swatches dialog. */
export const DIALOG_SWATCHES_PATH = '/dialogs/swatches';

/** What a swatch sets: no paint, a color, or a gradient swatch of the document (upstream ColorItem data). */
export type ColorItemData =
  | { kind: 'none' }
  | { kind: 'color'; color: Colors.Color }
  | { kind: 'gradient'; gradient: SPGradient };

/** A swatch of the palette. The group and spacer entries of a palette are not swatches. */
export interface ColorItem {
  /** The id for the pinned preference and for the lookup (upstream color_id). */
  id: string;
  /** The name, which is the tooltip. */
  description: string;
  data: ColorItemData;
}

/** The swatch for "no paint" (upstream ColorItem(DialogBase*)). */
export function noneColorItem(): ColorItem {
  return { id: 'none', description: C_('Paint', 'None'), data: { kind: 'none' } };
}

export function colorItemOfColor(color: Colors.Color): ColorItem {
  return { id: Colors.color_to_id(color), description: color.getName(), data: { kind: 'color', color } };
}

export function colorItemOfGradient(gradient: SPGradient): ColorItem {
  return {
    id: gradient.getId() ?? '',
    description: gradient.label() ?? gradient.getId() ?? '',
    data: { kind: 'gradient', gradient },
  };
}

/** The gradients of doc that are swatches (upstream: the "Auto" palette). */
export function documentSwatches(doc: SPDocument): SPGradient[] {
  const found: SPGradient[] = [];
  const walk = (o: SPObject) => {
    if (o instanceof SPGradient && o.isSwatch()) found.push(o);
    for (const c of o.children) walk(c);
  };
  walk(doc.getRoot());
  return found;
}

/**
 * The swatches of a palette: "none" first, then its colors (upstream
 * SwatchesPanel::rebuild). Groups and spacers are returned with kind
 * 'group' and 'spacer' for the layout.
 */
export type PaletteCell = { key: string } & (
  | { kind: 'swatch'; item: ColorItem }
  | { kind: 'group'; name: string }
  | { kind: 'spacer' }
);

export function paletteCells(palette: PaletteFileData | null, doc: SPDocument | null): PaletteCell[] {
  const cells: PaletteCell[] = [{ key: 'none', kind: 'swatch', item: noneColorItem() }];
  if (palette) {
    palette.colors.forEach((entry, i) => {
      // The key is unique in the palette: colors can repeat.
      if (entry.kind === 'color')
        cells.push({ key: `c${i}`, kind: 'swatch', item: colorItemOfColor(entry.color) });
      else if (entry.kind === 'group') cells.push({ key: `g${i}`, kind: 'group', name: entry.name });
      else cells.push({ key: `s${i}`, kind: 'spacer' });
    });
  } else if (doc) {
    for (const g of documentSwatches(doc))
      cells.push({ key: `d${g.getId()}`, kind: 'swatch', item: colorItemOfGradient(g) });
  }
  return cells;
}

/**
 * Set the fill (or the stroke) of the selection to the swatch, with one undo
 * step (upstream ColorItem::on_click).
 */
export function setColorItem(desktop: SPDesktop, item: ColorItem, stroke: boolean): void {
  const attr = stroke ? 'stroke' : 'fill';
  const css = spReprCssAttrNew();
  let description: string;
  const data = item.data;
  if (data.kind === 'none') {
    spReprCssSetProperty(css, attr, 'none');
    description = stroke ? C_('Undo', 'Set stroke color to none') : C_('Undo', 'Set fill color to none');
  } else if (data.kind === 'color') {
    spReprCssSetPropertyString(css, attr, data.color.toString());
    description = stroke
      ? C_('Undo', 'Set stroke color from swatch')
      : C_('Undo', 'Set fill color from swatch');
  } else {
    const id = data.gradient.getId();
    if (!id) return;
    spReprCssSetProperty(css, attr, `url(#${id})`);
    description = stroke
      ? C_('Undo', 'Set stroke color from swatch')
      : C_('Undo', 'Set fill color from swatch');
  }
  sp_desktop_set_style(desktop, css);
  DocumentUndo.done(desktop.getDocument(), description, 'swatches');
}

/** The key that identifies the paint of a swatch for the fill and stroke indicators. */
export function colorItemKey(item: ColorItem): string {
  const d = item.data;
  if (d.kind === 'none') return 'none';
  if (d.kind === 'color') return `rgba:${d.color.toRGBA()}`;
  return `gradient:${d.gradient.getId()}`;
}

/**
 * The keys of the current fill and stroke of the selection, or null when
 * they are unset, different or not a swatch (upstream update_fillstroke_indicators).
 */
export function currentPaintKeys(desktop: SPDesktop): { fill: string | null; stroke: string | null } {
  const doc = desktop.getDocument();
  const key = (fill: boolean): string | null => {
    const style = new SPStyle(doc);
    const result = sp_desktop_query_style(
      desktop,
      style,
      fill ? QueryStyleProperty.QUERY_STYLE_PROPERTY_FILL : QueryStyleProperty.QUERY_STYLE_PROPERTY_STROKE,
    );
    if (
      result !== QueryStyleResult.QUERY_STYLE_SINGLE &&
      result !== QueryStyleResult.QUERY_STYLE_MULTIPLE_AVERAGED &&
      result !== QueryStyleResult.QUERY_STYLE_MULTIPLE_SAME
    ) {
      return null;
    }
    const attr = style.getFillOrStroke(fill);
    if (!attr.set) return null;
    if (attr.isNone()) return 'none';
    if (attr.isColor()) return `rgba:${attr.getColor().toRGBA()}`;
    if (attr.isPaintserver()) {
      const server = fill ? style.getFillPaintServer() : style.getStrokePaintServer();
      if (server instanceof SPGradient) {
        if (server.isSwatch()) return `gradient:${server.getId()}`;
        const ref = server.ref?.getObject();
        if (ref?.isSwatch()) return `gradient:${ref.getId()}`;
      }
    }
    return null;
  };
  return { fill: key(true), stroke: key(false) };
}

// Pinned colors of the compact palette (upstream ColorItem::is_pinned)

/** The pinned colors of the window palette when the preferences say nothing (preferences-skeleton.h). */
const DEFAULT_PINNED = new Set(['none', 'black', 'gray-50', 'white']);

export function isPinned(item: ColorItem, prefsPath: string): boolean {
  if (item.data.kind === 'gradient') return item.data.gradient.isPinned();
  return Preferences.get().getBool(`${prefsPath}/pinned/${item.id}`, DEFAULT_PINNED.has(item.id));
}

export function setPinned(item: ColorItem, prefsPath: string, pinned: boolean): void {
  Preferences.get().setBool(`${prefsPath}/pinned/${item.id}`, pinned);
}

/** The palette id from the preferences, with the default of the window palette. */
export function currentPaletteId(prefsPath: string): string {
  const fallback = prefsPath === EMBEDDED_SWATCHES_PATH ? 'Inkscape default' : AUTO_PALETTE_ID;
  return Preferences.get().getString(`${prefsPath}/palette`, fallback);
}

export function setCurrentPaletteId(prefsPath: string, id: string): void {
  Preferences.get().setString(`${prefsPath}/palette`, id);
}

/** Whether a swatch matches the search text of the dialog (upstream filter_callback). */
export function swatchMatches(cell: PaletteCell, text: string): boolean {
  if (text === '') return true;
  // Group headers and fillers are hidden while searching.
  if (cell.kind !== 'swatch') return false;
  return cell.item.description.toLowerCase().includes(text.toLowerCase());
}
