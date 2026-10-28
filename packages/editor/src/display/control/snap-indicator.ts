// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/control/snap-indicator.cpp, src/display/control/snap-indicator.h
/*
 * Provides a class that shows a temporary indicator on the canvas of where the snap was, and what kind of snap
 *
 * Authors:
 *   Johan Engelen
 *   Diederik van Lierop
 *
 * Copyright (C) Johan Engelen 2009 <j.b.c.engelen@utwente.nl>
 * Copyright (C) Diederik van Lierop 2010 - 2012 <mail@diedenrezi.nl>
 */
import {
  _,
  Preferences,
  SnapSourceType as S,
  type SnapCandidatePoint,
  SnapTargetType as T,
} from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { SnappedPoint } from '../../snapped-point.ts';
import type { CanvasItem } from './canvas-item.ts';
import { CanvasItemCtrl, CanvasItemCtrlType } from './canvas-item-ctrl.ts';
import { CanvasItemRect } from './canvas-item-rect.ts';
import { CanvasItemText } from './canvas-item-text.ts';

const source2string: Partial<Record<S, string>> = {
  [S.SNAPSOURCE_UNDEFINED]: 'UNDEFINED',
  [S.SNAPSOURCE_BBOX_CORNER]: 'Bounding box corner',
  [S.SNAPSOURCE_BBOX_MIDPOINT]: 'Bounding box midpoint',
  [S.SNAPSOURCE_BBOX_EDGE_MIDPOINT]: 'Bounding box side midpoint',
  [S.SNAPSOURCE_NODE_SMOOTH]: 'Smooth node',
  [S.SNAPSOURCE_NODE_CUSP]: 'Cusp node',
  [S.SNAPSOURCE_LINE_MIDPOINT]: 'Line midpoint',
  [S.SNAPSOURCE_PATH_INTERSECTION]: 'Path intersection',
  [S.SNAPSOURCE_RECT_CORNER]: 'Corner',
  [S.SNAPSOURCE_CONVEX_HULL_CORNER]: 'Convex hull corner',
  [S.SNAPSOURCE_ELLIPSE_QUADRANT_POINT]: 'Quadrant point',
  [S.SNAPSOURCE_NODE_HANDLE]: 'Handle',
  [S.SNAPSOURCE_GUIDE]: 'Guide',
  [S.SNAPSOURCE_GUIDE_ORIGIN]: 'Guide origin',
  [S.SNAPSOURCE_ROTATION_CENTER]: 'Object rotation center',
  [S.SNAPSOURCE_OBJECT_MIDPOINT]: 'Object midpoint',
  [S.SNAPSOURCE_IMG_CORNER]: 'Corner',
  [S.SNAPSOURCE_TEXT_ANCHOR]: 'Text anchor',
  [S.SNAPSOURCE_OTHER_HANDLE]: 'Handle',
  [S.SNAPSOURCE_GRID_PITCH]: 'Multiple of grid spacing',
  [S.SNAPSOURCE_PAGE_CORNER]: 'Page corner',
  [S.SNAPSOURCE_PAGE_CENTER]: 'Page center',
};

const target2string: Partial<Record<T, string>> = {
  [T.SNAPTARGET_UNDEFINED]: 'UNDEFINED',
  [T.SNAPTARGET_BBOX_CORNER]: 'bounding box corner',
  [T.SNAPTARGET_BBOX_EDGE]: 'bounding box side',
  [T.SNAPTARGET_BBOX_EDGE_MIDPOINT]: 'bounding box side midpoint',
  [T.SNAPTARGET_BBOX_MIDPOINT]: 'bounding box midpoint',
  [T.SNAPTARGET_NODE_SMOOTH]: 'smooth node',
  [T.SNAPTARGET_NODE_CUSP]: 'cusp node',
  [T.SNAPTARGET_LINE_MIDPOINT]: 'line midpoint',
  [T.SNAPTARGET_PATH]: 'path',
  [T.SNAPTARGET_PATH_PERPENDICULAR]: 'path (perpendicular)',
  [T.SNAPTARGET_PATH_TANGENTIAL]: 'path (tangential)',
  [T.SNAPTARGET_PATH_INTERSECTION]: 'path intersection',
  [T.SNAPTARGET_PATH_GUIDE_INTERSECTION]: 'guide-path intersection',
  [T.SNAPTARGET_PATH_CLIP]: 'clip-path',
  [T.SNAPTARGET_PATH_MASK]: 'mask-path',
  [T.SNAPTARGET_ELLIPSE_QUADRANT_POINT]: 'quadrant point',
  [T.SNAPTARGET_RECT_CORNER]: 'corner',
  [T.SNAPTARGET_GRID]: 'grid line',
  [T.SNAPTARGET_GRID_LINE]: 'grid line',
  [T.SNAPTARGET_GRID_INTERSECTION]: 'grid intersection',
  [T.SNAPTARGET_GRID_PERPENDICULAR]: 'grid line (perpendicular)',
  [T.SNAPTARGET_GUIDE]: 'guide',
  [T.SNAPTARGET_GUIDE_INTERSECTION]: 'guide intersection',
  [T.SNAPTARGET_GUIDE_ORIGIN]: 'guide origin',
  [T.SNAPTARGET_GUIDE_PERPENDICULAR]: 'guide (perpendicular)',
  [T.SNAPTARGET_GRID_GUIDE_INTERSECTION]: 'grid-guide intersection',
  [T.SNAPTARGET_PAGE_EDGE_BORDER]: 'page border',
  [T.SNAPTARGET_PAGE_EDGE_CORNER]: 'page corner',
  [T.SNAPTARGET_PAGE_EDGE_CENTER]: 'page center',
  [T.SNAPTARGET_PAGE_MARGIN_BORDER]: 'page margin border',
  [T.SNAPTARGET_PAGE_MARGIN_CORNER]: 'page margin corner',
  [T.SNAPTARGET_PAGE_MARGIN_CENTER]: 'page margin center',
  [T.SNAPTARGET_PAGE_BLEED_BORDER]: 'page bleed border',
  [T.SNAPTARGET_PAGE_BLEED_CORNER]: 'page bleed corner',
  [T.SNAPTARGET_OBJECT_MIDPOINT]: 'object midpoint',
  [T.SNAPTARGET_IMG_CORNER]: 'corner',
  [T.SNAPTARGET_ROTATION_CENTER]: 'object rotation center',
  [T.SNAPTARGET_TEXT_ANCHOR]: 'text anchor',
  [T.SNAPTARGET_TEXT_BASELINE]: 'text baseline',
  [T.SNAPTARGET_CONSTRAINED_ANGLE]: 'constrained angle',
  [T.SNAPTARGET_CONSTRAINT]: 'constraint',
};

/** The text of the snap tooltip: "Bounding box corner to grid intersection". */
export function snap_tooltip(source: S, target: T): string {
  const source_name = _(source2string[source] ?? 'UNDEFINED');
  const target_name = _(target2string[target] ?? 'UNDEFINED');
  if (source !== S.SNAPSOURCE_GRID_PITCH && target !== T.SNAPTARGET_UNDEFINED) {
    return source_name + _(' to ') + target_name;
  }
  return source !== S.SNAPSOURCE_UNDEFINED ? source_name : '';
}

/**
 * Shows where a point snapped to: a cross at the target, a tooltip that
 * names the snap source and target, and the bounding box snapped to. The
 * items go away after /options/snapindicatorpersistence/value seconds.
 * TODO: alignment and distribution indicators, debugging points.
 */
export class SnapIndicator {
  readonly #desktop: SPDesktop;
  #snaptarget: CanvasItem[] = [];
  #snaptarget_is_presnap = false;
  #snapsource: CanvasItemCtrl | null = null;
  #timeout: ReturnType<typeof setTimeout> | null = null;
  #source_timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(desktop: SPDesktop) {
    this.#desktop = desktop;
  }

  destroy(): void {
    this.remove_snaptarget();
    this.remove_snapsource();
  }

  /** Show the snap target of p; pre_snap: a snap shown while hovering (greyed). */
  set_new_snaptarget(p: SnappedPoint, pre_snap = false): void {
    this.remove_snaptarget(); //only display one snaptarget at a time
    if (!p.getSnapped()) return; // If we haven't snapped, then it is of no use to draw a snapindicator
    // This is not a real snap, although moving along the constraint did affect the mouse pointer's position.
    if (p.getTarget() === T.SNAPTARGET_CONSTRAINT) return;
    const prefs = Preferences.get();
    if (!prefs.getBool('/options/snapindicator/value', true)) return;

    this.remove_snapsource(); // Don't set both the source and target indicators, as these will overlap
    // a zero value would mean infinite persistence (i.e. until new snap occurs)
    const timeout_val = Math.max(prefs.getDouble('/options/snapindicatorpersistence/value', 2.0), 0.1);
    const fontsize = prefs.getDouble('/tools/measure/fontsize', 10.0);
    this.#snaptarget_is_presnap = pre_snap;
    const group = this.#desktop.getCanvasTemp();

    // Display snap indicator at snap target
    const ctrl = new CanvasItemCtrl(group, CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_MARKER, p.getPoint());
    ctrl.set_selected(!pre_snap);
    ctrl.set_pickable(false);
    this.#snaptarget.push(ctrl);

    // Display the tooltip, which reveals the type of snap source and the type of snap target
    const tooltip_str = snap_tooltip(p.getSource(), p.getTarget());
    if (tooltip_str) {
      const offset = this.#desktop.w2d().withoutTranslation();
      const tooltip_pos = p.getPoint().add(new Point(0, -2 * fontsize).transformed(offset));
      const canvas_tooltip = new CanvasItemText(group, tooltip_pos, tooltip_str);
      canvas_tooltip.set_fontsize(fontsize);
      canvas_tooltip.set_fill(0xffffffff);
      canvas_tooltip.set_background(pre_snap ? 0x33337f40 : 0x33337f7f);
      this.#snaptarget.push(canvas_tooltip);
    }

    // Display the bounding box, if we snapped to one
    const bbox = p.getTargetBBox();
    if (bbox) {
      const box = new CanvasItemRect(group, bbox);
      box.set_stroke(pre_snap ? 0x7f7f7fff : 0xff0000ff);
      box.set_dashed(true);
      box.lower_to_bottom();
      this.#snaptarget.push(box);
    }
    this.#timeout = setTimeout(() => this.remove_snaptarget(), timeout_val * 1000);
  }

  /** Remove the snap target indicator (only_if_presnap: only a pre-snap one). */
  remove_snaptarget(only_if_presnap = false): void {
    if (only_if_presnap && !this.#snaptarget_is_presnap) return;
    if (this.#timeout) clearTimeout(this.#timeout);
    this.#timeout = null;
    for (const item of this.#snaptarget) item.unlink();
    this.#snaptarget = [];
    this.#snaptarget_is_presnap = false;
  }

  /** Mark the snap source (with /options/snapclosestonly/value). */
  set_new_snapsource(p: SnapCandidatePoint): void {
    this.remove_snapsource();
    if (!Preferences.get().getBool('/options/snapindicator/value', true)) return;
    const ctrl = new CanvasItemCtrl(
      this.#desktop.getCanvasTemp(),
      CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_POINT,
    );
    ctrl.set_position(p.getPoint());
    ctrl.set_pickable(false);
    this.#snapsource = ctrl;
    this.#source_timeout = setTimeout(() => this.remove_snapsource(), 1000);
  }

  remove_snapsource(): void {
    if (this.#source_timeout) clearTimeout(this.#source_timeout);
    this.#source_timeout = null;
    this.#snapsource?.unlink();
    this.#snapsource = null;
  }

  /** The items that show the current snap target (for tests). */
  get_snaptarget_items(): readonly CanvasItem[] {
    return this.#snaptarget;
  }
}
