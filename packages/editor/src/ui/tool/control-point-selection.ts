// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/control-point-selection.cpp, src/ui/tool/control-point-selection.h
/**
 * Node selection - implementation.
 */
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2009 Authors
 */
import { Preferences, Signal } from '@inkscape-web/core';
import {
  Affine,
  type Dim2,
  distance,
  EPSILON,
  type OptRect,
  Point,
  Rect,
  Rotate,
  Scale,
  Translate,
  X,
} from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import { mod_alt, mod_alt_only, mod_ctrl, mod_shift, type ToolBase } from '../tools/tool-base.ts';
import { CommitEvent } from './commit-events.ts';
import { type ButtonReleaseEvent, ControlPoint, type MotionEvent } from './control-point.ts';
import { Manipulator } from './manipulator.ts';
import { AlignTargetNode } from './node-types.ts';
import type { SelectableControlPoint } from './selectable-control-point.ts';

const mod_none = (s: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) =>
  !s.shiftKey && !s.ctrlKey && !s.metaKey && !s.altKey;
const mod_any = (s: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) =>
  !mod_none(s);

/**
 * Group of selected control points (upstream ControlPointSelection).
 *
 * Some operations can be performed on all selected points regardless of their
 * type, therefore this class is also a Manipulator. It handles the
 * transformations of points using the keyboard.
 *
 * The exposed interface is similar to that of a Set, in insertion order.
 * TODO: TransformHandleSet (scale/rotate handles of the selected nodes), the rotation center.
 */
export class ControlPointSelection extends Manipulator {
  /** Fires when the display needs to be updated to reflect changes. */
  readonly signal_update = new Signal<[]>();
  /**
   * Fires when control points are added to or removed from the selection.
   * The second parameter says whether the points are now selected.
   */
  readonly signal_selection_changed = new Signal<[SelectableControlPoint[], boolean]>();
  /** Fires when a change that needs to be committed to XML happens. */
  readonly signal_commit = new Signal<[CommitEvent]>();

  readonly #points = new Set<SelectableControlPoint>();
  readonly #all_points = new Set<SelectableControlPoint>();
  readonly #original_positions = new Map<SelectableControlPoint, Point>();
  readonly #last_trans = new Map<SelectableControlPoint, Affine>();
  #rot_radius: number | null = null;
  #mouseover_rot_radius: number | null = null;
  #bounds: OptRect = null;
  #grabbed_point: SelectableControlPoint | null = null;
  #farthest_point: SelectableControlPoint | null = null;
  #first_point: Point | null = null;
  #dragging = false;
  #handles_visible = true;
  #one_node_handles = false;
  readonly #disconnectMouseover: () => void;

  constructor(d: SPDesktop) {
    super(d);
    this.#disconnectMouseover = ControlPoint.signal_mouseover_change.connect(() => this.#mouseoverChanged());
  }

  destroy(): void {
    this.clear();
    this.#disconnectMouseover();
  }

  // Set-like interface

  size(): number {
    return this.#points.size;
  }
  empty(): boolean {
    return this.#points.size === 0;
  }
  has(p: SelectableControlPoint): boolean {
    return this.#points.has(p);
  }
  [Symbol.iterator](): IterableIterator<SelectableControlPoint> {
    return this.#points.values();
  }
  /** All points that this selection can contain. */
  allPoints(): Set<SelectableControlPoint> {
    return this.#all_points;
  }

  /** Add a control point to the selection. Returns false if it was already selected. */
  insert(x: SelectableControlPoint, notify = true, to_update = true): boolean {
    if (this.#points.has(x)) return false;
    this.#points.add(x);
    x.updateState();
    if (to_update) this.#update();
    if (notify) this.signal_selection_changed.emit([x], true);
    return true;
  }

  /** Remove a point from the selection. Returns the number of removed points. */
  erase(k: SelectableControlPoint, notify = true): number {
    if (!this.#points.has(k)) return 0;
    this.#points.delete(k);
    k.updateState();
    this.#update();
    if (notify) this.signal_selection_changed.emit([k], false);
    return 1;
  }

  /** Remove all points from the selection, making it empty. */
  clear(): void {
    if (this.empty()) return;
    const out = [...this.#points];
    this.#points.clear();
    for (const erased of out) erased.updateState();
    this.#update();
    this.signal_selection_changed.emit(out, false);
  }

  /** Select all points that this selection can contain. */
  selectAll(): void {
    for (const p of this.#all_points) this.insert(p, false, false);
    const out = [...this.#all_points];
    if (out.length) {
      this.#update();
      this.signal_selection_changed.emit(out, true);
    }
  }

  /**
   * Select all points inside the given rectangle (in desktop coordinates).
   * With invert, deselect them instead.
   * TODO: touch path selection (upstream takes a path and uses its winding).
   */
  selectArea(area: Rect, invert = false): void {
    const out: SelectableControlPoint[] = [];
    for (const p of this.#all_points) {
      if (area.contains(p.position())) {
        if (invert) this.erase(p, false);
        else this.insert(p, false, false);
        out.push(p);
      }
    }
    if (out.length) {
      this.#update();
      this.signal_selection_changed.emit(out, true);
    }
  }

  /** Unselect all selected points and select all unselected points. */
  invertSelection(): void {
    const in_: SelectableControlPoint[] = [];
    const out: SelectableControlPoint[] = [];
    for (const p of this.#all_points) {
      if (p.selected()) {
        in_.push(p);
        this.erase(p, false);
      } else {
        out.push(p);
        this.insert(p, false, false);
      }
    }
    this.#update();
    if (in_.length) this.signal_selection_changed.emit(in_, false);
    if (out.length) this.signal_selection_changed.emit(out, true);
  }

  /** Select the nearest unselected point (dir > 0) or deselect the farthest selected point. */
  spatialGrow(origin: SelectableControlPoint, dir: number): void {
    const grow = dir > 0;
    const p = origin.position();
    let best_dist = grow ? Number.POSITIVE_INFINITY : 0;
    let match: SelectableControlPoint | null = null;
    for (const point of this.#all_points) {
      const selected = point.selected();
      if (grow && !selected) {
        const dist = distance(point.position(), p);
        if (dist < best_dist) {
          best_dist = dist;
          match = point;
        }
      }
      if (!grow && selected) {
        const dist = distance(point.position(), p);
        // use >= to also deselect the origin node when it's the last one selected
        if (dist >= best_dist) {
          best_dist = dist;
          match = point;
        }
      }
    }
    if (match) {
      if (grow) this.insert(match);
      else this.erase(match);
    }
  }

  /** Transform all selected control points by the given affine transformation. */
  transform(m: Affine): void {
    for (const cur of this.#points) cur.transform(m);
    for (const cur of this.#points) cur.fixNeighbors();
    this.#updateBounds();
    // TODO preserving the rotation radius needs some rethinking...
    if (this.#rot_radius !== null) this.#rot_radius *= m.descrim();
    if (this.#mouseover_rot_radius !== null) this.#mouseover_rot_radius *= m.descrim();
    this.signal_update.emit();
  }

  /** Align control points on the specified axis. */
  align(axis: Dim2, target: AlignTargetNode): void {
    if (this.empty()) return;
    const d: Dim2 = ((axis + 1) % 2) as Dim2;
    const coords = [...this.#points].map((p) => p.position().at(d));
    const min = Math.min(...coords);
    const max = Math.max(...coords);
    const list = [...this.#points];
    let new_coord: number;
    switch (target) {
      case AlignTargetNode.FIRST_NODE:
        new_coord = (list[0] as SelectableControlPoint).position().at(d);
        break;
      case AlignTargetNode.LAST_NODE:
        new_coord = (list[list.length - 1] as SelectableControlPoint).position().at(d);
        break;
      case AlignTargetNode.MID_NODE:
        new_coord = (min + max) / 2;
        break;
      case AlignTargetNode.MIN_NODE:
        new_coord = min;
        break;
      case AlignTargetNode.MAX_NODE:
        new_coord = max;
        break;
      default:
        return;
    }
    for (const point of this.#points) {
      const pos = point.position();
      point.move(d === X ? new Point(new_coord, pos.y) : new Point(pos.x, new_coord));
    }
  }

  /** Equidistantly distribute control points by moving them in the specified dimension. */
  distribute(d: Dim2): void {
    if (this.empty()) return;
    const sorted = [...this.#points].sort((a, b) => a.position().at(d) - b.position().at(d));
    const start = (sorted[0] as SelectableControlPoint).position().at(d);
    const end = (sorted[sorted.length - 1] as SelectableControlPoint).position().at(d);
    const step = this.size() === 1 ? 0 : (end - start) / (this.size() - 1);
    sorted.forEach((p, num) => {
      const pos = p.position();
      const c = start + num * step;
      p.move(d === X ? new Point(c, pos.y) : new Point(pos.x, c));
    });
  }

  /** Smallest rectangle containing the positions of all selected points, or null if empty. */
  pointwiseBounds(): OptRect {
    return this.#bounds;
  }

  /** Bounds of the selection; for a single point, its bounds with handles. */
  bounds(): OptRect {
    const first = this.#points.values().next().value;
    return this.size() === 1 && first ? first.bounds() : this.#bounds;
  }

  /**
   * The first selected point is the first selection a user makes, but only
   * if they selected exactly one point. Selecting multiples at once does nothing.
   */
  firstSelectedPoint(): Point | null {
    return this.#first_point;
  }

  transformHandlesEnabled(): boolean {
    return this.#handles_visible;
  }

  showTransformHandles(v: boolean, one_node: boolean): void {
    this.#one_node_handles = one_node;
    this.#handles_visible = v;
    this.#updateTransformHandles(false);
  }

  hideTransformHandles(): void {
    // TODO: TransformHandleSet.
  }

  restoreTransformHandles(): void {
    this.#updateTransformHandles(true);
  }

  toggleTransformHandlesMode(): void {
    // TODO: TransformHandleSet (scale / rotate-skew mode).
  }

  _pointGrabbed(point: SelectableControlPoint): void {
    this.hideTransformHandles();
    this.#dragging = true;
    this.#grabbed_point = point;
    this.#farthest_point = point;
    let maxdist = 0;
    for (const p of this.#points) {
      this.#original_positions.set(p, p.position());
      this.#last_trans.set(p, Affine.identity());
      const dist = distance(point.position(), p.position());
      if (dist > maxdist) {
        maxdist = dist;
        this.#farthest_point = p;
      }
    }
  }

  _pointDragged(new_pos: Point, event: MotionEvent): void {
    const grabbed = this.#grabbed_point;
    if (!grabbed) return;
    const orig = (p: SelectableControlPoint) => this.#original_positions.get(p) ?? p.position();
    const abs_delta = new_pos.sub(orig(grabbed));
    const fdist = this.#farthest_point ? distance(orig(grabbed), orig(this.#farthest_point)) : 0;
    if (mod_alt_only(event) && fdist > 0) {
      // Sculpting
      for (const cur of this.#points) {
        let trans: Affine;
        const dist = distance(orig(cur), orig(grabbed));
        const deltafrac = 0.5 + 0.5 * Math.cos((Math.PI * dist) / fdist);
        if (dist !== 0.0) {
          // The sculpting transformation is not affine, but it can be
          // locally approximated by one. Here we compute the local
          // affine approximation of the sculpting transformation near
          // the currently transformed point. We then transform the point
          // by this approximation. This gives us sensible behavior for node handles.
          const origp = orig(cur);
          const origpx = origp.add(new Point(EPSILON, 0));
          const origpy = origp.add(new Point(0, EPSILON));
          const distdx = distance(origpx, orig(grabbed));
          const distdy = distance(origpy, orig(grabbed));
          const deltafracdx = 0.5 + 0.5 * Math.cos((Math.PI * distdx) / fdist);
          const deltafracdy = 0.5 + 0.5 * Math.cos((Math.PI * distdy) / fdist);
          const newp = origp.add(abs_delta.mul(deltafrac));
          const newpx = origpx.add(abs_delta.mul(deltafracdx));
          const newpy = origpy.add(abs_delta.mul(deltafracdy));
          const newdx = newpx.sub(newp).div(EPSILON);
          const newdy = newpy.sub(newp).div(EPSILON);

          let itrans = new Affine(newdx.x, newdx.y, newdy.x, newdy.y, 0, 0);
          if (itrans.isSingular()) itrans = Affine.identity();

          trans = Translate(cur.position().neg())
            .multiply((this.#last_trans.get(cur) ?? Affine.identity()).inverse())
            .multiply(itrans)
            .multiply(Translate(origp.add(abs_delta.mul(deltafrac))));
          this.#last_trans.set(cur, itrans);
        } else {
          trans = Translate(cur.position().neg().add(orig(cur)).add(abs_delta.mul(deltafrac)));
        }
        cur.transform(trans);
      }
    } else {
      for (const cur of this.#points) cur.move(orig(cur).add(abs_delta));
      // TODO: move the rotation center of the transform handles.
    }
    for (const cur of this.#points) cur.fixNeighbors();
    this.signal_update.emit();
  }

  _pointUngrabbed(): void {
    this.#original_positions.clear();
    this.#last_trans.clear();
    this.#dragging = false;
    this.#grabbed_point = this.#farthest_point = null;
    this.#updateBounds();
    this.restoreTransformHandles();
    this.signal_commit.emit(CommitEvent.COMMIT_MOUSE_MOVE);
  }

  _pointClicked(p: SelectableControlPoint, event: ButtonReleaseEvent): boolean {
    // clicking a selected node should toggle the transform handles between rotate and scale mode,
    // if they are visible
    if (mod_none(event) && this.#handles_visible && p.selected()) {
      this.toggleTransformHandlesMode();
      return true;
    }
    return false;
  }

  #mouseoverChanged(): void {
    this.#mouseover_rot_radius = null;
  }

  #update(): void {
    this.#updateBounds();
    this.#updateTransformHandles(false);
    // This records the first node's position, ONLY if it was individually selected
    // Any clearing and this first position is cleared too. Any more and we remember it unchanged.
    if (this.empty()) this.#first_point = null;
    else if (this.size() === 1) this.#first_point = this.#points.values().next().value?.position() ?? null;
  }

  #updateBounds(): void {
    this.#rot_radius = null;
    this.#bounds = null;
    for (const cur of this.#points) {
      const p = cur.position();
      this.#bounds = this.#bounds ? this.#bounds.expandTo(p) : new Rect(p, p);
    }
  }

  #updateTransformHandles(_preserve_center: boolean): void {
    if (this.#dragging) return;
    // TODO: show the TransformHandleSet when #handles_visible && size() > 1,
    // or #one_node_handles && size() == 1.
    void this.#one_node_handles;
  }

  /** The center for keyboard rotation, scaling and flipping: the mouseovered point or the bounds center. */
  #transformCenter(): Point | null {
    const mp = ControlPoint.mouseovered_point;
    if (mp && this.#all_points.has(mp as SelectableControlPoint)) return mp.position();
    // TODO: the rotation center of the transform handles.
    return this.bounds()?.midpoint() ?? null;
  }

  /** Moves the selected points along the supplied unit vector according to the modifier state of the event. */
  #keyboardMove(event: KeyboardEvent, dir: Point): boolean {
    if (mod_ctrl(event)) return false;
    // TODO: count repeated key events (gobble_key_events).
    const prefs = Preferences.get();
    let delta = dir;
    if (mod_shift(event)) delta = delta.mul(10);
    if (mod_alt(event)) {
      delta = delta.div(this._desktop.current_zoom());
    } else {
      const nudge = Math.min(Math.max(prefs.getDouble('/options/nudgedistance/value', 2), 0), 1000);
      delta = delta.mul(nudge);
    }
    // TODO: the canvas rotation (/options/moverotated/value).
    this.transform(Translate(delta));
    this.signal_commit.emit(
      dir.x !== 0 ? CommitEvent.COMMIT_KEYBOARD_MOVE_X : CommitEvent.COMMIT_KEYBOARD_MOVE_Y,
    );
    return true;
  }

  /**
   * Computes the distance to the farthest corner of the bounding box.
   * Used to determine what it means to "rotate by one pixel".
   */
  #rotationRadius(rc: Point): number {
    if (this.empty()) return 1.0; // some safe value
    const b = this.bounds();
    if (!b) return 1.0;
    return Math.max(...b.corners().map((c) => distance(c, rc)));
  }

  /**
   * Rotates the selected points in the given direction according to the modifier state
   * from the supplied event. dir is the direction of rotation (math convention:
   * 1 = counterclockwise, -1 = clockwise).
   */
  #keyboardRotate(event: KeyboardEvent, dir: number): boolean {
    if (this.empty()) return false;
    const rc = this.#transformCenter();
    if (!rc) return false;
    // rotate around the mouseovered point, or the selection's rotation center
    // if nothing is mouseovered
    let radius: number;
    if (ControlPoint.mouseovered_point) {
      this.#mouseover_rot_radius ??= this.#rotationRadius(rc);
      radius = this.#mouseover_rot_radius;
    } else {
      this.#rot_radius ??= this.#rotationRadius(rc);
      radius = this.#rot_radius;
    }
    let angle: number;
    if (mod_alt(event)) {
      // Rotate by "one pixel". We interpret this as rotating by an angle that causes
      // the topmost point of a circle circumscribed about the selection's bounding box
      // to move on an arc 1 screen pixel long.
      angle = Math.atan2(1.0 / this._desktop.current_zoom(), radius) * dir;
    } else {
      const snaps = Math.min(
        Math.max(Preferences.get().getDouble('/options/rotationsnapsperpi/value', 12.0), 0.1),
        1800.0,
      );
      angle = (Math.PI * dir) / snaps;
    }
    // translate to origin, rotate, translate back to original position
    this.transform(Translate(rc.neg()).multiply(Rotate(angle)).multiply(Translate(rc)));
    this.signal_commit.emit(CommitEvent.COMMIT_KEYBOARD_ROTATE);
    return true;
  }

  #keyboardScale(event: KeyboardEvent, dir: number): boolean {
    if (this.empty()) return false;
    const maxext = this.bounds()?.maxExtent() ?? 0;
    if (Math.abs(maxext) < EPSILON) return false;
    const center = this.#transformCenter();
    if (!center) return false;
    let length_change: number;
    if (mod_alt(event)) {
      // Scale by "one pixel". It means shrink/grow 1px for the larger dimension
      // of the bounding box.
      length_change = (1.0 / this._desktop.current_zoom()) * dir;
    } else {
      length_change =
        Math.min(Math.max(Preferences.get().getDouble('/options/defaultscale/value', 2), 1), 1000) * dir;
    }
    const scale = (maxext + length_change) / maxext;
    this.transform(Translate(center.neg()).multiply(Scale(scale)).multiply(Translate(center)));
    this.signal_commit.emit(CommitEvent.COMMIT_KEYBOARD_SCALE_UNIFORM);
    return true;
  }

  #keyboardFlip(d: Dim2): boolean {
    if (this.empty()) return false;
    const center = this.#transformCenter();
    if (!center) return false;
    const scale_transform = d === X ? Scale(-1, 1) : Scale(1, -1);
    this.transform(Translate(center.neg()).multiply(scale_transform).multiply(Translate(center)));
    this.signal_commit.emit(d === X ? CommitEvent.COMMIT_FLIP_X : CommitEvent.COMMIT_FLIP_Y);
    return true;
  }

  /** Keyboard moves and transformations of the selected points. */
  event(_tool: ToolBase, event: Event): boolean {
    if (event.type !== 'keydown' || this.empty()) return false;
    const e = event as KeyboardEvent;
    const y_dir = this._desktop.yaxisdir();
    const P = (x: number, y: number) => new Point(x, y);
    switch (e.key) {
      // moves
      case 'ArrowUp':
        return this.#keyboardMove(e, P(0, -y_dir));
      case 'ArrowDown':
        return this.#keyboardMove(e, P(0, y_dir));
      case 'ArrowRight':
        return this.#keyboardMove(e, P(1, 0));
      case 'ArrowLeft':
        return this.#keyboardMove(e, P(-1, 0));
      // rotates
      case '[':
        return this.#keyboardRotate(e, -y_dir);
      case ']':
        return this.#keyboardRotate(e, y_dir);
      // scaling
      case '<':
      case ',':
        return this.#keyboardScale(e, -1);
      case '>':
      case '.':
        return this.#keyboardScale(e, 1);
      // TODO: skewing
      // flipping
      // NOTE: H is horizontal flip, while Shift+H switches transform handle mode!
      case 'h':
      case 'H':
        if (mod_shift(e)) {
          this.toggleTransformHandlesMode();
          return true;
        }
        // any modifiers except shift should cause no action
        if (mod_any(e)) break;
        return this.#keyboardFlip(X);
      case 'v':
      case 'V':
        if (mod_any(e)) break;
        return this.#keyboardFlip(1);
    }
    return false;
  }

  /** Remember the current positions as the original positions of a drag. */
  setOriginalPoints(): void {
    this.#original_positions.clear();
    for (const p of this.#points) this.#original_positions.set(p, p.position());
  }
}
