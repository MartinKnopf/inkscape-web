// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/rect-tool.cpp, src/ui/tools/rect-tool.h
/*
 * Rectangle drawing context
 *
 * Author:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2006      Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 2000-2005 authors
 * Copyright (C) 2000-2001 Ximian, Inc.
 */
import { C_, DocumentUndo, Preferences, SPRect } from '@inkscape-web/core';
import type { Point } from '@inkscape-web/geom';
import { have_viable_layer, snap_rectangular_box } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import { type ModifierState, mod_select_add_to, ToolBase } from './tool-base.ts';

/**
 * The rectangle tool (upstream RectTool): drag to create a rectangle with the
 * corner radii of the tool preferences; Ctrl for a square or an
 * integer-ratio rectangle, Shift to draw around the start point. A click
 * without drag selects the clicked object.
 * TODO: ShapeEditor (knots), snapping, status bar messages, Shift+G, gradient drag, cursor.
 */
export class RectTool extends ToolBase {
  rect: SPRect | null = null;
  center: Point | null = null;
  rx = 0;
  ry = 0;
  dragging = false;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/shapes/rect');
    this.sp_event_context_read('rx');
    this.sp_event_context_read('ry');
    if (Preferences.get().getBool('/tools/shapes/selcue')) this.enableSelectionCue();
  }

  override destroy(): void {
    this.finishItem();
    super.destroy();
  }

  override set(name: string): void {
    const value = Preferences.get().getDouble(`${this.getPrefsPath()}/${name}`, 0);
    // prevents NaN and +/-Inf from messing up
    const limited = Number.isFinite(value) ? value : 0;
    if (name === 'rx') this.rx = limited;
    else if (name === 'ry') this.ry = limited;
  }

  override root_handler(event: Event): boolean {
    const selection = this._desktop.getSelection();
    this.tolerance = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0), 100);
    let ret = false;

    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button === 0) {
          // Save drag origin; remember clicked item, disregarding groups.
          this.setup_for_drag_start(e);
          this.dragging = true;
          // Position center. TODO: snap center.
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
          if (this.rect) {
            // We've been dragging, finish the rect.
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
          // if drawing, cancel, otherwise pass it up for deselecting
          this.cancel();
          ret = true;
        } else if (e.key === ' ' && this.dragging) {
          this.dragging = false;
          if (!this.within_tolerance) {
            // we've been dragging, finish the rect
            this.finishItem();
          }
          // do not return true, so that space would work switching to selector
        }
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  drag(pt: Point, state: ModifierState): void {
    if (!this.center) return;
    if (!this.rect) {
      const layer = this.currentLayer();
      if (!layer || !have_viable_layer(this._desktop)) return;

      // Create object
      const repr = this._desktop.getDocument().getReprDoc().createElement('svg:rect');
      // Set style
      this._desktop.applyCurrentOrToolStyle(repr, '/tools/shapes/rect', false);
      const rect = layer.appendChildRepr(repr);
      if (!(rect instanceof SPRect)) return;
      this.rect = rect;
      this.rect.transform = layer.i2docAffine().inverse();
      this.rect.updateRepr();
    }

    const r = snap_rectangular_box(this._desktop, pt, this.center, state);
    const d = r.dimensions();
    this.rect.setPosition(r.min().x, r.min().y, d.x, d.y);
    if (this.rx !== 0.0) this.rect.setRx(true, this.rx);
    if (this.ry !== 0.0) {
      if (this.rx === 0.0) this.rect.setRy(true, clamp(this.ry, 0, Math.min(d.x, d.y) / 2));
      else this.rect.setRy(true, clamp(this.ry, 0, d.y));
    }
    // TODO: status text.
  }

  finishItem(): void {
    if (!this.rect) return;
    if (this.rect.width.computed === 0 || this.rect.height.computed === 0) {
      // Don't allow the creating of zero sized rectangle, for example when the start and and point snap to the snap grid point
      this.cancel();
      return;
    }
    this.rect.updateRepr();
    this.rect.doWriteTransform(this.rect.transform, null, true);
    this._desktop.getSelection().set(this.rect);
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Create rectangle'), 'draw-rectangle');
    this.rect = null;
  }

  cancel(): void {
    this._desktop.getSelection().clear();
    this.rect?.deleteObject();
    this.rect = null;
    this.within_tolerance = false;
    this.xyp = null;
    this.item_to_select = null;
    DocumentUndo.cancel(this._desktop.getDocument());
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
