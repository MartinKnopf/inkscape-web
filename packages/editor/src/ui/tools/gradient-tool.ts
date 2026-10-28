// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/gradient-tool.cpp, src/ui/tools/gradient-tool.h
/*
 * Gradient drawing and editing tool
 *
 * Authors:
 *   bulia byak <buliabyak@users.sf.net>
 *   Johan Engelen <j.b.c.engelen@ewi.utwente.nl>
 *   Abhishek Sharma
 *
 * Copyright (C) 2007 Johan Engelen
 * Copyright (C) 2005 Authors
 */
import {
  C_,
  DocumentUndo,
  GrPointType,
  getGradient,
  PaintTarget,
  Preferences,
  SPGradient,
  SPGradientType,
  type SPItem,
  type SPStop,
  sp_get_stop_i,
  sp_gradient_add_stop,
  sp_gradient_get_forked_vector_if_necessary,
  sp_gradient_reset_to_userspace,
  sp_item_gradient_set_coords,
  sp_item_set_gradient,
  sp_last_stop,
  sp_repr_compare_position,
  sp_vector_add_stop,
  spReprCssAttrNew,
  spReprCssChangeRecursive,
  spReprCssSetProperty,
} from '@inkscape-web/core';
import { LineSegment, nearest_time, type Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import {
  sp_gradient_reverse_selected_gradients,
  sp_gradient_vector_for_object,
} from '../../gradient-chemistry.ts';
import type { GrDrag, GrDragger } from '../../gradient-drag.ts';
import { Rubberband, RubberbandMode } from '../../rubberband.ts';
import {
  type ModifierState,
  mod_alt,
  mod_ctrl,
  mod_ctrl_only,
  mod_select_add_to,
  mod_shift_only,
  ToolBase,
} from './tool-base.ts';

const ICON = 'color-gradient';

/** gradient-create: Ctrl (create a gradient with a double click on exactly the selected items). */
const mod_gradient_create = (s: ModifierState) => mod_ctrl(s);
/** node-insert: Ctrl+Alt click on a gradient line inserts a stop. */
const mod_node_insert = (s: ModifierState) => mod_ctrl(s) && mod_alt(s);

/** Preference: type of new gradients (SPGradientType, linear by default). */
export function gradient_tool_new_type(): SPGradientType {
  return Preferences.get().getInt('/tools/gradient/newgradient', SPGradientType.SP_GRADIENT_TYPE_LINEAR);
}

/** Preference: create new gradients in the fill (else the stroke). */
export function gradient_tool_new_fill_or_stroke(): PaintTarget {
  return Preferences.get().getInt('/tools/gradient/newfillorstroke', 1) !== 0
    ? PaintTarget.FOR_FILL
    : PaintTarget.FOR_STROKE;
}

/**
 * The gradient tool (upstream GradientTool): drag on the selected objects to create a linear or
 * radial gradient (/tools/gradient/newgradient); drag the handles (GrDrag) to move the start,
 * end and stops; double click on a gradient line to add a stop; Delete removes the selected stops.
 * TODO: snapping, cursors, status bar messages, Tab to select the next handle, simplify (Ctrl+L).
 */
export class GradientTool extends ToolBase {
  /** The desktop point of the button press. */
  origin: Point | null = null;
  dragging = false;
  /** The desktop point of the last test for a gradient line (upstream mousepoint_doc). */
  mousepoint_doc: Point | null = null;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/gradient');
    this.tolerance = 6;
    if (Preferences.get().getBool('/tools/gradient/selcue', true)) this.enableSelectionCue();
    this.enableGrDrag();
  }

  /** The handles of the gradients of the selection (always enabled in this tool). */
  override get_drag(): GrDrag {
    return this._grdrag as GrDrag;
  }

  /** The item whose gradient line is at window point event_p, or null. */
  is_over_curve(event_p: Point): SPItem | null {
    // Translate mouse point into proper coord system: needed later.
    this.mousepoint_doc = this._desktopPoint(event_p);
    const pos = this._desktop.getCanvas().get_pos();
    const toWindow = (p: Point) => this._desktop.d2w(p).sub(pos);
    for (const it of this.get_drag().item_curves) {
      const ls = new LineSegment(toWindow(it.p1), toWindow(it.p2));
      const nearest = ls.pointAt(nearest_time(event_p, ls));
      if (nearest.sub(event_p).length() <= this.tolerance) return it.item;
    }
    return null;
  }

  override root_handler(event: Event): boolean {
    const selection = this._desktop.getSelection();
    this.tolerance = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0), 100);
    const drag = this.get_drag();
    let ret = false;

    switch (event.type) {
      case 'dblclick': {
        const e = event as MouseEvent;
        if (e.button !== 0) break;
        const w = this._windowPoint(e);
        if (this.is_over_curve(w) && this.mousepoint_doc) {
          // we take the first item in selection, because with doubleclick, the first click
          // always resets selection to the single object under cursor
          const first = selection.items()[0];
          if (first) this.add_stop_near_point(first, this.mousepoint_doc);
        } else {
          const doc = this._desktop.getDocument();
          for (const item of selection.items()) {
            const fsmode = gradient_tool_new_fill_or_stroke();
            const vector = sp_gradient_vector_for_object(doc, this._desktop, item, fsmode);
            const priv = sp_item_set_gradient(item, vector, gradient_tool_new_type(), fsmode);
            sp_gradient_reset_to_userspace(priv, item);
          }
          DocumentUndo.done(doc, C_('Undo', 'Create default gradient'), ICON);
        }
        ret = true;
        break;
      }
      case 'pointerdown': {
        const e = event as PointerEvent;
        if (e.button !== 0) break;
        const w = this._windowPoint(e);
        this.saveDragOrigin(w);
        this.dragging = true;
        const button_dt = this._desktopPoint(w);
        if (mod_select_add_to(e) && !mod_gradient_create(e)) {
          Rubberband.get(this._desktop).start(this._desktop, button_dt);
        } else {
          // remember clicked item, disregarding groups, honoring Alt; do nothing with Crtl to
          // enable Ctrl+doubleclick of exactly the selected item(s)
          if (!mod_gradient_create(e)) this.item_to_select = this._desktop.getItemAtPoint(w, true);
          this.origin = button_dt;
        }
        this.grabCanvasEvents(e);
        ret = true;
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        if (this.dragging && e.buttons & 1) {
          const w = this._windowPoint(e);
          if (!this.checkDragMoved(w)) break;
          const motion_dt = this._desktopPoint(w);
          const rubberband = Rubberband.get(this._desktop);
          if (rubberband.isStarted()) rubberband.move(motion_dt);
          else if (!drag.grabbedMotion(motion_dt, e)) this.drag(motion_dt, e);
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
        // the end of the drag that created a gradient
        if (drag.grabbedRelease(e)) {
          this.dragging = false;
          this.item_to_select = null;
          rubberband.stop();
          ret = true;
          break;
        }
        const w = this._windowPoint(e);
        const item = this.is_over_curve(w);
        if (mod_node_insert(e)) {
          if (item && this.mousepoint_doc) {
            this.add_stop_near_point(item, this.mousepoint_doc);
            ret = true;
          }
        } else {
          this.dragging = false;
          // unless clicked with intent to create (to enable Ctrl+doubleclick).
          if (mod_gradient_create(e) && !mod_select_add_to(e)) {
            rubberband.stop();
            ret = true;
            break;
          }
          if (!this.within_tolerance) {
            // we've been dragging, either do nothing (grdrag handles that),
            // or rubberband-select if we have rubberband
            const r = rubberband.getRectangle();
            if (rubberband.isStarted() && rubberband.getMode() === RubberbandMode.RECT && r) {
              // this was a rubberband drag
              drag.selectRect(r);
            }
          } else if (this.item_to_select) {
            if (!item) {
              // no dragging, select clicked item if any
              if (mod_select_add_to(e)) {
                selection.toggle(this.item_to_select);
              } else {
                drag.deselectAll();
                selection.set(this.item_to_select);
              }
            }
            // Clicked on an existing gradient line, don't change selection. This stops
            // possible change in selection during a double click with overlapping objects
          } else {
            // click in an empty space; do the same as Esc
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
          case 'r':
          case 'R':
            if (mod_shift_only(e)) {
              sp_gradient_reverse_selected_gradients(this._desktop);
              ret = true;
            }
            break;
          case 'Insert':
            // with any modifiers:
            this.add_stops_between_selected_stops();
            ret = true;
            break;
          case 'i':
          case 'I':
            if (mod_shift_only(e)) {
              // Shift+I - insert stops (alternate keybinding for keyboards
              //           that don't have the Insert key)
              this.add_stops_between_selected_stops();
              ret = true;
            }
            break;
          case 'Delete':
          case 'Backspace':
            ret = this.deleteSelectedDrag(mod_ctrl_only(e));
            break;
          default:
            break;
        }
        if (ret) e.preventDefault();
        break;
      }
    }
    return ret || super.root_handler(event);
  }

  /** Add a stop near mouse_p (desktop coordinates) on the gradient line of item, and select it. */
  add_stop_near_point(item: SPItem, mouse_p: Point): void {
    const drag = this.get_drag();
    const newstop = drag.addStopNearPoint(item, mouse_p, this.tolerance / this._desktop.current_zoom());
    DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Add gradient stop'), ICON);
    drag.updateDraggers();
    drag.local_change = true;
    drag.selectByStop(newstop);
  }

  /** Add a stop between each pair of adjacent selected stops, or after the single selected stop. */
  add_stops_between_selected_stops(): void {
    const drag = this.get_drag();
    const first = drag.selected.values().next().value;
    const draggable = first?.draggables[0];
    if (draggable) {
      const gradient = getGradient(draggable.item, draggable.fill_or_stroke);
      const vector = gradient && sp_gradient_get_forked_vector_if_necessary(gradient, false);
      // Treat single stop gradients separately.
      if (gradient && vector?.getStopCount() === 1) {
        const newstop = sp_gradient_add_stop(vector, vector.getFirstStop());
        gradient.ensureVector();
        drag.updateDraggers();
        drag.local_change = true;
        drag.selectByStop(newstop);
        DocumentUndo.done(gradient.document, C_('Undo', 'Add gradient stop'), ICON);
        return;
      }
    }
    const pairs = get_stop_intervals(drag);
    if (!pairs.length && drag.numSelected() === 1 && first) {
      // if a single stop is selected, add between that stop and the next one
      for (const d of first.draggables) {
        // There are 2 draggables at the center (start) of a radial gradient
        // To avoid creating 2 separate stops, ignore this draggable point type
        if (d.point_type === GrPointType.POINT_RG_FOCUS) continue;
        // Mark the second-to-last stop as the current stop if the last gradient point is
        // selected to insert a stop.
        const last =
          d.point_type === GrPointType.POINT_LG_END ||
          d.point_type === GrPointType.POINT_RG_R1 ||
          d.point_type === GrPointType.POINT_RG_R2;
        const gradient = getGradient(d.item, d.fill_or_stroke);
        if (!gradient) continue;
        const vector = sp_gradient_get_forked_vector_if_necessary(gradient, false);
        const this_stop = sp_get_stop_i(vector, last ? d.point_i - 1 : d.point_i);
        const next_stop = this_stop?.getNextStop();
        if (this_stop && next_stop) pairs.push([this_stop, next_stop]);
      }
    }
    // now actually create the new stops
    const new_stops: SPStop[] = [];
    for (const [this_stop, next_stop] of pairs.reverse()) {
      const grad = this_stop.parent;
      if (!(grad instanceof SPGradient)) continue;
      const new_stop = sp_vector_add_stop(
        grad,
        this_stop,
        next_stop,
        (this_stop.offset + next_stop.offset) / 2,
      );
      if (new_stop) new_stops.push(new_stop);
      grad.ensureVector();
    }
    if (new_stops.length) {
      DocumentUndo.done(this._desktop.getDocument(), C_('Undo', 'Add gradient stop'), ICON);
      drag.updateDraggers();
      // so that it does not automatically update draggers in idle loop, as this would deselect
      drag.local_change = true;
      // select the newly created stops
      for (const s of new_stops) drag.selectByStop(s);
    }
  }

  /** Creates a new linear or radial gradient from the press point to pt on the selected items. */
  drag(pt: Point, state: ModifierState): void {
    const selection = this._desktop.getSelection();
    const document = this._desktop.getDocument();
    if (selection.isEmpty() || !this.origin) {
      // TODO: flash "Select <b>objects</b> on which to create gradient." in the status bar.
      return;
    }
    const type = gradient_tool_new_type();
    const fill_or_stroke = gradient_tool_new_fill_or_stroke();
    let vector: SPGradient;
    if (this.item_to_select) {
      // pick color from the object where drag started
      vector = sp_gradient_vector_for_object(document, this._desktop, this.item_to_select, fill_or_stroke);
    } else {
      // Starting from empty space:
      // Sort items so that the topmost comes last; take topmost
      const items = [...selection.items()].sort((a, b) => sp_repr_compare_position(a.getRepr(), b.getRepr()));
      vector = sp_gradient_vector_for_object(document, this._desktop, items.at(-1) ?? null, fill_or_stroke);
    }
    // HACK: reset fill-opacity - that 0.75 is annoying; BUT remove this when we have an opacity slider for all tabs
    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, 'fill-opacity', '1.0');
    for (const item of selection.items()) {
      //FIXME: see above
      spReprCssChangeRecursive(item.getRepr(), css, 'style');
      sp_item_set_gradient(item, vector, type, fill_or_stroke);
      if (type === SPGradientType.SP_GRADIENT_TYPE_LINEAR) {
        sp_item_gradient_set_coords(
          item,
          GrPointType.POINT_LG_BEGIN,
          0,
          this.origin,
          fill_or_stroke,
          true,
          false,
        );
        sp_item_gradient_set_coords(item, GrPointType.POINT_LG_END, 0, pt, fill_or_stroke, true, false);
      } else {
        sp_item_gradient_set_coords(
          item,
          GrPointType.POINT_RG_CENTER,
          0,
          this.origin,
          fill_or_stroke,
          true,
          false,
        );
        sp_item_gradient_set_coords(item, GrPointType.POINT_RG_R1, 0, pt, fill_or_stroke, true, false);
      }
      item.requestModified(1 /* SP_OBJECT_MODIFIED_FLAG */);
    }
    const drag = this.get_drag();
    drag.updateDraggers();
    // prevent regenerating draggers by selection modified signal, which sometimes
    // comes too late and thus destroys the knot which we will now grab:
    drag.local_change = true;
    // give the grab out-of-bounds values of xp/yp because we're already dragging
    // and therefore are already out of tolerance
    const first = selection.items()[0];
    if (first) {
      drag.grabKnot(
        first,
        type === SPGradientType.SP_GRADIENT_TYPE_LINEAR ? GrPointType.POINT_LG_END : GrPointType.POINT_RG_R1,
        -1, // ignore number (though it is always 1)
        fill_or_stroke,
      );
      drag.grabbedMotion(pt, state);
    }
    // We did an undoable action, but SPDocumentUndo::done will be called by the knot when released
  }
}

/** Pairs of adjacent stops whose draggers are both selected (upstream get_stop_intervals). */
function get_stop_intervals(drag: GrDrag): [SPStop, SPStop][] {
  const result: [SPStop, SPStop][] = [];
  // for all selected draggers
  for (const dragger of drag.selected) {
    // for all draggables of dragger
    for (const d of dragger.draggables) {
      // these draggable types cannot have a next draggable to insert a stop between them
      if (
        d.point_type === GrPointType.POINT_LG_END ||
        d.point_type === GrPointType.POINT_RG_FOCUS ||
        d.point_type === GrPointType.POINT_RG_R1 ||
        d.point_type === GrPointType.POINT_RG_R2
      ) {
        continue;
      }
      // find the gradient
      const gradient = getGradient(d.item, d.fill_or_stroke);
      if (!gradient) continue;
      const vector = sp_gradient_get_forked_vector_if_necessary(gradient, false);
      // from draggables to stops
      const this_stop = sp_get_stop_i(vector, d.point_i);
      const next_stop = this_stop?.getNextStop();
      if (!this_stop || !next_stop) continue;
      const last_stop = sp_last_stop(vector);
      const { item, fill_or_stroke: fs, point_type: type, point_i: p_i } = d;
      // find its dragger
      // (complex because it may have different types, and because in radial,
      // more than one dragger may correspond to a stop, so we must distinguish)
      let dnext: GrDragger | null = null;
      const isLast = next_stop === last_stop;
      if (type === GrPointType.POINT_LG_BEGIN || type === GrPointType.POINT_LG_MID) {
        dnext = drag.getDraggerFor(
          item,
          isLast ? GrPointType.POINT_LG_END : GrPointType.POINT_LG_MID,
          p_i + 1,
          fs,
        );
      } else {
        // radial
        if (type === GrPointType.POINT_RG_CENTER || type === GrPointType.POINT_RG_MID1) {
          dnext = drag.getDraggerFor(
            item,
            isLast ? GrPointType.POINT_RG_R1 : GrPointType.POINT_RG_MID1,
            p_i + 1,
            fs,
          );
        }
        if (
          type === GrPointType.POINT_RG_MID2 ||
          (type === GrPointType.POINT_RG_CENTER && dnext && !dnext.isSelected())
        ) {
          dnext = drag.getDraggerFor(
            item,
            isLast ? GrPointType.POINT_RG_R2 : GrPointType.POINT_RG_MID2,
            p_i + 1,
            fs,
          );
        }
      }
      // if both adjacent draggers selected,
      if (!result.some(([s]) => s === this_stop) && dnext?.isSelected()) result.push([this_stop, next_stop]);
    }
  }
  return result;
}
