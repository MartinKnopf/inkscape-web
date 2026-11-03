// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/mesh-tool.cpp, src/ui/tools/mesh-tool.h
/*
 * Mesh drawing and editing tool
 *
 * Authors:
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Abhishek Sharma
 *   Tavmjong Bah <tavmjong@free.fr>
 *
 * Copyright (C) 2012 Tavmjong Bah
 * Copyright (C) 2007 Johan Engelen
 * Copyright (C) 2005 Authors
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import {
  C_,
  DocumentUndo,
  GrPointType,
  getGradient,
  MeshCornerOperation,
  PaintTarget,
  Preferences,
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  type SPItem,
  SPMeshGradient,
  spReprCssAttrNew,
  spReprCssChangeRecursive,
  spReprCssSetProperty,
  spStyleSetPropertyUrl,
} from '@inkscape-web/core';
import { CubicBezier, nearest_time, type Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { GrDrag, ItemCurve } from '../../gradient-drag.ts';
import { Rubberband, RubberbandMode } from '../../rubberband.ts';
import {
  type ModifierState,
  mod_alt,
  mod_ctrl,
  mod_ctrl_only,
  mod_select_add_to,
  mod_shift,
  mod_shift_only,
  ToolBase,
} from './tool-base.ts';

const ICON = 'mesh-gradient';

/** gradient-create: Ctrl (create a mesh with a double click on exactly the selected items). */
const mod_gradient_create = (s: ModifierState) => mod_ctrl(s);
/** node-insert: Ctrl+Alt click on a mesh side splits its row or column. */
const mod_node_insert = (s: ModifierState) => mod_ctrl(s) && mod_alt(s);
/** select-remove-from: Shift+Alt. */
const mod_select_remove_from = (s: ModifierState) => mod_shift(s) && mod_alt(s);

/** Preference: create new meshes in the fill (FOR_FILL = 0, upstream default) or in the stroke. */
function new_fill_or_stroke(): PaintTarget {
  return Preferences.get().getInt('/tools/mesh/newfillorstroke', PaintTarget.FOR_FILL) as PaintTarget;
}

/** Helper function to determine if an item has a mesh or not. */
function has_mesh(item: SPItem | undefined): boolean {
  if (!item) return false;
  const server =
    new_fill_or_stroke() === PaintTarget.FOR_FILL
      ? item.style.getFillPaintServer()
      : item.style.getStrokePaintServer();
  return server instanceof SPMeshGradient;
}

/**
 * The mesh tool (upstream MeshTool): double click (or drag) on the selected objects to create a
 * mesh gradient; drag the corners, handles and tensors (GrDrag) to shape the mesh; double click
 * on a mesh side to split its row or column; the toolbar and keys (Alt+B, Alt+C, Alt+G, Alt+J,
 * Insert) act on the selected corners.
 * TODO: snapping, cursors, status bar messages, color picking (Alt+K), Tab to select the next
 * corner.
 */
export class MeshTool extends ToolBase {
  /** The desktop point of the button press. */
  origin: Point | null = null;
  dragging = false;
  /** The desktop point of the last test for a mesh side (upstream mousepoint_doc). */
  mousepoint_doc: Point | null = null;
  show_handles = true;
  edit_fill = true;
  edit_stroke = true;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/mesh');
    this.tolerance = 6;
    if (Preferences.get().getBool('/tools/mesh/selcue', true)) this.enableSelectionCue();
    this.enableGrDrag();
    this.sp_event_context_read('show_handles');
    this.sp_event_context_read('edit_fill');
    this.sp_event_context_read('edit_stroke');
  }

  override set(name: string): void {
    const prefs = Preferences.get();
    if (name === 'show_handles') this.show_handles = prefs.getBool('/tools/mesh/show_handles', true);
    else if (name === 'edit_fill') this.edit_fill = prefs.getBool('/tools/mesh/edit_fill', true);
    else if (name === 'edit_stroke') this.edit_stroke = prefs.getBool('/tools/mesh/edit_stroke', true);
  }

  /** The handles of the meshes of the selection (always enabled in this tool). */
  override get_drag(): GrDrag {
    return this._grdrag as GrDrag;
  }

  /**
   * Returns the mesh sides that the window point event_p is over; only the first if first is
   * true (upstream over_curve).
   */
  over_curve(event_p: Point, first = true): ItemCurve[] {
    // Translate mouse point into proper coord system: needed later.
    this.mousepoint_doc = this._desktopPoint(event_p);
    const pos = this._desktop.getCanvas().get_pos();
    const toWindow = (p: Point) => this._desktop.d2w(p).sub(pos);
    const selected: ItemCurve[] = [];
    for (const it of this.get_drag().item_curves) {
      if (!it.points) continue;
      const [p0, p1, p2, p3] = it.points.map(toWindow) as [Point, Point, Point, Point];
      const b = new CubicBezier(p0, p1, p2, p3);
      if (b.pointAt(nearest_time(event_p, b)).sub(event_p).length() <= this.tolerance) {
        selected.push(it);
        if (first) break;
      }
    }
    return selected;
  }

  /** Split row/column near the mouse point (desktop coordinates). */
  split_near_point(item: SPItem, mouse_p: Point): void {
    const drag = this.get_drag();
    drag.addStopNearPoint(item, mouse_p, this.tolerance / this._desktop.current_zoom());
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Split mesh row/column'), ICON);
    drag.updateDraggers();
  }

  /** Wrapper for various mesh operations that require a list of selected corner nodes. */
  corner_operation(operation: MeshCornerOperation): void {
    const drag = this.get_drag();
    // Get list of selected draggers for each mesh.
    const points = new Map<SPMeshGradient, number[]>();
    // For all selected draggers (a dragger may include draggables from different meshes).
    for (const dragger of drag.selected) {
      // For all draggables of dragger (a draggable corresponds to a unique mesh).
      for (const d of dragger.draggables) {
        // Only mesh corners
        if (d.point_type !== GrPointType.POINT_MG_CORNER) continue;
        // Find the gradient
        const gradient = getGradient(d.item, d.fill_or_stroke);
        if (!(gradient instanceof SPMeshGradient)) continue;
        // Collect points together for same gradient
        const list = points.get(gradient) ?? [];
        list.push(d.point_i);
        points.set(gradient, list);
      }
    }
    // Loop over meshes.
    for (const [mg, corners] of points) {
      if (!corners.length) continue;
      let noperation = 0;
      let message = '';
      switch (operation) {
        case MeshCornerOperation.MG_CORNER_SIDE_TOGGLE:
          noperation += mg.array.side_toggle(corners);
          message = C_('Undo', 'Toggled mesh path type.');
          break;
        case MeshCornerOperation.MG_CORNER_SIDE_ARC:
          noperation += mg.array.side_arc(corners);
          message = C_('Undo', 'Approximated arc for mesh side.');
          break;
        case MeshCornerOperation.MG_CORNER_TENSOR_TOGGLE:
          noperation += mg.array.tensor_toggle(corners);
          message = C_('Undo', 'Toggled mesh tensors.');
          break;
        case MeshCornerOperation.MG_CORNER_COLOR_SMOOTH:
          noperation += mg.array.color_smooth(corners);
          message = C_('Undo', 'Smoothed mesh corner color.');
          break;
        case MeshCornerOperation.MG_CORNER_INSERT:
          noperation += mg.array.insert(corners);
          message = C_('Undo', 'Inserted new row or column.');
          break;
        default:
          // TODO: MG_CORNER_COLOR_PICK (render the drawing under the mesh).
          console.error('sp_mesh_corner_operation: unknown operation');
      }
      if (noperation > 0) {
        mg.array.write(mg);
        mg.requestModified(SP_OBJECT_MODIFIED_FLAG);
        DocumentUndo.done(mg.document, message, ICON);
        // Don't create new draggers (but do for an insertion).
        if (operation !== MeshCornerOperation.MG_CORNER_INSERT) drag.local_change = true;
      }
    }
  }

  /** Scale mesh to just fit into bbox of selected items. */
  fit_mesh_in_bbox(): void {
    let changed = false;
    for (const item of this._desktop.getSelection().items()) {
      const fill = item.style.fill.isPaintserver() ? item.style.getFillPaintServer() : null;
      if (fill instanceof SPMeshGradient) {
        const item_bbox = item.geometricBounds();
        if (item_bbox && fill.array.fill_box(fill, item_bbox)) changed = true;
      }
      const stroke = item.style.stroke.isPaintserver() ? item.style.getStrokePaintServer() : null;
      if (stroke instanceof SPMeshGradient) {
        const item_bbox = item.visualBounds();
        if (item_bbox && stroke.array.fill_box(stroke, item_bbox)) changed = true;
      }
    }
    if (changed) {
      DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Fit mesh inside bounding box'), ICON);
    }
  }

  override root_handler(event: Event): boolean {
    const selection = this._desktop.getSelection();
    this.tolerance = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0), 100);
    const contains_mesh = !selection.isEmpty() && has_mesh(selection.items()[0]);
    const drag = this.get_drag();
    let ret = false;

    switch (event.type) {
      case 'dblclick': {
        const e = event as MouseEvent;
        if (e.button !== 0) break;
        // Double click:
        //  If over a mesh line, divide mesh row/column
        //  If not over a line and no mesh, create new mesh for top selected object.
        const over_curve = this.over_curve(this._windowPoint(e));
        const first = selection.items()[0];
        if (over_curve.length && contains_mesh && first && this.mousepoint_doc) {
          // We take the first item in selection, because with doubleclick, the first click
          // always resets selection to the single object under cursor
          this.split_near_point(first, this.mousepoint_doc);
        } else if (!contains_mesh) {
          // Create a new gradient with default coordinates.
          this.new_default();
        }
        ret = true;
        break;
      }
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        const w = this._windowPoint(e);
        // Are we over a mesh curve?
        const over_curve = this.over_curve(w, false);
        if (over_curve.length && contains_mesh) {
          for (const it of over_curve) {
            const fill_or_stroke = it.is_fill ? PaintTarget.FOR_FILL : PaintTarget.FOR_STROKE;
            const dragger0 = drag.getDraggerFor(
              it.item,
              GrPointType.POINT_MG_CORNER,
              it.corner0 ?? -1,
              fill_or_stroke,
            );
            const dragger1 = drag.getDraggerFor(
              it.item,
              GrPointType.POINT_MG_CORNER,
              it.corner1 ?? -1,
              fill_or_stroke,
            );
            const add = mod_select_add_to(e);
            const toggle = mod_select_remove_from(e);
            if (!add && !toggle) drag.deselectAll();
            if (dragger0) drag.setSelected(dragger0, true, !toggle);
            if (dragger1) drag.setSelected(dragger1, true, !toggle);
          }
          ret = true;
          break;
        }
        // Save drag origin
        this.saveDragOrigin(w);
        this.dragging = true;
        const button_dt = this._desktopPoint(w);
        // Check if object already has mesh... if it does,
        // don't create new mesh with click-drag.
        if (contains_mesh && !mod_gradient_create(e))
          Rubberband.get(this._desktop).start(this._desktop, button_dt);
        // remember clicked item, disregarding groups, honoring Alt; but do nothing
        // if we might be doing a create-doubleclick of exactly the selected item(s)
        if (!mod_gradient_create(e)) this.item_to_select = this._desktop.getItemAtPoint(w, true);
        this.origin = button_dt;
        this.grabCanvasEvents(e);
        ret = true;
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        if (this.dragging && e.buttons & 1) {
          const w = this._windowPoint(e);
          if (!this.checkDragMoved(w)) break;
          const rubberband = Rubberband.get(this._desktop);
          // For a mesh gradient, the gradient is always created to fill the object when the drag ends.
          if (rubberband.isStarted()) rubberband.move(this._desktopPoint(w));
          ret = true;
        }
        break;
      }
      case 'pointerup': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        this.xyp = null;
        this.ungrabCanvasEvents(e);
        const rubberband = Rubberband.get(this._desktop);
        // Check if over line
        const over_curve = this.over_curve(this._windowPoint(e));
        if (mod_node_insert(e)) {
          const it = over_curve[0];
          if (it && has_mesh(it.item) && this.mousepoint_doc) {
            this.split_near_point(it.item, this.mousepoint_doc);
            ret = true;
          }
        } else {
          this.dragging = false;
          // Unless clicked with intent to create (Ctrl+doubleclick by default).
          if (mod_gradient_create(e) && !mod_select_add_to(e)) {
            rubberband.stop();
            ret = true;
            break;
          }
          if (!this.within_tolerance) {
            // Check if object already has mesh... if it does,
            // don't create new mesh with click-drag.
            if (!contains_mesh) {
              this.new_default();
            } else {
              // we've been dragging, rubberband-select if we have rubberband
              const r = rubberband.getRectangle();
              if (rubberband.isStarted() && rubberband.getMode() === RubberbandMode.RECT && r) {
                if (!mod_select_add_to(e)) drag.deselectAll();
                drag.selectRect(r);
              }
            }
          } else if (this.item_to_select) {
            // Clicked on an existing mesh line, don't change selection. This stops
            // possible change in selection during a double click with overlapping objects.
            if (!over_curve.length) {
              // No dragging, select clicked item if any.
              if (mod_select_add_to(e)) {
                selection.toggle(this.item_to_select);
              } else {
                drag.deselectAll();
                selection.set(this.item_to_select);
              }
            }
          } else if (!over_curve.length) {
            // Click in an empty space; do the same as Esc.
            if (drag.selected.size) drag.deselectAll();
            else selection.clear();
          }
          this.item_to_select = null;
          ret = true;
        }
        rubberband.stop();
        break;
      }
      case 'keydown': {
        const e = event as KeyboardEvent;
        const withSelection = drag.isNonEmpty() && drag.hasSelection();
        switch (e.key) {
          case 'a':
          case 'A':
            if (mod_ctrl_only(e) && drag.isNonEmpty()) {
              drag.selectAll();
              ret = true;
            }
            break;
          case 'Escape':
            if (drag.selected.size) drag.deselectAll();
            else selection.clear();
            ret = true;
            //TODO: make dragging escapable by Esc
            break;
          // Mesh Operations --------------------------------------------
          case 'Insert':
            // with any modifiers:
            this.corner_operation(MeshCornerOperation.MG_CORNER_INSERT);
            ret = true;
            break;
          case 'i':
          case 'I':
            if (mod_shift_only(e)) {
              // Shift+I - insert corners (alternate keybinding for keyboards
              //           that don't have the Insert key)
              this.corner_operation(MeshCornerOperation.MG_CORNER_INSERT);
              ret = true;
            }
            break;
          case 'Delete':
          case 'Backspace':
            if (drag.selected.size) ret = true;
            break;
          default: {
            // Alt+B, C, G, J: toggle sides, arcs, tensors; smooth colors.
            const ops: Record<string, MeshCornerOperation> = {
              b: MeshCornerOperation.MG_CORNER_SIDE_TOGGLE,
              c: MeshCornerOperation.MG_CORNER_SIDE_ARC,
              g: MeshCornerOperation.MG_CORNER_TENSOR_TOGGLE,
              j: MeshCornerOperation.MG_CORNER_COLOR_SMOOTH,
            };
            // Alt changes e.key on macOS; use the physical key.
            const op = ops[e.code.replace(/^Key/, '').toLowerCase()];
            if (op !== undefined && mod_alt(e) && withSelection) {
              this.corner_operation(op);
              ret = true;
            }
            break;
          }
        }
        if (ret) e.preventDefault();
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  /** Creates a new mesh gradient on each selected item. */
  new_default(): void {
    const selection = this._desktop.getSelection();
    const document = this._desktop.getDocument();
    if (selection.isEmpty()) {
      // TODO: flash "Select <b>objects</b> on which to create gradient." in the status bar.
      return;
    }
    const prefs = Preferences.get();
    const fill_or_stroke_pref = new_fill_or_stroke();
    // Ensure that the preference show_handles is enable by default
    if (!prefs.isSet('/tools/mesh/show_handles')) prefs.setBool('/tools/mesh/show_handles', true);
    // Ensure mesh is immediately editable.
    // Editing both fill and stroke at same time doesn't work well so avoid.
    prefs.setBool('/tools/mesh/edit_fill', fill_or_stroke_pref === PaintTarget.FOR_FILL);
    prefs.setBool('/tools/mesh/edit_stroke', fill_or_stroke_pref !== PaintTarget.FOR_FILL);

    // HACK: reset fill-opacity - that 0.75 is annoying; BUT remove this when we have an opacity slider for all tabs
    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, 'fill-opacity', '1.0');
    const xml_doc = document.getReprDoc();
    const defs = document.getDefs();
    if (!defs) return;
    for (const item of selection.items()) {
      //FIXME: see above
      spReprCssChangeRecursive(item.getRepr(), css, 'style');
      // Create mesh element
      const repr = xml_doc.createElement('svg:meshgradient');
      // privates are garbage-collectable
      repr.setAttribute('inkscape:collect', 'always');
      // Attach to document
      defs.getRepr().appendChild(repr);
      // Get corresponding object
      const mg = document.getObjectByRepr(repr) as SPMeshGradient;
      mg.array.create(
        mg,
        item,
        fill_or_stroke_pref === PaintTarget.FOR_FILL ? item.geometricBounds() : item.visualBounds(),
      );
      spStyleSetPropertyUrl(
        item,
        fill_or_stroke_pref === PaintTarget.FOR_FILL ? 'fill' : 'stroke',
        mg,
        false,
      );
      item.requestModified(SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_STYLE_MODIFIED_FLAG);
    }
    DocumentUndo.done(document, C_('Undo', 'Create mesh'), ICON);
  }
}
