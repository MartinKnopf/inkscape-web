// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/guides.cpp, src/ui/dialog/guides.h
/*
 * Simple guideline dialog.
 *
 * Authors:
 *   Lauris Kaplinski <lawrence@kaplinski.com>
 *   Andrius R. <knutux@gmail.com>
 *   Johan Engelen
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2007 Authors
 */
import { C_, DocumentUndo, type SPGuide } from '@inkscape-web/core';
import { Point, rot90 } from '@inkscape-web/geom';

/** The values of the guideline dialog: position in px, angle in degrees, label, locked. */
export interface GuidelineProperties {
  x: number;
  y: number;
  angle: number;
  label: string;
  locked: boolean;
}

/** The current values of guide for the dialog (upstream GuidelinePropertiesDialog::_setup). */
export function guideline_properties(guide: SPGuide): GuidelineProperties {
  let angle: number;
  if (guide.isVertical()) angle = 90;
  else if (guide.isHorizontal()) angle = 0;
  else angle = (Math.atan2(-guide.getNormal().x, guide.getNormal().y) * 180) / Math.PI;
  // TODO: the page origin (multiple pages).
  const pos = guide.getPoint();
  return { x: pos.x, y: pos.y, angle, label: guide.label() ?? '', locked: guide.getLocked() };
}

/**
 * Apply the dialog values to guide (upstream _onOKimpl). relative: x, y and
 * angle are added to the current values. TODO: the color.
 */
function apply(guide: SPGuide, v: GuidelineProperties, relative: boolean, old: GuidelineProperties): void {
  let deg_angle = v.angle;
  if (relative) deg_angle += old.angle;
  let normal: Point;
  if (deg_angle === 90 || deg_angle === 270 || deg_angle === -90 || deg_angle === -270) {
    normal = new Point(1, 0);
  } else if (deg_angle === 0 || deg_angle === 180 || deg_angle === -180) {
    normal = new Point(0, 1);
  } else {
    normal = rot90(Point.polar((deg_angle * Math.PI) / 180, 1.0));
  }
  //To allow reposition from dialog
  guide.set_locked(false, false);
  guide.set_normal(normal, true);
  let newpos = new Point(v.x, v.y);
  // Adjust position by the relative position
  if (relative) newpos = newpos.add(new Point(old.x, old.y));
  guide.moveto(newpos, true);
  guide.set_label(v.label, true);
  guide.set_locked(v.locked, true);
}

/** OK: apply the values, with the undo step "Set guide properties". */
export function guideline_properties_ok(guide: SPGuide, v: GuidelineProperties, relative = false): void {
  apply(guide, v, relative, guideline_properties(guide));
  DocumentUndo.done(guide.document, C_('Undo', 'Set guide properties'), '');
}

/** Duplicate: a new guide with the values, with the undo step "Duplicate guide". */
export function guideline_properties_duplicate(
  guide: SPGuide,
  v: GuidelineProperties,
  relative = false,
): void {
  const old = guideline_properties(guide);
  const copy = guide.duplicate();
  if (!copy) return;
  apply(copy, v, relative, old);
  DocumentUndo.done(copy.document, C_('Undo', 'Duplicate guide'), '');
}

/** Delete: remove the guide (also a locked one), with the undo step "Delete guide". */
export function guideline_properties_delete(guide: SPGuide): void {
  const doc = guide.document;
  if (guide.remove(true)) DocumentUndo.done(doc, C_('Undo', 'Delete guide'), '');
}
