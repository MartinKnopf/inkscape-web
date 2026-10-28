// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/arc-tool.cpp, src/ui/tools/arc-tool.h
/*
 * Ellipse drawing context.
 *
 * Authors:
 *   Mitsuru Oka
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <johan@shouraizou.nl>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2000-2006 Authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { C_, DocumentUndo, Preferences, SPGenericEllipse } from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import { have_viable_layer, snap_rectangular_box } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import {
  type ModifierState,
  mod_select_add_to,
  mod_trans_confine,
  mod_trans_increment,
  mod_trans_off_center,
  ToolBase,
} from './tool-base.ts';

/**
 * The ellipse tool (upstream ArcTool): drag to create an ellipse (or the arc
 * of the tool preferences start, end and arc_type) in the box from the press
 * point; Ctrl for a circle or integer-ratio ellipse, Shift to draw around
 * the start point, Alt to let the ellipse pass through the pointer.
 * TODO: ShapeEditor (knots), status bar messages, gradient drag, cursor.
 */
export class ArcTool extends ToolBase {
  arc: SPGenericEllipse | null = null;
  center: Point | null = null;
  dragging = false;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/shapes/arc');
    if (Preferences.get().getBool('/tools/shapes/selcue')) this.enableSelectionCue();
  }

  override destroy(): void {
    this.finishItem();
    super.destroy();
  }

  override root_handler(event: Event): boolean {
    const selection = this._desktop.getSelection();
    this.tolerance = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0), 100);
    let ret = false;

    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button === 0) {
          this.dragging = true;
          this.setup_for_drag_start(e);
          // Snap center.
          this.center = this._freeSnap(this._desktopPoint(this._windowPoint(e)));
          this.grabCanvasEvents(e);
          ret = true;
        }
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        if (this.dragging && e.buttons & 1) {
          const w = this._windowPoint(e);
          if (!this.checkDragMoved(w)) break;
          this.drag(this._desktopPoint(w), e); // This will also handle the snapping.
          ret = true;
        } else if (!this.dragging) {
          this._preSnap(this._desktopPoint(this._windowPoint(e)));
        }
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        this.xyp = null;
        if (this.dragging && e.button === 0) {
          this.dragging = false;
          if (this.arc) {
            // we've been dragging, finish the arc
            this.finishItem();
          } else if (this.item_to_select) {
            // no dragging, select clicked item if any
            if (mod_select_add_to(e)) selection.toggle(this.item_to_select);
            else if (!selection.includes(this.item_to_select)) selection.set(this.item_to_select);
          } else {
            // click in an empty space
            selection.clear();
          }
          this.item_to_select = null;
          ret = true;
        }
        this.ungrabCanvasEvents(e);
        break;
      }
      case 'keydown': {
        const e = event as KeyboardEvent;
        if (e.key === 'Escape' && this.dragging) {
          this.dragging = false;
          // if drawing, cancel, otherwise pass it up for deselecting
          this.cancel();
          ret = true;
        } else if (e.key === ' ' && this.dragging) {
          this.dragging = false;
          // we've been dragging, finish the arc
          if (!this.within_tolerance) this.finishItem();
          // do not return true, so that space would work switching to selector
        }
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  drag(pt: Point, state: ModifierState): void {
    if (!this.center) return;
    if (!this.arc) {
      const layer = this.currentLayer();
      if (!layer || !have_viable_layer(this._desktop)) return;

      // Create object
      const repr = this._desktop.getDocument().getReprDoc().createElement('svg:path');
      repr.setAttribute('sodipodi:type', 'arc');
      // Set style
      this._desktop.applyCurrentOrToolStyle(repr, '/tools/shapes/arc', false);
      const arc = layer.appendChildRepr(repr);
      if (!(arc instanceof SPGenericEllipse)) return;
      this.arc = arc;
      this.arc.transform = layer.i2docAffine().inverse();
      this.arc.updateRepr();
    }

    const confine = mod_trans_confine(state);
    // Third is weirdly wrong, surely incrememnts should do something else.
    const circle_edge = mod_trans_increment(state);
    const off_center = mod_trans_off_center(state);

    let r = snap_rectangular_box(this._desktop, pt, this.center, state, this.arc);
    let dir = r.dimensions().div(2);

    if (circle_edge) {
      /* With Alt let the ellipse pass through the mouse pointer */
      let c = r.midpoint();
      if (!confine) {
        if (Math.abs(dir.x) > 1e-6 && Math.abs(dir.y) > 1e-6) {
          const i2d = this.arc.i2dtAffine();
          const new_dir = pt.transformed(i2d).sub(c);
          const lambda = new Point((new_dir.x * dir.y) / dir.x, new_dir.y).length() / dir.y;
          r = new Rect(c.sub(dir.mul(lambda)), c.add(dir.mul(lambda)));
        }
      } else {
        /* with Alt+Ctrl we generate a perfect circle, shift decides if initial click is centre or end of diameter */
        r = off_center ? new Rect(this.center.mul(2).sub(pt), pt) : new Rect(this.center, pt);
        dir = r.dimensions().div(2);
        c = r.midpoint();
        const l = dir.length();
        const d = new Point(l, l);
        r = new Rect(c.sub(d), c.add(d));
      }
    }

    this.arc.position_set(r.midpoint().x, r.midpoint().y, r.dimensions().x / 2, r.dimensions().y / 2);
    // TODO: status text.
  }

  finishItem(): void {
    if (!this.arc) return;
    if (this.arc.rx.computed === 0 || this.arc.ry.computed === 0) {
      // Don't allow the creating of zero sized arc, for example when the start and and point snap to the snap grid point
      this.cancel();
      return;
    }
    this.arc.updateRepr();
    this.arc.doWriteTransform(this.arc.transform, null, true);
    this._desktop.getSelection().set(this.arc);
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Create ellipse'), 'draw-ellipse');
    this.arc = null;
  }

  cancel(): void {
    this._desktop.getSelection().clear();
    this.arc?.deleteObject();
    this.arc = null;
    this.within_tolerance = false;
    this.xyp = null;
    this.item_to_select = null;
    DocumentUndo.cancel(this._desktop.getDocument());
  }
}
