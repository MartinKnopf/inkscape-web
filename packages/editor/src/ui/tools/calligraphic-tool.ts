// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tools/calligraphic-tool.cpp, src/ui/tools/calligraphic-tool.h
/*
 * Handwriting-like drawing mode
 *
 * Authors:
 *   Mitsuru Oka <oka326@parkcity.ne.jp>
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   bulia byak <buliabyak@users.sf.net>
 *   MenTaLguY <mental@rydia.net>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * The original dynadraw code:
 *   Paul Haeberli <paul@sgi.com>
 *
 * Copyright (C) 1998 The Free Software Foundation
 * Copyright (C) 1999-2005 authors
 * Copyright (C) 2001-2002 Ximian, Inc.
 * Copyright (C) 2005-2007 bulia byak
 * Copyright (C) 2006 MenTaLguY
 */
import {
  C_,
  convertUnit,
  DocumentUndo,
  Preferences,
  pathDiff,
  pathUnion,
  SPItem,
  SPShape,
  SPWindRule,
  sp_svg_write_path,
} from '@inkscape-web/core';
import {
  type Affine,
  bezier_fit_cubic_r,
  L2,
  lerp,
  Path,
  type PathVector,
  Point,
  pathv_nearest_time,
  pathv_point_at,
  rad_from_deg,
  rot90,
} from '@inkscape-web/geom';
import { have_viable_layer } from '../../context-fns.ts';
import type { SPDesktop } from '../../desktop.ts';
import {
  sp_desktop_get_color_tool,
  sp_desktop_get_master_opacity_tool,
  sp_desktop_get_opacity_tool,
} from '../../desktop-style.ts';
import { CanvasItemBpath } from '../../display/control/canvas-item-bpath.ts';
import {
  append_cubic,
  append_line,
  append_stitched,
  DynamicBase,
  type ExtendedInput,
  extinput_from_event,
  SAMPLING_SIZE,
} from './dynamic-base.ts';
import { spdc_create_single_dot } from './freehand-base.ts';
import { type ModifierState, mod_alt, mod_ctrl, mod_ctrl_only, mod_shift } from './tool-base.ts';

const DDC_MIN_PRESSURE = 0.0;
const DDC_MAX_PRESSURE = 1.0;
const DDC_DEFAULT_PRESSURE = 1.0;

const DDC_MIN_TILT = -1.0;
const DDC_MAX_TILT = 1.0;
const DDC_DEFAULT_TILT = 0.0;

const DDC_RED_RGBA = 0xff0000ff;

const TOLERANCE_CALLIGRAPHIC = 0.1;

export const DYNA_EPSILON = 0.5e-6;
const DYNA_EPSILON_START = 0.5e-2;
const DYNA_VEL_START = 1e-5;

const BEZIER_SIZE = 4;
const BEZIER_MAX_BEZIERS = 8;
const BEZIER_MAX_LENGTH = BEZIER_SIZE * BEZIER_MAX_BEZIERS;

// Modifiers (upstream Modifiers::Modifier, src/ui/modifiers.cpp).
/** calligraphic-hatching: Ctrl */
const mod_calli_hatching = (s: ModifierState): boolean => mod_ctrl(s);
/** calligraphic-subtract: Alt */
const mod_calli_subtract = (s: ModifierState): boolean => mod_alt(s);
/** calligraphic-unionize: Shift */
const mod_calli_unionize = (s: ModifierState): boolean => mod_shift(s);

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

function unsnapped_polar(angle: number): Point {
  return new Point(Math.cos(angle), Math.sin(angle));
}

/** A standard normal random number (Box-Muller; upstream std::normal_distribution). */
function normal_random(): number {
  return Math.sqrt(-2.0 * Math.log(1 - Math.random())) * Math.cos(2.0 * Math.PI * Math.random());
}

/** Append a cap from the end of curve to `to` that bulges by rounding (upstream add_cap). */
export function add_cap(curve: Path, from: Point, to: Point, rounding: number): void {
  if (L2(to.sub(from)) > DYNA_EPSILON) {
    const vel = rot90(to.sub(from)).mul(rounding / Math.SQRT2);
    const mag = L2(vel);
    const v = rot90(to.sub(from)).mul(mag / L2(to.sub(from)));
    append_cubic(curve, from.add(v), to.add(v), to);
  }
}

/**
 * The calligraphy tool (upstream CalligraphicTool): a drag draws a filled
 * stroke whose width depends on the nib angle (fixed by angle and fixation,
 * or from the pen tilt), the speed (thinning) and the pen pressure. Mass
 * makes the pen lag behind, wiggle makes it waver, tremor makes the edges
 * rugged, caps round the ends. A click makes a dot.
 * Shift adds the stroke to the selection (union), Alt subtracts it from
 * the selection, Ctrl draws along the selected path at a fixed distance
 * (hatching). Arrow keys change angle and width; Esc cancels.
 * TODO: trace background (needs a synchronous pixel read of the drawing),
 * status bar messages, Alt+X (focus the width field), cursor.
 */
export class CalligraphicTool extends DynamicBase {
  /** newly created objects remain selected */
  keep_selected = true;

  hatch_spacing = 0.0;
  hatch_spacing_step = 0.0;
  hatch_item: SPItem | null = null;
  hatch_path: PathVector = [];
  hatch_nearest_past: number[] = [];
  hatch_pointer_past: number[] = [];
  inertia_vectors: Point[] = [];
  hatch_last_nearest = new Point(0, 0);
  hatch_last_pointer = new Point(0, 0);
  hatch_vectors: Point[] = [];
  hatch_escaped = false;
  hatch_area: CanvasItemBpath;
  just_started_drawing = false;
  trace_bg = false;

  /** canvas item for red "leading" segment */
  currentshape: CanvasItemBpath;

  constructor(desktop: SPDesktop) {
    super(desktop, '/tools/calligraphic');
    this.currentshape = new CanvasItemBpath(desktop.getCanvasTemp());
    this.currentshape.set_stroke(0x0);
    this.currentshape.set_fill(DDC_RED_RGBA, SPWindRule.SP_WIND_RULE_EVENODD);

    this.hatch_area = new CanvasItemBpath(desktop.getCanvasControls());
    this.hatch_area.set_fill(0x0, SPWindRule.SP_WIND_RULE_EVENODD);
    this.hatch_area.set_stroke(0x0000007f);
    this.hatch_area.set_pickable(false);
    this.hatch_area.set_visible(false);

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
      'keep_selected',
      'cap_rounding',
    ]) {
      this.sp_event_context_read(name);
    }

    if (Preferences.get().getBool('/tools/calligraphic/selcue')) this.enableSelectionCue();
  }

  override destroy(): void {
    this.ungrabCanvasEvents();
    this.currentshape.unlink();
    this.hatch_area.unlink();
    super.destroy();
  }

  override set(name: string): void {
    const prefs = Preferences.get();
    if (name === 'tracebackground') {
      this.trace_bg = prefs.getBool('/tools/calligraphic/tracebackground');
    } else if (name === 'keep_selected') {
      this.keep_selected = prefs.getBool('/tools/calligraphic/keep_selected');
    } else {
      // Pass on up to parent class to handle common attributes.
      super.set(name);
    }
  }

  reset(p: Point): void {
    this.last = this.cur = this.getNormalizedPoint(p);
    this.vel = new Point(0, 0);
    this.vel_max = 0.0;
    this.acc = new Point(0, 0);
    this.ang = new Point(0, 0);
    this.del = new Point(0, 0);
  }

  extinput(ext: ExtendedInput): void {
    this.pressure =
      ext.pressure !== undefined
        ? clamp(ext.pressure, DDC_MIN_PRESSURE, DDC_MAX_PRESSURE)
        : DDC_DEFAULT_PRESSURE;
    this.xtilt = ext.xtilt !== undefined ? clamp(ext.xtilt, DDC_MIN_TILT, DDC_MAX_TILT) : DDC_DEFAULT_TILT;
    this.ytilt = ext.ytilt !== undefined ? clamp(ext.ytilt, DDC_MIN_TILT, DDC_MAX_TILT) : DDC_DEFAULT_TILT;
  }

  /** Move the pen towards p (desktop) with mass and drag; false if the move is discarded. */
  apply(p: Point): boolean {
    const n = this.getNormalizedPoint(p);

    // Calculate mass and drag.
    const mass_scaled = lerp(this.mass, 1.0, 160.0);
    const drag_scaled = lerp(this.drag * this.drag, 0.0, 0.5);

    // Calculate force and acceleration.
    const force = n.sub(this.cur);

    // If force is below the absolute threshold DYNA_EPSILON,
    // or we haven't yet reached DYNA_VEL_START (i.e. at the beginning of stroke)
    // _and_ the force is below the (higher) DYNA_EPSILON_START threshold,
    // discard this move.
    // This prevents flips, blobs, and jerks caused by microscopic tremor of the tablet pen,
    // especially bothersome at the start of the stroke where we don't yet have the inertia to
    // smooth them out.
    if (L2(force) < DYNA_EPSILON || (this.vel_max < DYNA_VEL_START && L2(force) < DYNA_EPSILON_START)) {
      return false;
    }

    this.acc = force.div(mass_scaled);

    // Calculate new velocity.
    this.vel = this.vel.add(this.acc);

    this.vel_max = Math.max(this.vel_max, L2(this.vel));

    // Calculate angle of drawing tool.
    let a1: number;
    if (this.usetilt) {
      // 1a. calculate nib angle from input device tilt:
      if (this.xtilt === 0 && this.ytilt === 0) {
        // to be sure that atan2 in the computation below
        // would not crash or return NaN.
        a1 = 0;
      } else {
        a1 = Math.atan2(this.ytilt, -this.xtilt);
      }
    } else {
      // 1b. fixed dc->angle (absolutely flat nib):
      a1 = rad_from_deg(this.angle);
    }
    a1 *= -this._desktop.yaxisdir();
    if (this.flatness < 0.0) {
      // flips direction. Useful when this->usetilt
      // allows simulating both pen and calligraphic brush
      a1 *= -1;
    }
    a1 %= Math.PI;
    if (a1 > 0.5 * Math.PI) {
      a1 -= Math.PI;
    } else if (a1 <= -0.5 * Math.PI) {
      a1 += Math.PI;
    }

    // 2. perpendicular to dc->vel (absolutely non-flat nib):
    const mag_vel = L2(this.vel);
    if (mag_vel < DYNA_EPSILON) return false;
    const ang2 = rot90(this.vel).div(mag_vel);

    // 3. Average them using flatness parameter:
    // calculate angles
    let a2 = Math.atan2(ang2.y, ang2.x);
    // flip a2 to force it to be in the same half-circle as a1
    let flipped = false;
    if (Math.abs(a2 - a1) > 0.5 * Math.PI) {
      a2 += Math.PI;
      flipped = true;
    }
    // normalize a2
    if (a2 > Math.PI) {
      a2 -= 2 * Math.PI;
    } else if (a2 < -Math.PI) {
      a2 += 2 * Math.PI;
    }
    // find the flatness-weighted bisector angle, unflip if a2 was flipped
    // FIXME: when dc->vel is oscillating around the fixed angle, the new_ang flips back and forth. How to avoid this?
    const new_ang = a1 + (1 - Math.abs(this.flatness)) * (a2 - a1) - (flipped ? Math.PI : 0);
    // Try to detect a sudden flip when the new angle differs too much from the previous for the
    // current velocity; in that case discard this move
    const new_ang_vec = unsnapped_polar(new_ang);
    const angle_delta = L2(new_ang_vec.sub(this.ang));
    if (angle_delta / L2(this.vel) > 4000) return false;

    // convert to point
    this.ang = new_ang_vec;

    // Apply drag
    this.vel = this.vel.mul(1.0 - drag_scaled);

    // Update position
    this.last = this.cur;
    this.cur = this.cur.add(this.vel);

    return true;
  }

  /** Add the edge points of the pen at its current position (upstream brush). */
  brush(): void {
    // How much velocity thins strokestyle
    const vel_thin_scaled = lerp(this.vel_thin, 0, 160);

    // Influence of pressure on thickness
    const pressure_thick = this.usepressure ? this.pressure : 1.0;

    // get the real brush point, not the same as pointer (affected by hatch tracking and/or mass drag)
    const brush = this.getViewPoint(this.cur);

    // TODO: trace background (trace_bg) from the color under the brush.
    const trace_thick = 1;

    let width_adjusted = (pressure_thick * trace_thick - vel_thin_scaled * this.vel.length()) * this.width;

    let tremble_left = 0;
    let tremble_right = 0;
    if (this.tremor > 0) {
      // deflect both left and right edges randomly and independently, so that:
      // (1) dc->tremor=1 corresponds to sigma=1, decreasing dc->tremor narrows the bell curve;
      // (2) deflection depends on width, but is upped for small widths for better visual uniformity across widths;
      // (3) deflection somewhat depends on speed, to prevent fast strokes looking
      // comparatively smooth and slow ones excessively jittery
      const sigma = this.tremor * (0.15 + 0.8 * width_adjusted) * (0.35 + 14 * this.vel.length());
      tremble_left = normal_random() * sigma;
      tremble_right = normal_random() * sigma;
    }

    width_adjusted = Math.max(width_adjusted, 0.02 * this.width);

    let dezoomify_factor = 0.05 * 1000;
    if (!this.abs_width) dezoomify_factor /= this._desktop.current_zoom();

    const del_left = this.ang.mul(dezoomify_factor * (width_adjusted + tremble_left));
    const del_right = this.ang.mul(dezoomify_factor * (width_adjusted + tremble_right));

    this.point1[this.npoints] = brush.add(del_left);
    this.point2[this.npoints] = brush.sub(del_right);

    this.del = del_left.add(del_right).mul(0.5);

    this.npoints++;
  }

  cancel(event?: Event): void {
    this.dragging = false;
    this.is_drawing = false;

    this.ungrabCanvasEvents(event instanceof PointerEvent ? event : undefined);

    // Remove all temporary line segments.
    this.#clearSegments();

    // Reset accumulated curve.
    this.accumulated.clear();
    this.clear_current();

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
        ret = this.#onKeyPress(event as KeyboardEvent);
        if (ret) event.preventDefault();
        break;
      case 'keyup':
        if ((event as KeyboardEvent).key === 'Control') {
          this.hatch_spacing = 0;
          this.hatch_spacing_step = 0;
        }
        break;
    }
    return ret || super.root_handler(event);
  }

  #onButtonPress(event: PointerEvent): boolean {
    if (event.button !== 0) return false;
    if (!have_viable_layer(this._desktop)) return true;

    this.accumulated.clear();
    this.repr = null;

    // initialize first point
    this.npoints = 0;

    this.grabCanvasEvents(event);

    this.is_drawing = true;
    this.just_started_drawing = true;
    return true;
  }

  #onMotion(event: PointerEvent): boolean {
    let ret = false;
    let motion_dt = this._desktopPoint(this._windowPoint(event));

    // for hatching:
    let hatch_dist = 0;
    let hatch_unit_vector = new Point(0, 0);
    let nearest = new Point(0, 0);
    let pointer = new Point(0, 0);
    let motion_to_curve: Affine | null = null;

    if (mod_calli_hatching(event)) {
      // hatching - sense the item
      const selected = this._desktop.getSelection().singleItem();
      if (selected instanceof SPShape) {
        // One item selected, and it's a path;
        // let's try to track it as a guide
        if (selected !== this.hatch_item) {
          this.hatch_item = selected;
          const pv = selected.curve();
          if (pv) this.hatch_path = pv.map((p) => p.transformed(selected.i2docAffine()));
        }

        // calculate pointer point in the guide item's coords
        motion_to_curve = selected.dt2iAffine().multiply(selected.i2docAffine());
        pointer = motion_dt.transformed(motion_to_curve);

        // calculate the nearest point on the guide path
        const time = pathv_nearest_time(this.hatch_path, pointer);
        if (time) {
          nearest = pathv_point_at(this.hatch_path, time);
          // distance from pointer to nearest
          hatch_dist = L2(pointer.sub(nearest));
          // unit-length vector
          hatch_unit_vector = pointer.sub(nearest).div(hatch_dist);
        }
      }
    }

    if (this.is_drawing && event.buttons & 1) {
      this.dragging = true;

      if (mod_calli_hatching(event) && this.hatch_item && motion_to_curve) {
        motion_dt = this.#trackHatch(
          motion_dt,
          nearest,
          pointer,
          hatch_dist,
          hatch_unit_vector,
          motion_to_curve,
        );
      }

      const handle_motion = (pt: Point) => {
        if (this.just_started_drawing) {
          this.just_started_drawing = false;
          this.reset(pt);
        }
        if (!this.apply(pt)) return;
        if (!this.cur.equals(this.last)) {
          this.brush();
          this.fit_and_split(false);
        }
      };

      // The coalesced events since the last motion event (upstream event.history).
      const history = event.getCoalescedEvents?.() ?? [];
      for (const hist of history.slice(0, -1)) {
        this.extinput(extinput_from_event(hist));
        handle_motion(this._desktopPoint(this._windowPoint(hist)));
      }
      this.extinput(extinput_from_event(event));
      handle_motion(motion_dt);

      ret = true;
    }

    this.#drawHatchArea(event, motion_dt, hatch_dist, nearest, hatch_unit_vector, motion_to_curve);
    return ret;
  }

  /** The track point of a hatching stroke: at hatch_spacing from the guide path (upstream root_handler). */
  #trackHatch(
    motion_dt: Point,
    nearest: Point,
    pointer: Point,
    hatch_dist: number,
    hatch_unit_vector: Point,
    motion_to_curve: Affine,
  ): Point {
    const HATCH_VECTOR_ELEMENTS = 12;
    const INERTIA_ELEMENTS = 24;
    const SPEED_ELEMENTS = 12;
    const SPEED_MIN = 0.3;
    const SPEED_NORMAL = 0.35;
    const INERTIA_FORCE = 0.5;

    // speed is the movement of the nearest point along the guide path, divided by
    // the movement of the pointer at the same period; it is averaged for the last
    // SPEED_ELEMENTS motion events.  Normally, as you track the guide path, speed
    // is about 1, i.e. the nearest point on the path is moved by about the same
    // distance as the pointer. If the speed starts to decrease, we are losing
    // contact with the guide; if it drops below SPEED_MIN, we are on our own and
    // not attracted to guide anymore. Most often this happens when you have
    // tracked to the end of a guide calligraphic stroke and keep moving
    // further. We try to handle this situation gracefully: not stick with the
    // guide forever but let go of it smoothly and without sharp jerks (non-zero
    // mass recommended; with zero mass, jerks are still quite noticeable).
    let speed = 1;
    if (L2(this.hatch_last_nearest) !== 0) {
      // the distance nearest moved since the last motion event
      const nearest_moved = L2(nearest.sub(this.hatch_last_nearest));
      // the distance pointer moved since the last motion event
      const pointer_moved = L2(pointer.sub(this.hatch_last_pointer));

      // store them in stacks limited to SPEED_ELEMENTS
      this.hatch_nearest_past.unshift(nearest_moved);
      if (this.hatch_nearest_past.length > SPEED_ELEMENTS) this.hatch_nearest_past.pop();
      this.hatch_pointer_past.unshift(pointer_moved);
      if (this.hatch_pointer_past.length > SPEED_ELEMENTS) this.hatch_pointer_past.pop();

      // If the stacks are full,
      if (this.hatch_nearest_past.length === SPEED_ELEMENTS) {
        // calculate the sums of all stored movements
        const nearest_sum = this.hatch_nearest_past.reduce((a, b) => a + b, 0);
        const pointer_sum = this.hatch_pointer_past.reduce((a, b) => a + b, 0);
        // and divide to get the speed
        speed = nearest_sum / pointer_sum;
      }
    }

    if (
      this.hatch_escaped || // already escaped, do not reattach
      speed < SPEED_MIN || // stuck; most likely reached end of traced stroke
      (this.hatch_spacing > 0 && hatch_dist > 50 * this.hatch_spacing) // went too far from the guide
    ) {
      // We are NOT attracted to the guide!

      // Remember hatch_escaped so we don't get
      // attracted again until the end of this stroke
      this.hatch_escaped = true;

      if (this.inertia_vectors.length >= INERTIA_ELEMENTS / 2) {
        // move by inertia
        const front = this.inertia_vectors[0] as Point;
        const back = this.inertia_vectors[this.inertia_vectors.length - 1] as Point;
        const moved_past_escape = motion_dt.sub(front);
        const inertia = front.sub(back);

        let dot = moved_past_escape.dot(inertia);
        dot /= moved_past_escape.length() * inertia.length();

        if (dot > 0) {
          // mouse is still moving in approx the same direction
          const should_have_moved = inertia.normalized().mul(moved_past_escape.length());
          motion_dt = front.add(moved_past_escape.lerp(INERTIA_FORCE, should_have_moved));
        }
      }
    } else {
      // Calculate angle cosine of this vector-to-guide and all past vectors
      // summed, to detect if we accidentally flipped to the other side of the guide
      const hatch_vector_accumulated = this.hatch_vectors.reduce((a, b) => a.add(b), new Point(0, 0));
      let dot = pointer.sub(nearest).dot(hatch_vector_accumulated);
      dot /= L2(pointer.sub(nearest)) * L2(hatch_vector_accumulated);

      if (this.hatch_spacing !== 0) {
        // spacing was already set
        let target: number;
        if (speed > SPEED_NORMAL) {
          // all ok, strictly obey the spacing
          target = this.hatch_spacing;
        } else {
          // looks like we're starting to lose speed,
          // so _gradually_ let go attraction to prevent jerks
          target = (this.hatch_spacing * speed + hatch_dist * (SPEED_NORMAL - speed)) / SPEED_NORMAL;
        }
        if (!Number.isNaN(dot) && dot < -0.5) {
          // flip
          target = -target;
        }

        // This is the track pointer that we will use instead of the real one
        const new_pointer = nearest.add(hatch_unit_vector.mul(target));

        // some limited feedback: allow persistent pulling to slightly change
        // the spacing
        this.hatch_spacing += (hatch_dist - this.hatch_spacing) / 3500;

        // return it to the desktop coords
        motion_dt = new_pointer.transformed(motion_to_curve.inverse());

        if (speed >= SPEED_NORMAL) {
          this.inertia_vectors.unshift(motion_dt);
          if (this.inertia_vectors.length > INERTIA_ELEMENTS) this.inertia_vectors.pop();
        }
      } else {
        // this is the first motion event, set the dist
        this.hatch_spacing = hatch_dist;
      }

      // remember last points
      this.hatch_last_pointer = pointer;
      this.hatch_last_nearest = nearest;

      this.hatch_vectors.unshift(pointer.sub(nearest));
      if (this.hatch_vectors.length > HATCH_VECTOR_ELEMENTS) this.hatch_vectors.pop();
    }
    return motion_dt;
  }

  /** Draw the hatching circle if necessary. */
  #drawHatchArea(
    event: PointerEvent,
    motion_dt: Point,
    hatch_dist: number,
    nearest: Point,
    hatch_unit_vector: Point,
    motion_to_curve: Affine | null,
  ): void {
    if (!mod_calli_hatching(event)) {
      this.hatch_area.set_visible(false);
      return;
    }
    const show = (c: Point, r: number, rgba: number) => {
      this.hatch_area.set_bpath([Path.fromCircle(c, r)], true);
      this.hatch_area.set_stroke(rgba);
      this.hatch_area.set_visible(true);
    };
    if (this.hatch_spacing === 0 && hatch_dist !== 0) {
      // Haven't set spacing yet: gray, center free, update radius live
      show(this._desktopPoint(this._windowPoint(event)), hatch_dist, 0x7f7f7fff);
    } else if (this.dragging && !this.hatch_escaped && hatch_dist !== 0) {
      // Tracking: green, center snapped, fixed radius
      show(motion_dt, this.hatch_spacing, 0x00ff00ff);
    } else if (this.dragging && this.hatch_escaped && hatch_dist !== 0) {
      // Tracking escaped: red, center free, fixed radius
      show(motion_dt, this.hatch_spacing, 0xff0000ff);
    } else if (motion_to_curve) {
      // Not drawing but spacing set: gray, center snapped, fixed radius
      const c = nearest.add(hatch_unit_vector.mul(this.hatch_spacing)).transformed(motion_to_curve.inverse());
      if (c.isFinite() && this.hatch_spacing !== 0) show(c, this.hatch_spacing, 0x7f7f7fff);
    }
  }

  #onButtonRelease(event: PointerEvent): boolean {
    const motion_dt = this._desktopPoint(this._windowPoint(event));

    this.ungrabCanvasEvents(event);
    this.is_drawing = false;

    if (this.dragging && event.button === 0) {
      this.dragging = false;

      this.apply(motion_dt);

      // Remove all temporary line segments.
      this.#clearSegments();

      // Create object
      this.fit_and_split(true);
      if (this.accumulate()) {
        // This will perform document_done
        this.set_to_accumulated(mod_calli_unionize(event), mod_calli_subtract(event));
      } else {
        console.warn('Failed to create path: invalid data in dc->cal1 or dc->cal2');
      }

      // Reset accumulated curve.
      this.accumulated.clear();

      this.clear_current();
      this.repr = null;

      this.hatch_pointer_past = [];
      this.hatch_nearest_past = [];
      this.inertia_vectors = [];
      this.hatch_vectors = [];
      this.hatch_last_nearest = new Point(0, 0);
      this.hatch_last_pointer = new Point(0, 0);
      this.hatch_escaped = false;
      this.hatch_item = null;
      this.hatch_path = [];
      this.just_started_drawing = false;

      if (this.hatch_spacing !== 0 && !this.keep_selected) {
        // we do not select the newly drawn path, so increase spacing by step
        if (this.hatch_spacing_step === 0) this.hatch_spacing_step = this.hatch_spacing;
        this.hatch_spacing += this.hatch_spacing_step;
      }
      return true;
    }
    if (!this.dragging && event.button === 0 && have_viable_layer(this._desktop)) {
      spdc_create_single_dot(this, motion_dt, '/tools/calligraphic', event);
      return true;
    }
    return false;
  }

  #onKeyPress(event: KeyboardEvent): boolean {
    const prefs = Preferences.get();
    const unit = prefs.getString('/tools/calligraphic/unit');
    // The toolbar shows the width in the unit; it writes px to the preferences.
    const set_width = (w: number) =>
      prefs.setDouble('/tools/calligraphic/width', convertUnit(w * 100, unit, 'px'));
    switch (event.key) {
      case 'ArrowUp':
        if (!mod_ctrl_only(event)) {
          this.angle = Math.min(this.angle + 5.0, 90.0);
          prefs.setDouble('/tools/calligraphic/angle', this.angle);
          return true;
        }
        break;
      case 'ArrowDown':
        if (!mod_ctrl_only(event)) {
          this.angle = Math.max(this.angle - 5.0, -90.0);
          prefs.setDouble('/tools/calligraphic/angle', this.angle);
          return true;
        }
        break;
      case 'ArrowRight':
        if (!mod_ctrl_only(event)) {
          this.width = convertUnit(this.width, 'px', unit);
          this.width = Math.min(this.width + 0.01, 1.0);
          set_width(this.width); // the same spinbutton is for alt+x
          return true;
        }
        break;
      case 'ArrowLeft':
        if (!mod_ctrl_only(event)) {
          this.width = convertUnit(this.width, 'px', unit);
          this.width = Math.max(this.width - 0.01, 0.00001);
          set_width(this.width);
          return true;
        }
        break;
      case 'Home':
        this.width = 0.00001;
        set_width(this.width);
        return true;
      case 'End':
        this.width = 1.0;
        set_width(this.width);
        return true;
      case 'Escape':
        if (this.is_drawing) {
          // if drawing, cancel, otherwise pass it up for deselecting
          this.cancel();
          return true;
        }
        break;
      case 'z':
      case 'Z':
        if (mod_ctrl_only(event) && this.is_drawing) {
          // if drawing, cancel, otherwise pass it up for undo
          this.cancel();
          return true;
        }
        break;
    }
    return false;
  }

  clear_current(): void {
    // reset bpath
    this.currentshape.set_bpath([]);

    // reset curve
    this.currentcurve.clear();
    this.cal1.clear();
    this.cal2.clear();

    // reset points
    this.npoints = 0;
  }

  /** Write the accumulated stroke to the document: a new path, combined with the selection by unionize or subtract. */
  set_to_accumulated(unionize: boolean, subtract: boolean): void {
    const desktop = this._desktop;
    const doc = desktop.getDocument();
    if (!this.accumulated.empty()) {
      if (!this.repr) {
        /* Create object */
        const repr = doc.getReprDoc().createElement('svg:path');

        /* Set style */
        desktop.applyCurrentOrToolStyle(repr, '/tools/calligraphic', false);

        this.repr = repr;

        const layer = this.currentLayer();
        const item = layer?.appendChildRepr(this.repr);
        if (layer && item instanceof SPItem) {
          item.transform = layer.i2docAffine().inverse();
          item.updateRepr();
        }
      }

      const pathv = [this.accumulated.transformed(desktop.dt2doc())];
      this.repr.setAttribute('d', sp_svg_write_path(pathv));

      const selection = desktop.getSelection();
      const obj = doc.getObjectByRepr(this.repr);
      if (unionize && obj) {
        selection.add(obj);
        pathUnion(selection, true);
      } else if (subtract && obj) {
        selection.add(obj);
        pathDiff(selection, true);
      } else if (this.keep_selected && obj) {
        selection.set(obj);
      }

      // Now we need to write the transform information.
      // First, find out whether our repr is still linked to a valid object. In this case,
      // we need to write the transform data only for this element.
      // Either there was no boolean op or it failed.
      let result = doc.getObjectByRepr(this.repr);
      if (!(result instanceof SPItem)) {
        // The boolean operation succeeded.
        // Now we fetch the single item, that has been set as selected by the boolean op.
        // This is its result.
        result = selection.singleItem();
      }
      if (result instanceof SPItem) result.doWriteTransform(result.transform, null, true);
    } else {
      this.repr?.parent()?.removeChild(this.repr);
      this.repr = null;
    }

    DocumentUndo.done(doc, C_('Undo', 'Draw calligraphic stroke'), 'draw-calligraphic');
  }

  /** Join the edges to the closed outline "accumulated"; false if they are invalid. */
  accumulate(): boolean {
    if (this.cal1.empty() || this.cal2.empty() || this.cal1.closed()) {
      this.cal1.clear();
      this.cal2.clear();
      return false; // failure
    }

    const rev_cal2 = this.cal2.reversed();

    if (rev_cal2.empty() || rev_cal2.closed()) {
      this.cal1.clear();
      this.cal2.clear();
      return false; // failure
    }

    const curves1 = this.cal1.openCurves();
    const curves2 = rev_cal2.openCurves();
    const dc_cal1_firstseg = curves1[0];
    const rev_cal2_firstseg = curves2[0];
    const dc_cal1_lastseg = curves1[curves1.length - 1];
    const rev_cal2_lastseg = curves2[curves2.length - 1];
    if (!dc_cal1_firstseg || !rev_cal2_firstseg || !dc_cal1_lastseg || !rev_cal2_lastseg) return false;

    this.accumulated = this.cal1.clone();

    add_cap(
      this.accumulated,
      dc_cal1_lastseg.finalPoint(),
      rev_cal2_firstseg.initialPoint(),
      this.cap_rounding,
    );

    append_stitched(this.accumulated, rev_cal2);

    add_cap(
      this.accumulated,
      rev_cal2_lastseg.finalPoint(),
      dc_cal1_firstseg.initialPoint(),
      this.cap_rounding,
    );

    this.accumulated.close();

    this.cal1.clear();
    this.cal2.clear();

    return true; // success
  }

  /**
   * Fit Beziers to the edge points when SAMPLING_SIZE - 1 points are collected
   * (or at the release) and add them to the edges; else draw the points as lines.
   */
  fit_and_split(release: boolean): void {
    const tolerance_sq = (this._desktop.w2d().descrim() * TOLERANCE_CALLIGRAPHIC) ** 2;

    if (!(this.npoints > 0 && this.npoints < SAMPLING_SIZE)) return; // just clicked

    if (this.npoints === SAMPLING_SIZE - 1 || release) {
      /* Current calligraphic */
      if (this.cal1.empty() || this.cal2.empty()) {
        /* dc->npoints > 0 */
        this.cal1.start(this.point1[0] as Point);
        this.cal2.start(this.point2[0] as Point);
      }

      const b1: Point[] = new Array(BEZIER_MAX_LENGTH);
      const nb1 = bezier_fit_cubic_r(b1, this.point1, this.npoints, tolerance_sq, BEZIER_MAX_BEZIERS);

      const b2: Point[] = new Array(BEZIER_MAX_LENGTH);
      const nb2 = bezier_fit_cubic_r(b2, this.point2, this.npoints, tolerance_sq, BEZIER_MAX_BEZIERS);

      if (nb1 > 0 && nb2 > 0) {
        const p1 = (i: number) => b1[i] as Point;
        const p2 = (i: number) => b2[i] as Point;
        /* Fit and draw and reset state */
        /* CanvasShape */
        if (!release) {
          this.currentcurve.start(p1(0));
          for (let i = 0; i < BEZIER_SIZE * nb1; i += BEZIER_SIZE) {
            append_cubic(this.currentcurve, p1(i + 1), p1(i + 2), p1(i + 3));
          }
          append_line(this.currentcurve, p2(BEZIER_SIZE * (nb2 - 1) + 3));
          for (let i = BEZIER_SIZE * (nb2 - 1); i >= 0; i -= BEZIER_SIZE) {
            append_cubic(this.currentcurve, p2(i + 2), p2(i + 1), p2(i));
          }
          // FIXME: dc->segments is always NULL at this point??
          if (this.segments.length === 0) {
            // first segment
            add_cap(this.currentcurve, p2(0), p1(0), this.cap_rounding);
          }
          this.currentcurve.close();
          this.currentshape.set_bpath([this.currentcurve], true);
        }

        /* Current calligraphic */
        for (let i = 0; i < BEZIER_SIZE * nb1; i += BEZIER_SIZE) {
          append_cubic(this.cal1, p1(i + 1), p1(i + 2), p1(i + 3));
        }
        for (let i = 0; i < BEZIER_SIZE * nb2; i += BEZIER_SIZE) {
          append_cubic(this.cal2, p2(i + 1), p2(i + 2), p2(i + 3));
        }
      } else {
        // The fit failed (or found less than 2 distinct points).
        this.draw_temporary_box();

        for (let i = 1; i < this.npoints; i++) {
          append_line(this.cal1, this.point1[i] as Point);
          append_line(this.cal2, this.point2[i] as Point);
        }
      }

      /* Fit and draw and copy last point */
      if (!release && !this.currentcurve.empty()) {
        const fillColor = sp_desktop_get_color_tool(this._desktop, '/tools/calligraphic', true);
        const opacity = sp_desktop_get_master_opacity_tool(this._desktop, '/tools/calligraphic').value;
        const fillOpacity = sp_desktop_get_opacity_tool(this._desktop, '/tools/calligraphic', true);

        const cbp = new CanvasItemBpath(this._desktop.getCanvasTemp(), [this.currentcurve], true);
        cbp.set_fill(
          fillColor ? fillColor.toRGBA(opacity * fillOpacity) : 0x0,
          SPWindRule.SP_WIND_RULE_EVENODD,
        );
        cbp.set_stroke(0x0);
        this.segments.push(cbp);
      }

      this.point1[0] = this.point1[this.npoints - 1] as Point;
      this.point2[0] = this.point2[this.npoints - 1] as Point;
      this.npoints = 1;
    } else {
      this.draw_temporary_box();
    }
  }

  /** Draw the edge points of the segment as a polygon (upstream draw_temporary_box). */
  draw_temporary_box(): void {
    this.currentcurve.start(this.point2[this.npoints - 1] as Point);
    for (let i = this.npoints - 2; i >= 0; i--) append_line(this.currentcurve, this.point2[i] as Point);
    for (let i = 0; i < this.npoints; i++) append_line(this.currentcurve, this.point1[i] as Point);

    if (this.npoints >= 2) {
      add_cap(
        this.currentcurve,
        this.point1[this.npoints - 1] as Point,
        this.point2[this.npoints - 1] as Point,
        this.cap_rounding,
      );
    }

    this.currentcurve.close();
    this.currentshape.set_bpath([this.currentcurve], true);
  }

  #clearSegments(): void {
    for (const s of this.segments) s.unlink();
    this.segments = [];
  }
}
