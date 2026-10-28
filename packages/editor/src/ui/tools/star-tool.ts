// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/star-tool.cpp, src/ui/tools/star-tool.h
/*
 * Star drawing context
 *
 * Authors:
 *   Mitsuru Oka <oka326@parkcity.ne.jp>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2001-2002 Mitsuru Oka
 */
import { C_, DocumentUndo, Preferences, SP_OBJECT_WRITE_EXT, SPStar } from '@inkscape-web/core';
import { Affine, atan2, type Point } from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { type ModifierState, mod_freehand_angle_snapping, mod_select_add_to, ToolBase } from './tool-base.ts';

/**
 * The star tool (upstream StarTool): drag from the center to create a star
 * or polygon with the corners, spoke ratio, rounding and randomization of
 * the tool preferences; Ctrl snaps the angle.
 * TODO: ShapeEditor (knots), status bar messages, gradient drag, cursor.
 */
export class StarTool extends ToolBase {
  star: SPStar | null = null;
  center: Point | null = null;
  dragging = false;
  /** Number of corners */
  magnitude = 5;
  /** Ratio of the base radius to the tip radius */
  proportion = 0.5;
  /** Whether to draw a polygon or a star */
  isflatsided = false;
  /** Roundedness of the star */
  rounded = 0.0;
  /** Randomization of the star's shape */
  randomized = 0.0;
  /** Layer to item transform of the star being drawn */
  #tr = Affine.identity();

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/shapes/star');
    this.sp_event_context_read('isflatsided');
    this.sp_event_context_read('magnitude');
    this.sp_event_context_read('proportion');
    this.sp_event_context_read('rounded');
    this.sp_event_context_read('randomized');
    if (Preferences.get().getBool('/tools/shapes/selcue')) this.enableSelectionCue();
  }

  override destroy(): void {
    this.finishItem();
    super.destroy();
  }

  override set(name: string): void {
    const prefs = Preferences.get();
    const path = `${this.getPrefsPath()}/${name}`;
    if (name === 'magnitude') {
      this.magnitude = clamp(prefs.getInt(path, 5), this.isflatsided ? 3 : 2, 1024);
    } else if (name === 'proportion') {
      this.proportion = clamp(prefs.getDouble(path, 0.5), 0.01, 2.0);
    } else if (name === 'isflatsided') {
      this.isflatsided = prefs.getBool(path);
    } else if (name === 'rounded') {
      this.rounded = prefs.getDouble(path);
    } else if (name === 'randomized') {
      this.randomized = prefs.getDouble(path);
    }
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
          if (this.star) {
            // We've been dragging, finish the star.
            this.finishItem();
          } else if (this.item_to_select) {
            // No dragging, select clicked item if any.
            if (mod_select_add_to(e)) selection.toggle(this.item_to_select);
            else if (!selection.includes(this.item_to_select)) selection.set(this.item_to_select);
          } else {
            // Click in an empty space.
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
          // If drawing, cancel, otherwise pass it up for deselecting.
          this.cancel();
          ret = true;
        } else if (e.key === ' ' && this.dragging) {
          this.dragging = false;
          // We've been dragging, finish the star.
          if (!this.within_tolerance) this.finishItem();
          // Do not return true, so that space would work switching to selector.
        }
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  drag(p: Point, state: ModifierState): void {
    if (!this.center) return;
    const prefs = Preferences.get();
    const snaps = clamp(prefs.getDouble('/options/rotationsnapsperpi/value', 12.0), 0.1, 1800.0);

    if (!this.star) {
      const layer = this.currentLayer();
      if (!layer || !have_viable_layer(this._desktop)) return;
      this.#tr = layer.i2docAffine().inverse();

      // Create object
      const repr = this._desktop.getDocument().getReprDoc().createElement('svg:path');
      repr.setAttribute('sodipodi:type', 'star');
      // Set style
      this._desktop.applyCurrentOrToolStyle(repr, '/tools/shapes/star', false);
      const star = layer.appendChildRepr(repr);
      if (!(star instanceof SPStar)) return;
      this.star = star;
      this.star.updateRepr();
      // Adjust stroke width to cope with parent's transform
      this.star.adjustStrokeWidthRecursive(this.#tr.descrim());
    }

    /* Snap corner point with no constraints */
    p = this._freeSnap(p, this.star);
    const dt2doc = this._desktop.dt2doc();
    const p0 = this.center.transformed(dt2doc).transformed(this.#tr);
    const p1 = p.transformed(dt2doc).transformed(this.#tr);

    const sides = this.magnitude;
    const d = p1.sub(p0);
    const r1 = d.length();
    let arg1 = atan2(d);

    if (mod_freehand_angle_snapping(state)) {
      /* Snap angle */
      const snaps_radian = Math.PI / snaps;
      arg1 = Math.round(arg1 / snaps_radian) * snaps_radian;
    }

    this.star.setPosition(
      this.magnitude,
      p0,
      r1,
      r1 * this.proportion,
      arg1,
      arg1 + Math.PI / sides,
      this.isflatsided,
      this.rounded,
      this.randomized,
    );
    // TODO: status text.
  }

  finishItem(): void {
    if (!this.star) return;
    if (this.star.r[1] === 0) {
      // Don't allow the creating of zero sized arc, for example
      // when the start and and point snap to the snap grid point
      this.cancel();
      return;
    }
    // Set the *transform* center, so select tool rotations work from the star's
    // center instead of the bbox center for odd spoked stars.
    if (this.center) this.star.setCenter(this.center);
    this.star.set_shape();
    this.star.updateRepr(SP_OBJECT_WRITE_EXT);
    this._desktop.getSelection().set(this.star);
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Create star'), 'draw-polygon-star');
    this.star = null;
  }

  cancel(): void {
    this._desktop.getSelection().clear();
    this.star?.deleteObject();
    this.star = null;
    this.within_tolerance = false;
    this.xyp = null;
    this.item_to_select = null;
    DocumentUndo.cancel(this._desktop.getDocument());
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
