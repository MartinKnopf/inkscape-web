// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/spiral-tool.cpp, src/ui/tools/spiral-tool.h
/*
 * Spiral drawing context
 *
 * Authors:
 *   Mitsuru Oka
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 1999-2001 Lauris Kaplinski
 * Copyright (C) 2001-2002 Mitsuru Oka
 */
import { C_, DocumentUndo, Preferences, SP_OBJECT_WRITE_EXT, SPSpiral } from '@inkscape-web/core';
import { atan2, type Point } from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { type ModifierState, mod_freehand_angle_snapping, mod_select_add_to, ToolBase } from './tool-base.ts';

/**
 * The spiral tool (upstream SpiralTool): drag from the center to create a
 * spiral with the turns, divergence and inner radius of the tool
 * preferences; Ctrl snaps the angle.
 * TODO: ShapeEditor (knots), snapping, status bar messages, gradient drag, cursor.
 */
export class SpiralTool extends ToolBase {
  spiral: SPSpiral | null = null;
  center: Point | null = null;
  dragging = false;
  exp = 1.0;
  revo = 3.0;
  t0 = 0.0;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/shapes/spiral');
    this.sp_event_context_read('expansion');
    this.sp_event_context_read('revolution');
    this.sp_event_context_read('t0');
    if (Preferences.get().getBool('/tools/shapes/selcue')) this.enableSelectionCue();
  }

  override destroy(): void {
    this.finishItem();
    super.destroy();
  }

  override set(name: string): void {
    const prefs = Preferences.get();
    const path = `${this.getPrefsPath()}/${name}`;
    if (name === 'expansion') this.exp = clamp(prefs.getDouble(path), 0.0, 1000.0);
    else if (name === 'revolution') this.revo = clamp(prefs.getDouble(path, 3.0), 0.05, 40.0);
    else if (name === 't0') this.t0 = clamp(prefs.getDouble(path), 0.0, 0.999);
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
          // TODO: snap center.
          this.center = this._desktopPoint(this._windowPoint(e));
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
          this.drag(this._desktopPoint(w), e);
          ret = true;
        }
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        this.xyp = null;
        if (this.dragging && e.button === 0) {
          this.dragging = false;
          if (this.spiral) {
            // we've been dragging, finish the spiral
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
          // we've been dragging, finish the spiral
          if (!this.within_tolerance) this.finishItem();
          // do not return true, so that space would work switching to selector
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

    if (!this.spiral) {
      const layer = this.currentLayer();
      if (!layer || !have_viable_layer(this._desktop)) return;

      // Create object
      const repr = this._desktop.getDocument().getReprDoc().createElement('svg:path');
      repr.setAttribute('sodipodi:type', 'spiral');
      // Set style
      this._desktop.applyCurrentOrToolStyle(repr, '/tools/shapes/spiral', false);
      const spiral = layer.appendChildRepr(repr);
      if (!(spiral instanceof SPSpiral)) return;
      this.spiral = spiral;
      this.spiral.transform = layer.i2docAffine().inverse();
      this.spiral.updateRepr();
    }

    // TODO: snap the end point.
    const dt2doc = this._desktop.dt2doc();
    const p0 = this.center.transformed(dt2doc);
    const p1 = p.transformed(dt2doc);
    const delta = p1.sub(p0);
    const rad = delta.length();

    // Start angle calculated from end angle and number of revolutions.
    let arg = atan2(delta) - 2.0 * Math.PI * this.spiral.revo;

    if (mod_freehand_angle_snapping(state)) {
      /* Snap start angle */
      const snaps_radian = Math.PI / snaps;
      arg = Math.round(arg / snaps_radian) * snaps_radian;
    }

    /* Fixme: these parameters should be got from dialog box */
    this.spiral.setPosition(p0.x, p0.y, this.exp, this.revo, rad, arg, this.t0);
    // TODO: status text.
  }

  finishItem(): void {
    if (!this.spiral) return;
    if (this.spiral.rad === 0) {
      // Don't allow the creating of zero sized spiral, for example when the start and and point snap to the snap grid point
      this.cancel();
      return;
    }
    // Set the *transform* center, so select tool rotations work from the spiral's
    // center instead of the bbox center.
    if (this.center) this.spiral.setCenter(this.center);
    this.spiral.set_shape();
    this.spiral.updateRepr(SP_OBJECT_WRITE_EXT);
    // compensate stroke scaling couldn't be done in doWriteTransform
    const expansion = this.spiral.transform.descrim();
    this.spiral.doWriteTransform(this.spiral.transform, null, true);
    this.spiral.adjustStrokeWidthRecursive(expansion);
    this._desktop.getSelection().set(this.spiral);
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Create spiral'), 'draw-spiral');
    this.spiral = null;
  }

  cancel(): void {
    this._desktop.getSelection().clear();
    this.spiral?.deleteObject();
    this.spiral = null;
    this.within_tolerance = false;
    this.xyp = null;
    this.item_to_select = null;
    DocumentUndo.cancel(this._desktop.getDocument());
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
