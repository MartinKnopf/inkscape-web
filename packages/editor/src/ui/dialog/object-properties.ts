// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/object-properties.cpp, src/ui/dialog/object-properties.h, src/ui/dialog/object-attributes.cpp, src/widgets/sp-attribute-widget.cpp
/*
 * Object properties dialog.
 *
 * Copyright (C) 2012 Kris De Gussem <Kris.DeGussem@gmail.com>
 * c++ version based on former C-version (GPL v2+) with authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <goejendaagh@zonnet.nl>
 *   Abhishek Sharma
 */
import {
  _,
  C_,
  convertUnit,
  DocumentUndo,
  get_scale_transform_for_variable_stroke,
  is_object_id_valid,
  Preferences,
  SP_OBJECT_MODIFIED_FLAG,
  type SPImage,
  type SPItem,
  type SPObject,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssSetProperty,
} from '@inkscape-web/core';
import { Rect } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { objectLabel } from './objects.ts';

const ICON = 'dialog-object-properties';

/** The JavaScript event handler attributes of the interactivity table, with their labels. */
export const INTERACTIVITY_ATTRIBUTES: readonly (readonly [attribute: string, label: string])[] = [
  ['onclick', 'Click'],
  ['onmouseover', 'MouseOver'],
  ['onmouseout', 'MouseOut'],
  ['onmousedown', 'MouseDown'],
  ['onmouseup', 'MouseUp'],
  ['onmousemove', 'MouseMove'],
  ['onfocusin', 'FocusIn'],
  ['onfocusout', 'FocusOut'],
  ['onload', 'Load'],
];

/** The values of the image-rendering property and their labels (preferences dialog). */
export const IMAGE_RENDERING: readonly (readonly [value: string, label: string])[] = [
  ['auto', 'None (auto)'],
  ['optimizeQuality', 'Smooth (optimizeQuality)'],
  ['optimizeSpeed', 'Blocky (optimizeSpeed)'],
];

/** The object that the dialog shows: the only selected item, or null. */
export function objectPropertiesObject(desktop: SPDesktop): SPItem | null {
  return desktop.getSelection().singleItem();
}

/** The title of the dialog section: the label placeholder for an object without label (upstream get_title). */
export function objectPropertiesTitle(desktop: SPDesktop): string {
  const item = objectPropertiesObject(desktop);
  return item ? objectLabel(item) : _('Selection');
}

/** Set the id of object (button Set); returns the warning if the id is invalid. */
export function setObjectId(object: SPObject, id: string): string | null {
  const { valid, warning } = is_object_id_valid(id);
  if (!valid) return warning;
  object.setAttribute('id', id);
  DocumentUndo.done(object.document, C_('Undo', 'Set object ID'), ICON);
  return null;
}

/** Set the inkscape:label of object. */
export function setObjectLabel(object: SPObject, label: string): void {
  if (label === (object.label() ?? '')) return;
  object.setAttribute('inkscape:label', label === '' ? null : label);
  object.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.maybeDone(object.document, 'set-obj-label', C_('Undo', 'Set object label'), ICON);
}

export function setObjectTitle(object: SPObject, title: string): void {
  if (!object.setTitle(title)) return;
  object.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.maybeDone(object.document, 'set-obj-title', C_('Undo', 'Set object title'), ICON);
}

export function setObjectDescription(object: SPObject, description: string): void {
  if (!object.setDesc(description)) return;
  object.requestModified(SP_OBJECT_MODIFIED_FLAG);
  DocumentUndo.maybeDone(object.document, 'set-obj-desc', C_('Undo', 'Set object description'), ICON);
}

/** Lock or unlock item (the lock button toggles). */
export function setObjectLocked(item: SPItem, lock: boolean): void {
  item.setLocked(lock);
  DocumentUndo.done(item.document, lock ? C_('Undo', 'Lock object') : C_('Undo', 'Unlock object'), ICON);
}

/** Hide or show item. */
export function setObjectHidden(item: SPItem, hide: boolean): void {
  item.setExplicitlyHidden(hide);
  DocumentUndo.done(item.document, hide ? C_('Undo', 'Hide object') : C_('Undo', 'Unhide object'), ICON);
}

/** The image-rendering value that is set on image (auto if none). */
export function getImageRendering(image: SPImage): string {
  const css = image.getAttribute('style') ?? '';
  const m = /(?:^|;)\s*image-rendering\s*:\s*([^;\s]+)/.exec(css);
  return m?.[1] ?? 'auto';
}

/** Set the image-rendering property of image (optimizeQuality is smooth, optimizeSpeed is blocky). */
export function setImageRendering(image: SPImage, value: string): void {
  const css = spReprCssAttrNew();
  spReprCssSetProperty(css, 'image-rendering', value);
  spReprCssChange(image.getRepr(), css, 'style');
  DocumentUndo.done(image.document, C_('Undo', 'Set image rendering option'), ICON);
}

/** Set an event handler attribute of object; an empty text removes it (upstream SPAttributeTable::attribute_table_entry_changed). */
export function setObjectAttribute(object: SPObject, attribute: string, text: string): void {
  if (text === (object.getAttribute(attribute) ?? '')) return;
  object.setAttribute(attribute, text === '' ? null : text);
  DocumentUndo.done(object.document, C_('Undo', 'Set attribute'), '');
}

/** The box of the selection for the location and size fields, in unit (upstream sp_selection_get_xywh). */
export function selectionXywh(desktop: SPDesktop, unit: string, useVisualBox: boolean): Rect | null {
  const sel = desktop.getSelection();
  const bbox = useVisualBox ? sel.visualBounds() : sel.geometricBounds();
  if (sel.isEmpty() || !bbox) return null;
  // TODO: the page origin and the anchor of the selection.
  const c = (v: number) => convertUnit(v, 'px', unit);
  return Rect.fromXywh(c(bbox.left()), c(bbox.top()), c(bbox.width()), c(bbox.height()));
}

/**
 * Move and scale the selection so that its box becomes rect, given in unit
 * (upstream sp_transform_selected_items). One undo step "Transform selected
 * items", merged for repeated edits of the same field.
 */
export function transformSelectedItems(
  desktop: SPDesktop,
  rect: Rect,
  unit: string,
  useVisualBox: boolean,
): void {
  const selection = desktop.getSelection();
  const document = desktop.doc;
  document.ensureUpToDate();
  const bbox_vis = selection.visualBounds();
  const bbox_geom = selection.geometricBounds();
  const bbox_user = useVisualBox ? bbox_vis : bbox_geom;
  if (!bbox_user || !bbox_vis || !bbox_geom) return;

  const toPx = (v: number) => convertUnit(v, unit, 'px');
  const x0 = toPx(rect.left());
  const y0 = toPx(rect.top());
  const x1 = x0 + toPx(rect.width());
  const y1 = y0 + toPx(rect.height());
  const eps = 1e-6;
  if (
    Math.abs(x0 - bbox_user.left()) < eps &&
    Math.abs(x1 - bbox_user.right()) < eps &&
    Math.abs(y0 - bbox_user.top()) < eps &&
    Math.abs(y1 - bbox_user.bottom()) < eps
  ) {
    return;
  }
  const prefs = Preferences.get();
  const scaler = useVisualBox
    ? get_scale_transform_for_variable_stroke(
        bbox_vis,
        bbox_geom,
        prefs.getBool('/options/transform/stroke', true),
        prefs.getBool('/options/preservetransform/value', false),
        x0,
        y0,
        x1,
        y1,
      )
    : // A geometric box has no stroke: use the box for both.
      get_scale_transform_for_variable_stroke(bbox_geom, bbox_geom, false, false, x0, y0, x1, y1);
  selection.applyAffine(scaler);
  DocumentUndo.maybeDone(
    document,
    'object-properties-transform',
    C_('Undo', 'Transform selected items'),
    'tool-pointer',
  );
}
