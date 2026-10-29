// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/eraser-tool.cpp, src/ui/tools/eraser-tool.h
/*
 * Eraser drawing mode
 *
 * Authors:
 *   Mitsuru Oka <oka326@parkcity.ne.jp>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   MenTaLguY <mental@rydia.net>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *   Rafael Siejakowski <rs@rs-math.net>
 *
 * The original dynadraw code:
 *   Paul Haeberli <paul@sgi.com>
 *
 * Copyright (C) 1998 The Free Software Foundation
 * Copyright (C) 1999-2005 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 * Copyright (C) 2005-2007 bulia byak
 * Copyright (C) 2006 MenTaLguY
 * Copyright (C) 2008 Jon A. Cruz
 */
import {
  breakApart,
  C_,
  combine,
  DocumentUndo,
  ObjectSet,
  Preferences,
  pathBoolopBackend,
  pathCut,
  pathDiff,
  pathUnion,
  type SPDocument,
  SPGroup,
  SPImage,
  SPItem,
  SPPath,
  SPRect,
  SPShape,
  SPUse,
  SPWindRule,
  sp_item_list_to_curves,
  sp_svg_write_path,
  spReprCssAttrNew,
  spReprCssSetProperty,
  type Node as XmlNode,
} from '@inkscape-web/core';
import {
  are_near,
  bezier_fit_cubic_r,
  type Curve,
  L2,
  lerp,
  middle_point,
  Path,
  type PathVector,
  Point,
  rot90,
  write_svg_path,
} from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import {
  sp_desktop_get_color_tool,
  sp_desktop_get_master_opacity_tool,
  sp_desktop_get_opacity_tool,
  sp_desktop_set_style,
} from '../../desktop-style.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import { Rubberband, RubberbandMode, RubberbandTouchpathHandle } from '../../rubberband.ts';
import {
  append_cubic,
  append_line,
  append_stitched,
  DynamicBase,
  type ExtendedInput,
  extinput_from_event,
  SAMPLING_SIZE,
} from './dynamic-base.ts';

export enum EraserToolMode {
  DELETE,
  CUT,
  CLIP,
}
export const DEFAULT_ERASER_MODE = EraserToolMode.CUT;

/** Represents an item to erase */
interface EraseTarget {
  /** The item to be erased */
  item: SPItem | null;
  /** Whether the item was part of selection */
  was_selected: boolean;
}

const trace_color_rgba = 0xff0000ff; // RGBA red
const trace_wind_rule = SPWindRule.SP_WIND_RULE_EVENODD;

const tolerance = 0.1;

const epsilon = 0.5e-6;
const epsilon_start = 0.5e-2;
const vel_start = 1e-5;

const min_pressure = 0.0;
const max_pressure = 1.0;
const default_pressure = 1.0;

const min_tilt = -1.0;
const max_tilt = 1.0;
const default_tilt = 0.0;

// Error flags of _uncuttableItemType.
const ALL_GOOD = 0x0;
const NON_EXISTENT = 0x1 << 1;
const NO_AREA_PATH = 0x1 << 2;
const RASTER_IMAGE = 0x1 << 3;

const BEZIER_SIZE = 4;
const MAX_BEZIERS = 8;

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** The unit tangent of the curve at its start (t = 0) or end (t = 1) (upstream Curve::unitTangentAt). */
function unit_tangent_at(c: Curve, t: number): Point {
  const d = 1e-6;
  const v = t < 0.5 ? c.pointAt(t + d).sub(c.pointAt(t)) : c.pointAt(t).sub(c.pointAt(t - d));
  return v.isZero() ? v : v.normalized();
}

/**
 * The exact shape of item in document coordinates (upstream
 * SPItem::documentExactBounds): the curve of a shape, else its visual bounding box.
 */
export function documentExactBounds(item: SPItem): PathVector | null {
  if (item instanceof SPShape) {
    const curve = item.curve();
    return curve ? curve.map((p) => p.transformed(item.i2docAffine())) : null;
  }
  const r = item.visualBounds();
  return r ? [Path.fromRect(r).transformed(item.i2docAffine())] : null;
}

/** Whether the exact shape of item overlaps shape (upstream SPItem::collidesWith). */
export function collidesWith(item: SPItem, shape: PathVector): boolean {
  const our_shape = documentExactBounds(item);
  return our_shape
    ? pathBoolopBackend().pathsOverlap(write_svg_path(our_shape), write_svg_path(shape))
    : false;
}

/**
 * The eraser tool (upstream EraserTool). The stroke is drawn like a
 * calligraphic stroke. In delete mode the objects touched by the pointer are
 * deleted; in cut mode the stroke is cut out of the paths and shapes it
 * overlaps (boolean difference; a stroke of width 0 divides them); in clip
 * mode it is cut out of the clip path of the objects. With a selection, only
 * selected objects are erased. Pressure and tilt come from PointerEvent.
 * TODO: status bar messages, LPE items (removeLPESRecursive), cursor.
 */
export class EraserTool extends DynamicBase {
  mode = DEFAULT_ERASER_MODE;
  nowidth = false;
  /** The eraser stroke inserted into the document while erasing. */
  _acid: SPItem | null = null;
  /** The items to select after erasing. */
  _survivors: SPItem[] = [];

  /** canvas item for red "leading" segment */
  currentshape: CanvasItemBpath;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/eraser');
    this.currentshape = new CanvasItemBpath(desktop.getCanvasTemp());
    this.currentshape.set_stroke(0x0);
    this.currentshape.set_fill(trace_color_rgba, trace_wind_rule);

    for (const name of [
      'mass',
      'wiggle',
      'angle',
      'width',
      'thinning',
      'tremor',
      'flatness',
      'tracebackground',
      'usepressure',
      'usetilt',
      'abs_width',
      'cap_rounding',
    ]) {
      this.sp_event_context_read(name);
    }

    this.is_drawing = false;
    this._updateMode();
    this.enableSelectionCue();
  }

  override destroy(): void {
    this.ungrabCanvasEvents();
    this.currentshape.unlink();
    super.destroy();
  }

  override set(name: string): void {
    if (name === 'mode') this._updateMode();
    else super.set(name);
  }

  /** Reads the current Eraser mode from Preferences and sets `mode` accordingly. */
  _updateMode(): void {
    const mode_idx = clamp(Preferences.get().getInt('/tools/eraser/mode', 1), 0, 2);
    // Note: the integer indices must agree with those in EraserToolbar
    this.mode =
      [EraserToolMode.DELETE, EraserToolMode.CUT, EraserToolMode.CLIP][mode_idx] ?? DEFAULT_ERASER_MODE;
  }

  _reset(p: Point): void {
    this.last = this.cur = this.getNormalizedPoint(p);
    this.vel = new Point(0, 0);
    this.vel_max = 0;
    this.acc = new Point(0, 0);
    this.ang = new Point(0, 0);
    this.del = new Point(0, 0);
  }

  _extinput(ext: ExtendedInput): void {
    this.pressure =
      ext.pressure !== undefined ? clamp(ext.pressure, min_pressure, max_pressure) : default_pressure;
    this.xtilt = ext.xtilt !== undefined ? clamp(ext.xtilt, min_tilt, max_tilt) : default_tilt;
    this.ytilt = ext.ytilt !== undefined ? clamp(ext.ytilt, min_tilt, max_tilt) : default_tilt;
  }

  _apply(p: Point): boolean {
    /* Calculate force and acceleration */
    const n = this.getNormalizedPoint(p);
    const force = n.sub(this.cur);

    // If force is below the absolute threshold `epsilon`,
    // or we haven't yet reached `vel_start` (i.e. at the beginning of stroke)
    // _and_ the force is below the (higher) `epsilon_start` threshold,
    // discard this move.
    // This prevents flips, blobs, and jerks caused by microscopic tremor of the tablet pen,
    // especially bothersome at the start of the stroke where we don't yet have the inertia to
    // smooth them out.
    if (L2(force) < epsilon || (this.vel_max < vel_start && L2(force) < epsilon_start)) return false;

    // Calculate mass
    const m = lerp(this.mass, 1.0, 160.0);
    this.acc = force.div(m);
    this.vel = this.vel.add(this.acc); // Calculate new velocity
    const speed = L2(this.vel);

    if (speed > this.vel_max) {
      this.vel_max = speed;
    } else if (speed < epsilon) {
      return false; // return early if movement is insignificant
    }

    /* Calculate angle of eraser tool */
    let angle_fixed = 0.0;
    if (this.usetilt) {
      // 1a. calculate nib angle from input device tilt:
      if (this.ytilt !== 0 || this.xtilt !== 0) angle_fixed = Math.atan2(this.xtilt, this.ytilt);
    } else {
      // 1b. fixed angle (absolutely flat nib):
      angle_fixed = (this.angle * Math.PI) / 180.0; // convert to radians
    }
    if (this.flatness < 0.0) {
      // flips direction. Useful when usetilt is true
      // allows simulating both pen/charcoal and broad-nibbed pen
      angle_fixed *= -1;
    }

    // 2. Angle perpendicular to vel (absolutely non-flat nib):
    const perp = rot90(this.vel);
    let angle_dynamic = Math.atan2(perp.y, perp.x);
    // flip angle_dynamic to force it to be in the same half-circle as angle_fixed
    let flipped = false;
    if (Math.abs(angle_dynamic - angle_fixed) > Math.PI / 2) {
      angle_dynamic += Math.PI;
      flipped = true;
    }
    // normalize angle_dynamic
    if (angle_dynamic > Math.PI) angle_dynamic -= 2 * Math.PI;
    if (angle_dynamic < -Math.PI) angle_dynamic += 2 * Math.PI;

    // 3. Average them using flatness parameter:
    // find the flatness-weighted bisector angle, unflip if angle_dynamic was flipped
    // FIXME: when `vel` is oscillating around the fixed angle, the new_ang flips back and forth.
    // How to avoid this?
    const new_ang = lerp(Math.abs(this.flatness), angle_dynamic, angle_fixed) - (flipped ? Math.PI : 0);

    // Try to detect a sudden flip when the new angle differs too much from the previous for the
    // current velocity; in that case discard this move
    const angle_delta = L2(new Point(Math.cos(new_ang), Math.sin(new_ang)).sub(this.ang));
    if (angle_delta / speed > 4000) return false;

    // convert to point
    this.ang = new Point(Math.cos(new_ang), Math.sin(new_ang));

    /* Apply drag */
    const d = lerp(this.drag * this.drag, 0.0, 0.5);
    this.vel = this.vel.mul(1.0 - d);

    /* Update position */
    this.last = this.cur;
    this.cur = this.cur.add(this.vel);

    return true;
  }

  _brush(): void {
    // How much velocity thins strokestyle
    const vel_thinning = lerp(this.vel_thin, 0, 160);

    // Influence of pressure on thickness
    const pressure_thick = this.usepressure ? this.pressure : 1.0;

    // get the real brush point, not the same as pointer (affected by mass drag)
    const brush = this.getViewPoint(this.cur);

    const trace_thick = 1;
    const speed = L2(this.vel);
    let effective_width = (pressure_thick * trace_thick - vel_thinning * speed) * this.width;

    let tremble_left = 0;
    let tremble_right = 0;
    if (this.tremor > 0) {
      // obtain two normally distributed random variables, using polar Box-Muller transform
      const [y1, y2] = EraserTool._generateNormalDist2();

      // deflect both left and right edges randomly and independently, so that:
      // (1) tremor=1 corresponds to sigma=1, decreasing tremor narrows the bell curve;
      // (2) deflection depends on width, but is upped for small widths for better visual uniformity across widths;
      // (3) deflection somewhat depends on speed, to prevent fast strokes looking
      //     comparatively smooth and slow ones excessively jittery
      const width_coefficient = 0.15 + 0.8 * effective_width;
      const speed_coefficient = 0.35 + 14 * speed;
      const total_coefficient = this.tremor * width_coefficient * speed_coefficient;

      tremble_left = y1 * total_coefficient;
      tremble_right = y2 * total_coefficient;
    }

    const min_width = 0.02 * this.width;
    if (effective_width < min_width) effective_width = min_width;

    let dezoomify_factor = 0.05 * 1000;
    if (!this.abs_width) dezoomify_factor /= this._desktop.current_zoom();

    const del_left = this.ang.mul(dezoomify_factor * (effective_width + tremble_left));
    const del_right = this.ang.mul(dezoomify_factor * (effective_width + tremble_right));

    this.point1[this.npoints] = brush.add(del_left);
    this.point2[this.npoints] = brush.sub(del_right);

    if (this.nowidth) {
      this.point1[this.npoints] = middle_point(
        this.point1[this.npoints] as Point,
        this.point2[this.npoints] as Point,
      );
    }
    this.del = middle_point(del_left, del_right);

    this.npoints++;
  }

  /** Two normally distributed random numbers (polar Box-Muller transform). */
  static _generateNormalDist2(): [number, number] {
    let x1: number;
    let x2: number;
    let w: number;
    do {
      x1 = 2.0 * Math.random() - 1.0;
      x2 = 2.0 * Math.random() - 1.0;
      w = x1 * x1 + x2 * x2;
    } while (w >= 1.0 || w === 0);
    w = Math.sqrt((-2.0 * Math.log(w)) / w);
    return [x1 * w, x2 * w];
  }

  _cancel(): void {
    this.dragging = false;
    this.is_drawing = false;
    this.ungrabCanvasEvents();

    this.#clearSegments();

    /* reset accumulated curve */
    this.accumulated.clear();
    this._clearCurrent();
    this.repr = null;
  }

  override root_handler(event: Event): boolean {
    let ret = false;
    switch (event.type) {
      case 'pointerdown':
        ret = this.#onButtonPress(event as PointerEvent);
        break;
      case 'pointermove':
        ret = this.#onMotion(event as PointerEvent);
        break;
      case 'pointerup':
        ret = this.#onButtonRelease(event as PointerEvent);
        break;
      case 'keydown':
        ret = this._handleKeypress(event as KeyboardEvent);
        if (ret) event.preventDefault();
        break;
    }
    return ret || super.root_handler(event);
  }

  #onButtonPress(event: PointerEvent): boolean {
    if (event.button !== 0) return false;
    if (!have_viable_layer(this._desktop)) return false;

    const button_dt = this._desktopPoint(this._windowPoint(event));

    this._reset(button_dt);
    this._extinput(extinput_from_event(event));
    this._apply(button_dt);
    this.accumulated.clear();

    this.repr = null;

    if (this.mode === EraserToolMode.DELETE) {
      const rubberband = Rubberband.get(this._desktop);
      rubberband.setMode(RubberbandMode.TOUCHPATH);
      rubberband.setHandle(RubberbandTouchpathHandle.RUBBERBAND_TOUCHPATH_ERASER);
      rubberband.start(this._desktop, button_dt);
    }
    /* initialize first point */
    this.npoints = 0;

    this.grabCanvasEvents(event);
    this.is_drawing = true;
    return true;
  }

  #onMotion(event: PointerEvent): boolean {
    let ret = false;
    const motion_dt = this._desktopPoint(this._windowPoint(event));

    if (this.is_drawing && event.buttons & 1) {
      this.dragging = true;

      const handle_motion = (pt: Point) => {
        if (!this._apply(pt)) return;
        if (!this.cur.equals(this.last)) {
          this._brush();
          this._fitAndSplit(false);
        }
      };

      // The coalesced events since the last motion event (upstream event.history).
      const history = event.getCoalescedEvents?.() ?? [];
      for (const hist of history.slice(0, -1)) {
        this._extinput(extinput_from_event(hist));
        handle_motion(this._desktopPoint(this._windowPoint(hist)));
      }
      this._extinput(extinput_from_event(event));
      handle_motion(motion_dt);

      ret = true;
    }
    if (this.mode === EraserToolMode.DELETE) {
      this.accumulated.clear();
      Rubberband.get(this._desktop).move(motion_dt);
    }
    return ret;
  }

  #onButtonRelease(event: PointerEvent): boolean {
    if (event.button !== 0) return false;
    let ret = false;

    const motion_dt = this._desktopPoint(this._windowPoint(event));

    this.ungrabCanvasEvents(event);

    this.is_drawing = false;

    if (this.dragging) {
      this.dragging = false;

      this._apply(motion_dt);
      this.#clearSegments();

      // Create eraser stroke shape
      this._fitAndSplit(true);
      this._accumulate();

      // Perform the actual erase operation
      const document = this._desktop.getDocument();
      if (this._doWork()) {
        DocumentUndo.done(document, C_('Undo', 'Draw eraser stroke'), 'draw-eraser');
      } else {
        DocumentUndo.cancel(document);
      }

      /* reset accumulated curve */
      this.accumulated.clear();

      this._clearCurrent();
      this.repr = null;
      ret = true;
    }

    if (this.mode === EraserToolMode.DELETE) {
      const r = Rubberband.get(this._desktop);
      if (r.isStarted()) r.stop();
    }
    return ret;
  }

  /** Analyses and handles a key press event, returns true if processed, false if not. */
  _handleKeypress(key: KeyboardEvent): boolean {
    const just_ctrl = (key.ctrlKey || key.metaKey) && !key.altKey && !key.shiftKey;
    const prefs = Preferences.get();
    // The toolbar shows the width as a percentage of the visible area.
    const set_width = (w: number) => prefs.setDouble('/tools/eraser/width', w * 100);

    switch (key.key) {
      case 'ArrowRight':
        if (!just_ctrl) {
          this.width = Math.min(this.width + 0.01, 1.0);
          // Alt+X sets focus to this spinbutton as well
          set_width(this.width);
          return true;
        }
        break;
      case 'ArrowLeft':
        if (!just_ctrl) {
          this.width = Math.max(this.width - 0.01, 0.01);
          set_width(this.width);
          return true;
        }
        break;
      case 'Home':
        this.width = 0.01;
        set_width(this.width);
        return true;
      case 'End':
        this.width = 1.0;
        set_width(this.width);
        return true;
      case 'Escape':
        if (this.mode === EraserToolMode.DELETE) Rubberband.get(this._desktop).stop();
        if (this.is_drawing) {
          // if drawing, cancel, otherwise pass it up for deselecting
          this._cancel();
          return true;
        }
        break;
      case 'z':
      case 'Z':
        if (just_ctrl && this.is_drawing) {
          // Ctrl+Z pressed while drawing
          this._cancel();
          return true;
        } // if not drawing, pass it up for undo
        break;
    }
    return false;
  }

  /**
   * Inserts the temporary red shape of the eraser stroke (the "acid") into the document.
   * @return the inserted item
   */
  _insertAcidIntoDocument(document: SPDocument): SPItem | null {
    const repr = this.repr;
    const top_layer = this._desktop.layerManager().currentRoot();
    if (!repr || !top_layer) return null;
    const eraser_item = top_layer.appendChildRepr(repr);
    if (!(eraser_item instanceof SPItem)) return null;
    eraser_item.updateRepr();
    const pathv = [
      this.accumulated.transformed(this._desktop.dt2doc().multiply(eraser_item.i2docAffine().inverse())),
    ];
    repr.setAttribute('d', sp_svg_write_path(pathv));
    const item = document.getObjectByRepr(repr);
    return item instanceof SPItem ? item : null;
  }

  _clearCurrent(): void {
    // reset bpath
    this.currentshape.set_bpath([]);

    // reset curve
    this.currentcurve.clear();
    this.cal1.clear();
    this.cal2.clear();

    // reset points
    this.npoints = 0;
  }

  /**
   * Performs the actual erase operation against the current document.
   * @return whether actual erasing took place (and undo history should be updated).
   */
  _doWork(): boolean {
    if (this.accumulated.empty()) {
      this.repr?.parent()?.removeChild(this.repr);
      this.repr = null;
      return false;
    }

    const document = this._desktop.getDocument();
    if (!this.repr) {
      // Create eraser repr
      const eraser_repr = document.getReprDoc().createElement('svg:path');
      this._desktop.applyCurrentOrToolStyle(eraser_repr, '/tools/eraser', false);
      this.repr = eraser_repr;
    }

    const selection = this._desktop.getSelection();
    const was_selection = !selection.isEmpty();

    // Find items to work on as well as items that will be needed to restore the selection afterwards.
    this._survivors = [];

    const to_erase = this._findItemsToErase();

    let work_done = false;
    if (to_erase.length) {
      selection.clear();
      work_done = this._performEraseOperation(to_erase, true);

      if (was_selection && this._survivors.length) {
        // Discard survivors which have since been deleted.
        selection.setList(this._survivors.filter((s) => s.document && s.parent));
      }
    }
    // Clean up the eraser stroke repr:
    this.repr?.parent()?.removeChild(this.repr);
    this.repr = null;
    this._acid = null;
    return work_done;
  }

  /**
   * Erases from a shape by cutting (boolean difference or cut operation).
   * @return whether the target was successfully processed.
   */
  _cutErase(target: EraseTarget, store_survivors: boolean): boolean {
    // If the item is a clone, we check if the original is cuttable before unlinking it
    if (target.item instanceof SPUse) {
      const use = target.item;
      const original = use.trueOriginal();
      if (EraserTool._uncuttableItemType(original)) {
        if (store_survivors && target.was_selected) this._survivors.push(target.item);
        return false;
      }
      if (original instanceof SPGroup) {
        return this._probeUnlinkCutClonedGroup(target, use, original, store_survivors);
      }
      // A simple clone of a cuttable item: unlink and erase it.
      target = { ...target, item: use.unlink() };
      if (target.was_selected && store_survivors && target.item) {
        // Reselect the freshly unlinked item
        this._survivors.push(target.item);
      }
    }
    return this._booleanErase(target, store_survivors);
  }

  /**
   * Analyses a cloned group and decides if the CUT mode should unlink the clone: only if
   * the eraser stroke overlaps something in the group that can be erased in CUT mode (in
   * the clone's coordinates). Then the clone is unlinked and the new group is erased.
   * @return whether the clone was unlinked and something was erased from the resulting new group.
   */
  _probeUnlinkCutClonedGroup(
    original_target: EraseTarget,
    clone: SPUse,
    cloned_group: SPGroup,
    store_survivors = true,
  ): boolean {
    const children: EraseTarget[] = cloned_group
      .childList()
      .filter((c): c is SPItem => c instanceof SPItem)
      .map((item) => ({ item, was_selected: false }));
    const filtered_children = this._filterCutEraseables(children, true);

    // We must now check if any of the eraseable items in the original group, after transforming
    // to the coordinates of the clone, actually intersect the eraser stroke.
    const parent_item = cloned_group.parent;
    const parent_inverse_transform =
      parent_item instanceof SPItem ? parent_item.i2docAffine().inverse() : undefined;
    const relative_transform = parent_inverse_transform
      ? parent_inverse_transform.multiply(clone.i2docAffine())
      : clone.i2docAffine();
    const eraser_bounds = this._acid ? documentExactBounds(this._acid) : null;
    if (!eraser_bounds) return false;
    const eraser_in_group_coordinates = eraser_bounds.map((p) => p.transformed(relative_transform.inverse()));
    const found_collision = filtered_children.some(
      (c) => c.item && collidesWith(c.item, eraser_in_group_coordinates),
    );
    if (found_collision) {
      const unlinked = clone.unlink();
      if (!(unlinked instanceof SPGroup)) return false;
      const unlinked_children: EraseTarget[] = unlinked
        .childList()
        .filter((c): c is SPItem => c instanceof SPItem)
        .map((item) => ({ item, was_selected: false }));
      const overlapping = this._filterCutEraseables(this._filterByCollision(unlinked_children, this._acid));

      // If the clone was selected, the newly unlinked group should stay selected
      if (original_target.was_selected && store_survivors) this._survivors.push(unlinked);

      return this._performEraseOperation(overlapping, false);
    }
    if (original_target.was_selected && store_survivors && original_target.item) {
      this._survivors.push(original_target.item); // If the clone was selected, it should stay so
    }
    // TODO: flash "Some objects could not be cut." if uncuttable children are touched.
    return false;
  }

  /** Returns error flags for items that cannot be meaningfully erased in CUT mode */
  static _uncuttableItemType(item: SPItem | null): number {
    if (!item) return NON_EXISTENT;
    if (item instanceof SPImage) return RASTER_IMAGE;
    if (EraserTool._isStraightSegment(item)) return NO_AREA_PATH;
    return ALL_GOOD;
  }

  /**
   * Performs a boolean difference or cut operation which implements the CUT mode erasure.
   * @return true on success, false on failure
   */
  _booleanErase(target: EraseTarget, store_survivors: boolean): boolean {
    if (!target.item || !this.repr) return false;
    const doc = this._desktop.getDocument();
    const duplicate_stroke = this.repr.duplicate(doc.getReprDoc());
    this.repr.parent()?.appendChild(duplicate_stroke);
    const duplicate_id = duplicate_stroke.attribute('id');
    const stroke_obj = doc.getObjectByRepr(duplicate_stroke);
    if (!stroke_obj) return false;
    const operands = new ObjectSet(this._desktop);
    operands.set(stroke_obj);
    if (!this.nowidth) pathUnion(operands, true, true);
    operands.add(target.item);
    this._handleStrokeStyle(target.item);
    // TODO: operands.removeLPESRecursive(true);

    if (this.nowidth) pathCut(operands, true, true);
    else pathDiff(operands, true, true);

    const spill = duplicate_id ? doc.getObjectById(duplicate_id) : null;
    if (spill) {
      operands.remove(spill);
      spill.deleteObject(false);
      return false;
    }
    if (!Preferences.get().getBool('/tools/eraser/break_apart', false)) {
      combine(operands, true, true);
    } else if (!this.nowidth) {
      breakApart(operands, true, false, true);
    }
    if (store_survivors && target.was_selected) this._survivors.push(...operands.items());
    return true;
  }

  /**
   * Performs the actual erasing on a collection of erase targets.
   * In CUT mode, the survivors are the leftover pieces of partially erased shapes that used to be selected.
   * @return whether something was actually erased.
   */
  _performEraseOperation(items_to_erase: readonly EraseTarget[], store_survivors: boolean): boolean {
    if (this.mode === EraserToolMode.CUT) {
      let erased_something = false;
      for (const target of items_to_erase) {
        erased_something = this._cutErase(target, store_survivors) || erased_something;
      }
      return erased_something;
    }
    if (this.mode === EraserToolMode.CLIP) {
      if (this.nowidth) return false;
      for (const target of items_to_erase) if (target.item) this._clipErase(target.item);
      return true;
    }
    // mode == EraserToolMode::DELETE
    for (const target of items_to_erase) target.item?.deleteObject(true);
    return true;
  }

  /** Handles the "evenodd" stroke style */
  _handleStrokeStyle(item: SPItem): void {
    if (item.style?.fill_rule.value === SPWindRule.SP_WIND_RULE_EVENODD) {
      const css = spReprCssAttrNew();
      spReprCssSetProperty(css, 'fill-rule', 'evenodd');
      sp_desktop_set_style(this._desktop, css);
    }
  }

  /** Clips through an item */
  _clipErase(item: SPItem): void {
    if (!this.repr) return;
    const doc = this._desktop.getDocument();
    const xml_doc = doc.getReprDoc();
    const w_selection = new ObjectSet(this._desktop);
    const bbox = item.documentVisualBounds();
    const dup = this.repr.duplicate(xml_doc);
    this.repr.parent()?.appendChild(dup);
    const dup_obj = doc.getObjectByRepr(dup);
    if (!dup_obj) return;
    w_selection.set(dup_obj);
    pathUnion(w_selection, true);
    let delete_old_clip_path = false;
    const clip_path = item.getClipObject();
    if (clip_path) {
      const first = clip_path.firstChild();
      const selected: SPItem[] = first instanceof SPItem ? [first] : [];
      const to_select: XmlNode[] = [];
      sp_item_list_to_curves([...selected], selected, to_select);
      const clip_child = clip_path.firstChild();
      let clip_data = clip_child instanceof SPItem ? clip_child.getRepr() : null;
      if (!clip_data && to_select.length) clip_data = to_select[0] ?? null;
      if (clip_data && item.parent) {
        const dup_clip = clip_data.duplicate(xml_doc);
        const dup_clip_obj = item.parent.appendChildRepr(dup_clip);
        if (dup_clip_obj instanceof SPItem && item.parent instanceof SPItem) {
          dup_clip_obj.transform = dup_clip_obj.transform.multiply(item.getRelativeTransform(item.parent));
          dup_clip_obj.updateRepr();
          delete_old_clip_path = true;
          w_selection.raiseToTop(true);
          w_selection.add(dup_clip_obj);
          pathDiff(w_selection, true, true);
        }
      }
    } else if (bbox && item.parent) {
      const rect_repr = xml_doc.createElement('svg:rect');
      this._desktop.applyCurrentOrToolStyle(rect_repr, '/tools/eraser', false);
      const rect = item.parent.appendChildRepr(rect_repr);
      if (rect instanceof SPRect && rect.parent instanceof SPItem) {
        rect.setPosition(bbox.left(), bbox.top(), bbox.width(), bbox.height());
        rect.transform = rect.parent.i2docAffine().inverse();
        rect.updateRepr();
        w_selection.raiseToTop(true);
        w_selection.add(rect);
        pathDiff(w_selection, true, true);
      }
    }
    w_selection.raiseToTop(true);
    w_selection.add(item);
    w_selection.setMask(true, false, true);
    if (delete_old_clip_path) clip_path?.deleteObject(true);
  }

  /** Detects whether the given path is a straight line segment which encloses no area or consists of several such segments */
  static _isStraightSegment(path: SPItem): boolean {
    if (!(path instanceof SPPath)) return false;
    const pathv = path.curve();
    if (!pathv) return false;

    // Check if all segments are straight and collinear
    for (const p of pathv) {
      const front = p.curves()[0];
      if (!front) continue;
      const initial_tangent = unit_tangent_at(front, 0);
      for (const segment of p.curves()) {
        if (!segment.isLineSegment()) return false;
        const dir = unit_tangent_at(segment, 0);
        if (!are_near(dir, initial_tangent) && !are_near(dir.neg(), initial_tangent)) return false;
      }
    }
    return true;
  }

  static _addCap(curve: Path, pre: Point, from: Point, to: Point, post: Point, rounding: number): void {
    const vel = rot90(to.sub(from)).mul(rounding / Math.SQRT2);
    const mag = L2(vel);

    let v_in = from.sub(pre);
    const mag_in = L2(v_in);
    v_in = mag_in > epsilon ? v_in.mul(mag / mag_in) : new Point(0, 0);

    let v_out = to.sub(post);
    const mag_out = L2(v_out);
    v_out = mag_out > epsilon ? v_out.mul(mag / mag_out) : new Point(0, 0);

    if (L2(v_in) > epsilon || L2(v_out) > epsilon) append_cubic(curve, from.add(v_in), to.add(v_out), to);
  }

  /** Construct a crude outline of the eraser's path. */
  _accumulate(): void {
    // this desperately needs to be rewritten to use the path outliner...
    if (this.cal1.empty() || this.cal2.empty()) return;

    const rev_cal2 = this.cal2.reversed();
    const c1 = this.cal1.openCurves();
    const c2 = rev_cal2.openCurves();
    const dc_cal1_firstseg = c1[0];
    const rev_cal2_firstseg = c2[0];
    const dc_cal1_lastseg = c1[c1.length - 1];
    const rev_cal2_lastseg = c2[c2.length - 1];
    if (!dc_cal1_firstseg || !rev_cal2_firstseg || !dc_cal1_lastseg || !rev_cal2_lastseg) return;

    this.accumulated = this.cal1.clone();
    if (!this.nowidth) {
      EraserTool._addCap(
        this.accumulated,
        dc_cal1_lastseg.finalPoint().sub(unit_tangent_at(dc_cal1_lastseg, 1)),
        dc_cal1_lastseg.finalPoint(),
        rev_cal2_firstseg.initialPoint(),
        rev_cal2_firstseg.initialPoint().add(unit_tangent_at(rev_cal2_firstseg, 0)),
        this.cap_rounding,
      );

      append_stitched(this.accumulated, rev_cal2);

      EraserTool._addCap(
        this.accumulated,
        rev_cal2_lastseg.finalPoint().sub(unit_tangent_at(rev_cal2_lastseg, 1)),
        rev_cal2_lastseg.finalPoint(),
        dc_cal1_firstseg.initialPoint(),
        dc_cal1_firstseg.initialPoint().add(unit_tangent_at(dc_cal1_firstseg, 0)),
        this.cap_rounding,
      );

      this.accumulated.close();
    }
    this.cal1.clear();
    this.cal2.clear();
  }

  /**
   * Filters out elements that can be erased in CUT mode (by boolean operations) from the given
   * vector of potential erase targets.
   * TODO: flash a warning for bitmaps and paths with zero area unless silent.
   */
  _filterCutEraseables(items: readonly EraseTarget[], _silent = false): EraseTarget[] {
    return items.filter((target) => !EraserTool._uncuttableItemType(target.item));
  }

  /** Filters a list of potential erase targets by collision with a given item */
  _filterByCollision(items: readonly EraseTarget[], w: SPItem | null): EraseTarget[] {
    if (!w) return [];
    const collision_shape = documentExactBounds(w);
    if (!collision_shape) return [];
    return items.filter((target) => target.item && collidesWith(target.item, collision_shape));
  }

  /**
   * Prepares a list of items in the current document containing the items which qualify
   * for the erase operation (based on selection & collision detection).
   * Additionally, the selected items which are going to survive the erase operation (and
   * should be used to restore the selection afterwards) will be added to _survivors.
   */
  _findItemsToErase(): EraseTarget[] {
    const result: EraseTarget[] = [];
    const document = this._desktop.getDocument();
    const selection = this._desktop.getSelection();

    if (this.mode === EraserToolMode.DELETE) {
      // In DELETE mode, the classification is based on having been touched by the mouse cursor:
      // * result     should contain touched items;
      // * _survivors should contain selected but untouched items.
      const r = Rubberband.get(this._desktop);
      const touched = this._desktop.getItemsAtPoints(r.getPoints());
      if (selection.isEmpty()) {
        for (const item of touched) result.push({ item, was_selected: false });
      } else {
        for (const item of selection.items()) {
          if (!touched.includes(item)) this._survivors.push(item);
          else result.push({ item, was_selected: true });
        }
      }
      return result;
    }

    // In the other modes, we start with a crude filtering step based on bounding boxes
    this._acid = this._insertAcidIntoDocument(document);
    if (!this._acid) return result;
    const eraser_bbox = this._acid.documentVisualBounds();
    if (!eraser_bbox) return result;
    const candidates = document.getItemsPartiallyInBox(
      this._desktop.dkey,
      eraser_bbox,
      false,
      false,
      false,
      true,
    );
    /** Items we're allowed to erase based on selection */
    const allowed: EraseTarget[] = [];

    // If selection is empty, we're allowed to erase all items except the eraser stroke itself.
    if (selection.isEmpty()) {
      for (const candidate of candidates) {
        if (candidate !== this._acid) allowed.push({ item: candidate, was_selected: false });
      }
    } // How we handle non-empty selection further depends on the mode.

    if (this.mode === EraserToolMode.CUT) {
      // In CUT mode, we must unpack groups, since the boolean difference/cut operation
      // doesn't make sense for a group.
      for (const selected of selection.items()) {
        let included_for_erase = false;
        for (const candidate of candidates) {
          if (selected === candidate || selected.isAncestorOf(candidate)) {
            allowed.push({ item: candidate, was_selected: selection.includes(candidate) });
            included_for_erase = candidate === selected || included_for_erase;
          }
        }
        if (!included_for_erase) this._survivors.push(selected);
      }
      // The filtering is based on a precise collision detection procedure:
      // * result     will contain all eraseable items that overlap with the eraser stroke;
      // * _survivors will contain all selected items that were rejected during this filtering.
      const overlapping = this._filterByCollision(allowed, this._acid);
      const valid = this._filterCutEraseables(overlapping);

      for (const element of allowed) {
        if (element.item && element.was_selected && !valid.some((v) => v.item === element.item)) {
          this._survivors.push(element.item);
        }
      }
      result.push(...valid);
    } else if (this.mode === EraserToolMode.CLIP) {
      // In CLIP mode, we don't check descendants, because clip can be set to an entire group.
      const all_selected = selection.items();
      for (const item of all_selected) allowed.push({ item, was_selected: true });

      // The classification is also based on the precise collision detection:
      // * result     will contain all items that overlap with the eraser stroke;
      // * _survivors will contain all selected items, since CLIP mode is always non-destructive.
      result.push(...this._filterByCollision(allowed, this._acid));
      this._survivors.push(...all_selected);
    }
    return result;
  }

  _fitAndSplit(releasing: boolean): void {
    const tolerance_sq = (this._desktop.w2d().descrim() * tolerance) ** 2;
    this.nowidth = this.width === 0; // setting width is managed by the base class

    if (this.npoints >= SAMPLING_SIZE || this.npoints <= 0) return; // just clicked

    if (this.npoints === SAMPLING_SIZE - 1 || releasing) {
      this._completeBezier(tolerance_sq, releasing);

      if (!releasing) this._fitDrawLastPoint();

      // Copy last point
      this.point1[0] = this.point1[this.npoints - 1] as Point;
      this.point2[0] = this.point2[this.npoints - 1] as Point;
      this.npoints = 1;
    } else {
      this._drawTemporaryBox();
    }
  }

  _completeBezier(tolerance_sq: number, releasing: boolean): void {
    /* Current eraser */
    if (this.cal1.empty() || this.cal2.empty()) {
      /* dc->npoints > 0 */
      this.cal1.start(this.point1[0] as Point);
      this.cal2.start(this.point2[0] as Point);
    }

    const b1: Point[] = new Array(BEZIER_SIZE * MAX_BEZIERS);
    const nb1 = bezier_fit_cubic_r(b1, this.point1, this.npoints, tolerance_sq, MAX_BEZIERS);

    const b2: Point[] = new Array(BEZIER_SIZE * MAX_BEZIERS);
    const nb2 = bezier_fit_cubic_r(b2, this.point2, this.npoints, tolerance_sq, MAX_BEZIERS);

    if (nb1 <= 0 || nb2 <= 0) {
      this._failedBezierFallback(); // TODO: do we ever need this?
      return;
    }
    const p1 = (i: number) => b1[i] as Point;
    const p2 = (i: number) => b2[i] as Point;

    /* Fit and draw and reset state */
    /* CanvasShape */
    if (!releasing) {
      this.currentcurve.start(p1(0));
      for (let i = 0; i < BEZIER_SIZE * nb1; i += BEZIER_SIZE) {
        append_cubic(this.currentcurve, p1(i + 1), p1(i + 2), p1(i + 3));
      }
      append_line(this.currentcurve, p2(BEZIER_SIZE * (nb2 - 1) + 3));
      for (let i = BEZIER_SIZE * (nb2 - 1); i >= 0; i -= BEZIER_SIZE) {
        append_cubic(this.currentcurve, p2(i + 2), p2(i + 1), p2(i));
      }

      // FIXME: segments is always NULL at this point??
      if (this.segments.length === 0) {
        // first segment
        EraserTool._addCap(this.currentcurve, p2(1), p2(0), p1(0), p1(1), this.cap_rounding);
      }

      this.currentcurve.close();
      this.currentshape.set_bpath([this.currentcurve], true);
    }

    /* Current eraser */
    for (let i = 0; i < BEZIER_SIZE * nb1; i += BEZIER_SIZE)
      append_cubic(this.cal1, p1(i + 1), p1(i + 2), p1(i + 3));
    for (let i = 0; i < BEZIER_SIZE * nb2; i += BEZIER_SIZE)
      append_cubic(this.cal2, p2(i + 1), p2(i + 2), p2(i + 3));
  }

  _failedBezierFallback(): void {
    this._drawTemporaryBox();
    for (let i = 1; i < this.npoints; i++) append_line(this.cal1, this.point1[i] as Point);
    for (let i = 1; i < this.npoints; i++) append_line(this.cal2, this.point2[i] as Point);
  }

  _fitDrawLastPoint(): void {
    if (this.currentcurve.empty()) return;
    const fillColor = sp_desktop_get_color_tool(this._desktop, '/tools/eraser', true);
    const opacity = sp_desktop_get_master_opacity_tool(this._desktop, '/tools/eraser').value;
    const fillOpacity = sp_desktop_get_opacity_tool(this._desktop, '/tools/eraser', true);

    const cbp = new CanvasItemBpath(this._desktop.getCanvasTemp(), [this.currentcurve], true);
    cbp.set_fill(fillColor ? fillColor.toRGBA(opacity * fillOpacity) : 0x0, trace_wind_rule);
    cbp.set_stroke(0x0);
    this.segments.push(cbp);

    if (this.mode === EraserToolMode.DELETE) {
      cbp.set_visible(false);
      this.currentshape.set_visible(false);
    }
  }

  _drawTemporaryBox(): void {
    const n = this.npoints;
    const pt1 = (i: number) => this.point1[i] as Point;
    const pt2 = (i: number) => this.point2[i] as Point;
    this.currentcurve.start(pt1(n - 1));
    for (let i = n - 2; i >= 0; i--) append_line(this.currentcurve, pt1(i));
    for (let i = 0; i < n; i++) append_line(this.currentcurve, pt2(i));
    if (n >= 2)
      EraserTool._addCap(
        this.currentcurve,
        pt2(n - 2),
        pt2(n - 1),
        pt1(n - 1),
        pt1(n - 2),
        this.cap_rounding,
      );
    this.currentcurve.close();
    this.currentshape.set_bpath([this.currentcurve], true);
  }

  #clearSegments(): void {
    for (const s of this.segments) s.unlink();
    this.segments = [];
  }
}
