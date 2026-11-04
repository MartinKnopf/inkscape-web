// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/marker-tool.cpp, src/ui/tools/marker-tool.h
/*
 * Marker edit mode - onCanvas marker editing of marker orientation, position, scale
 *
 * Authors:
 * see git history
 * Rachana Podaralla <rpodaralla3@gatech.edu>
 *
 * Copyright (C) 2018 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  Preferences,
  type Selection,
  type SPItem,
  type SPMarker,
  SPMarkerLoc,
  SPMarkerUnits,
  SPShape,
  sp_validate_marker,
  unitTangentAt,
} from '@inkscape-web/core';
import { Affine, type Curve, Rotate, Scale, Translate } from '@inkscape-web/geom';
import { set_active_tool } from '../../actions/actions-tools.ts';
import type { SPDesktop } from '../../desktop.ts';
import { ShapeEditor } from '../shape-editor.ts';
import { type ShapeRecord, ShapeRole } from '../tool/shape-record.ts';
import { ToolBase } from './tool-base.ts';

/** The angle of the direction of travel of the curve at its start (t = 0) or end (t = 1). */
const angle_of = (c: Curve, t: 0 | 1): number => {
  const tang = unitTangentAt(c, t);
  return Math.atan2(tang.y, tang.x);
};

/**
 * Edit the markers of the selected paths on the canvas (upstream MarkerTool): one marker at a
 * time, the one at editMarkerMode (an SPMarkerLoc, -1: none) of the first selected shape that
 * has it. The knots move the reference point, rotate and scale the marker. Clicks select items.
 */
export class MarkerTool extends ToolBase {
  /** The shape editors by selected item; at most one. */
  readonly _shape_editors = new Map<SPItem, ShapeEditor>();
  /** The SPMarkerLoc of the markers to edit, or -1. */
  editMarkerMode = -1;
  readonly #disconnect: () => void;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/marker');
    const selection = desktop.getSelection();
    this.#disconnect = selection.connectChanged((sel) => this.selection_changed(sel));
    this.selection_changed(selection);

    const prefs = Preferences.get();
    if (prefs.getBool('/tools/marker/selcue')) this.enableSelectionCue();
    if (prefs.getBool('/tools/marker/gradientdrag')) this.enableGrDrag();
  }

  override destroy(): void {
    this.ungrabCanvasEvents();
    this.#clear_shape_editors();
    this.#disconnect();
    super.destroy();
  }

  #clear_shape_editors(): void {
    for (const se of this._shape_editors.values()) se.unset_item();
    this._shape_editors.clear();
  }

  /**
   * Cycles through all the selected items to see if any have a marker in the right location
   * (based on editMarkerMode); if a matching item is found, loads the corresponding marker on the
   * shape into the shape editor and exits the loop. Forces the user to edit one marker at a time.
   */
  selection_changed(selection: Selection): void {
    const doc = this._desktop.getDocument();
    this.#clear_shape_editors();

    for (const item of selection.items()) {
      if (!(item instanceof SPShape) || !item.hasMarkers() || this.editMarkerMode === -1) continue;
      const sp_marker = item._marker[this.editMarkerMode];
      if (!sp_marker) continue;

      sp_validate_marker(sp_marker, doc);

      const sr = this.get_marker_transform(item, item, sp_marker, this.editMarkerMode);
      const si = new ShapeEditor(this._desktop, sr.edit_transform, sr.edit_rotation, this.editMarkerMode);
      si.set_item(sr.object as SPItem);
      this._shape_editors.set(item, si);
      break;
    }
  }

  /** Handles selection of new items. */
  override root_handler(event: Event): boolean {
    const selection = this._desktop.getSelection();
    let ret = false;
    if (event.type === 'pointerdown') {
      const e = event as PointerEvent;
      if (e.button === 0) {
        // TODO: Alt (mod_select_force_drag) selects under.
        this.item_to_select = this._desktop.getItemAtPoint(this._windowPoint(e), true);
        this.grabCanvasEvents(e);
        ret = true;
      }
    } else if (event.type === 'pointerup') {
      const e = event as PointerEvent;
      if (e.button === 0) {
        if (this.item_to_select) {
          // unselect all items, except for newly selected item
          selection.set(this.item_to_select);
        } else {
          // clicked into empty space, deselect any selected items
          selection.clear();
        }
        this.item_to_select = null;
        this.ungrabCanvasEvents(e);
        ret = true;
      }
    }
    return ret || super.root_handler(event);
  }

  /**
   * Calculates where the knot holders need to go based on the reference shape. Uses similar logic
   * to sp_shape_update_marker_view, but the tangent angle needs to be saved here and the
   * parent_item i2doc affine also needs to be accounted for in the right places.
   */
  get_marker_transform(
    shape: SPShape,
    parent_item: SPItem,
    sp_marker: SPMarker,
    marker_type: SPMarkerLoc,
  ): ShapeRecord & { edit_rotation: number } {
    // scale marker transform with parent stroke width
    const doc = this._desktop.getDocument();
    const docscale = doc.getDocumentScale();
    let scale = Scale(docscale.x, docscale.y);
    if (sp_marker.markerUnits === SPMarkerUnits.SP_MARKER_UNITS_STROKEWIDTH) {
      const w = shape.style.stroke_width.computed;
      scale = scale.multiply(Scale(w, w));
    }

    const pathv = shape.curve() ?? [];
    const i2doc = parent_item.i2docAffine();
    let ret: Affine = Affine.identity();
    let angle = 0.0; // edit_rotation - tangent angle used for auto orientation

    if (marker_type === SPMarkerLoc.SP_MARKER_LOC_START) {
      const c = pathv[0]?.curves()[0];
      if (c) {
        ret = Translate(c.pointAt(0).transformed(i2doc));
        if (!c.isDegenerate()) {
          angle = angle_of(c, 0);
          ret = Rotate(angle).multiply(ret);
        }
      }
    } else if (marker_type === SPMarkerLoc.SP_MARKER_LOC_MID) {
      // A shape can have multiple mid markers - only one is needed: once a valid mid marker is
      // found, save the edit transform and rotation and break out of the loop.
      for (const [i, path_it] of pathv.entries()) {
        const curves = path_it.curves();
        const is_last = i === pathv.length - 1;

        // mid marker start position
        const first = curves[0];
        if (first && i !== 0) {
          const c = first;
          ret = Translate(c.pointAt(0).transformed(i2doc));
          if (!c.isDegenerate()) {
            angle = angle_of(c, 0);
            ret = Rotate(angle).multiply(ret);
            break;
          }
        }

        // mid marker mid positions
        if (curves.length > 1) {
          const c1 = curves[0] as Curve;
          const c2 = curves[1] as Curve;
          const p = c1.pointAt(1);
          const angle1 = angle_of(c1, 1);
          const angle2 = angle_of(c2, 0);
          angle = 0.5 * (angle1 + angle2);
          if (Math.abs(angle2 - angle1) > Math.PI) angle += Math.PI;
          ret = Rotate(angle).multiply(Translate(p.transformed(i2doc)));
        }

        // mid marker end position
        if (!is_last && curves.length > 0) {
          const c = curves[curves.length - 1] as Curve;
          ret = Translate(c.pointAt(1).transformed(i2doc));
          if (!c.isDegenerate()) {
            angle = angle_of(c, 1);
            ret = Rotate(angle).multiply(ret);
            break;
          }
        }
      }
    } else if (marker_type === SPMarkerLoc.SP_MARKER_LOC_END) {
      const c = pathv.at(-1)?.curves().at(-1);
      if (c) {
        ret = Translate(c.pointAt(1).transformed(i2doc));
        if (!c.isDegenerate()) {
          angle = angle_of(c, 1);
          ret = Rotate(angle).multiply(ret);
        }
      }
    }

    // scale by stroke width
    ret = scale.multiply(ret);
    // account for parent transform
    ret = parent_item.transform.withoutTranslation().multiply(ret);

    return {
      object: sp_marker,
      edit_transform: ret,
      edit_rotation: (angle * 180.0) / Math.PI,
      role: ShapeRole.SHAPE_ROLE_NORMAL,
      lpe_key: '',
    };
  }
}

/**
 * Switch to the marker tool to edit the marker at location (an SPMarkerLoc) of the selection
 * (upstream edit_marker() in paint-attribute.cpp and StrokeStyle::enterEditMarkerMode()).
 */
export function edit_marker(location: SPMarkerLoc, desktop: SPDesktop): void {
  set_active_tool(desktop, 'Marker');
  const tool = desktop.getTool();
  if (tool instanceof MarkerTool) {
    tool.editMarkerMode = location;
    tool.selection_changed(desktop.getSelection());
  }
}
