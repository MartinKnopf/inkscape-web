// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/node.cpp, src/ui/tool/node.h
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2009 Authors
 */
import { _, Preferences, SnapCandidatePoint, SnapSourceType, SnapTargetType } from '@inkscape-web/core';
import {
  type Affine,
  angle_between,
  are_near,
  atan2,
  CubicBezier,
  distance,
  dot,
  L2sq,
  LineSegment,
  nearest_time,
  Path,
  type PathBuilder,
  Point,
  Rect,
  rot90,
  unit_vector,
} from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { CanvasItemGroup } from '../../display/control/canvas-item.ts';
import { CanvasItemCtrlType, HandleSize } from '../../display/control/canvas-item-ctrl.ts';
import { CanvasItemCurve } from '../../display/control/canvas-item-curve.ts';
import { SPAnchorType } from '../../enums.ts';
import { SnapConstraint } from '../../snapper.ts';
import { type ModifierState, mod_alt, mod_ctrl, mod_shift } from '../tools/tool-base.ts';
import { type ButtonReleaseEvent, ControlPoint, type MotionEvent, type State } from './control-point.ts';
import type { ControlPointSelection } from './control-point-selection.ts';
import { NodeType } from './node-types.ts';
import type { PathManipulator } from './path-manipulator.ts';
import { SelectableControlPoint } from './selectable-control-point.ts';

// Modifiers of the node tool (upstream Modifiers::Modifier defaults in src/ui/modifiers.cpp).
/** move-confine: Ctrl */
const move_confine = (s: ModifierState) => mod_ctrl(s);
/** node-confine-handles: Ctrl+Alt */
const node_confine_handles = (s: ModifierState) => mod_ctrl(s) && mod_alt(s);
/** node-confine-to-path: Alt */
const node_confine_to_path = (s: ModifierState) => mod_alt(s);
/** node-drag-handle: Shift */
const node_drag_handle = (s: ModifierState) => mod_shift(s);
/** node-link-handles: Shift */
const node_link_handles = (s: ModifierState) => mod_shift(s);
/** node-preserve-length: Alt */
const node_preserve_length = (s: ModifierState) => mod_alt(s);
/** move-snapping ("No Move Snapping"): no modifier in share/keys/inkscape.xml. */
const move_no_snapping = (_s: ModifierState) => false;

function nodeTypeToCtrlType(type: NodeType): CanvasItemCtrlType {
  switch (type) {
    case NodeType.NODE_SMOOTH:
      return CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_SMOOTH;
    case NodeType.NODE_AUTO:
      return CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_AUTO;
    case NodeType.NODE_SYMMETRIC:
      return CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_SYMMETRICAL;
    default:
      return CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_CUSP;
  }
}

/** Relative rounding error of the SVG output with /options/svgoutput/numericprecision digits. */
function serializing_error_of(point: Point): number {
  const digits = Math.min(
    Math.max(Preferences.get().getInt('/options/svgoutput/numericprecision', 10), 1),
    16,
  );
  // the error is half of last digit
  return point.length() * 0.5 * 10 ** -digits;
}

/** Returns true if three points are collinear within current serializing precision */
function are_collinear_within_serializing_error(A: Point, B: Point, C: Point): boolean {
  const tolerance_factor = 10; // to account other factors which increase uncertainty
  const tolerance_A = serializing_error_of(A) * tolerance_factor;
  const tolerance_B = serializing_error_of(B) * tolerance_factor;
  const tolerance_C = serializing_error_of(C) * tolerance_factor;
  const CB_length = B.sub(C).length();
  const AB_length = B.sub(A).length();
  const C_reflect_scaled = B.add(B.sub(C).div(CB_length).mul(AB_length));
  const tolerance_C_reflect_scaled =
    tolerance_B +
    (tolerance_B + tolerance_C) *
      (1 + (tolerance_A + tolerance_B) / AB_length) *
      (1 + (tolerance_C + tolerance_B) / CB_length);
  return are_near(C_reflect_scaled, A, tolerance_C_reflect_scaled + tolerance_A);
}

/** Node type letter of sodipodi:nodetypes. */
export function nodeTypeChar(type: NodeType): string {
  switch (type) {
    case NodeType.NODE_CUSP:
      return 'c';
    case NodeType.NODE_SMOOTH:
      return 's';
    case NodeType.NODE_AUTO:
      return 'a';
    case NodeType.NODE_SYMMETRIC:
      return 'z';
    default:
      return 'b';
  }
}

/** Computes an unit vector of the direction from first to second control point */
function direction(first: Point, second: Point): Point {
  return unit_vector(second.sub(first));
}

/** The point of the line through a and b nearest to p (upstream Line::pointAt(nearestTime(p))). */
function project_on_line(a: Point, b: Point, p: Point): Point {
  const d = b.sub(a);
  const l2 = L2sq(d);
  if (l2 === 0) return a;
  return a.add(d.mul(dot(p.sub(a), d) / l2));
}

/**
 * The point at the angle nearest to B, in n steps of the full turn from dir,
 * at the distance of B from A (upstream Geom::constrain_angle).
 */
function constrain_angle(A: Point, B: Point, n: number, dir: Point): Point {
  if (n === 0) return B;
  const diff = B.sub(A);
  const angle = -angle_between(diff, dir);
  const k = Math.round((angle * n) / (2.0 * Math.PI));
  return A.add(Point.polar(atan2(dir) + (k * 2.0 * Math.PI) / n, diff.length()));
}

/** Canvas groups and the selection shared by all nodes of the node tool (upstream NodeSharedData). */
export interface NodeSharedData {
  desktop: SPDesktop;
  selection: ControlPointSelection;
  node_group: CanvasItemGroup;
  handle_group: CanvasItemGroup;
  handle_line_group: CanvasItemGroup;
}

/** A link of the circular node lists; NodeList is the sentinel (upstream ListNode). */
export interface ListNode {
  ln_next: ListNode;
  ln_prev: ListNode;
  ln_list: NodeList;
}

/**
 * Control point of a cubic Bezier curve in a path (upstream Handle).
 *
 * Handle keeps the node type invariant only for the opposite handle of the same node.
 * Keeping the invariant on node moves is left to the Node class.
 */
export class Handle extends ControlPoint {
  static _saved_other_pos = new Point(0, 0);
  static _saved_dir = new Point(0, 0);
  static _saved_length = 0.0;
  static _drag_out = false;

  // the handle's lifetime does not extend beyond that of the parent node
  readonly #parent: Node;
  readonly #handle_line: CanvasItemCurve;
  /** True if the handle is retracted, i.e. has zero length. */
  #degenerate = true;

  constructor(data: NodeSharedData, initial_pos: Point, parent: Node) {
    super(
      data.desktop,
      initial_pos,
      SPAnchorType.SP_ANCHOR_CENTER,
      CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_ROTATE,
      data.handle_group,
    );
    this.#handle_line = new CanvasItemCurve(data.handle_line_group);
    this.#parent = parent;
    this.setVisible(false);
  }

  override destroy(): void {
    this.#handle_line.unlink();
    super.destroy();
  }

  relativePos(): Point {
    return this.position().sub(this.#parent.position());
  }
  length(): number {
    return this.relativePos().length();
  }
  /** True if the handle is retracted, i.e. has zero length. */
  isDegenerate(): boolean {
    return this.#degenerate;
  }
  parent(): Node {
    return this.#parent;
  }
  other(): Handle {
    return this === this.#parent._front ? this.#parent._back : this.#parent._front;
  }

  #pm(): PathManipulator {
    return this.#parent._pm();
  }

  override setVisible(v: boolean): void {
    super.setVisible(v);
    this.#handle_line.set_visible(v);
    this.set_selected_appearance(this.#parent.selected());
  }

  override move(new_pos: Point): void {
    const other = this.other();
    const node_towards = this.#parent.nodeToward(this); // node in direction of this handle
    const node_away = this.#parent.nodeAwayFrom(this); // node in the opposite direction
    const towards = node_towards ? node_towards.handleAwayFrom(this.#parent) : null;
    const towards_second = node_towards ? node_towards.handleToward(this.#parent) : null;
    if (are_near(new_pos, this.#parent.position())) {
      // The handle becomes degenerate.
      // Adjust node type as necessary.
      if (other.isDegenerate()) {
        // If both handles become degenerate, convert to parent cusp node
        this.#parent.setType(NodeType.NODE_CUSP, false);
      } else {
        // Only 1 handle becomes degenerate
        switch (this.#parent.type()) {
          case NodeType.NODE_AUTO:
          case NodeType.NODE_SYMMETRIC:
            this.#parent.setType(NodeType.NODE_SMOOTH, false);
            break;
          default:
            // do nothing for other node types
            break;
        }
      }
      // If the segment between the handle and the node in its direction becomes linear,
      // and there are smooth nodes at its ends, make their handles collinear with the segment.
      if (towards && node_towards && towards_second?.isDegenerate()) {
        if (node_towards.type() === NodeType.NODE_SMOOTH) {
          towards.setDirection(this.#parent.position(), node_towards.position());
        }
        if (this.#parent.type() === NodeType.NODE_SMOOTH) {
          other.setDirection(node_towards.position(), this.#parent.position());
        }
      }
      this.setPosition(new_pos);
      return;
    }

    if (this.#parent.type() === NodeType.NODE_SMOOTH && Node._is_line_segment(this.#parent, node_away)) {
      // restrict movement to the line joining the nodes
      const dir = this.#parent.position().sub((node_away as Node).position());
      const delta = new_pos.sub(this.#parent.position());
      // project the relative position on the direction line
      const direction_length = L2sq(dir);
      // joining line has zero length - any direction is okay, prevent division by zero
      const new_delta = direction_length === 0 ? delta : dir.mul(dot(delta, dir) / direction_length);
      this.setRelativePos(new_delta);
      return;
    }

    switch (this.#parent.type()) {
      case NodeType.NODE_AUTO:
        this.#parent.setType(NodeType.NODE_SMOOTH, false);
        // for smooth nodes, we need to rotate the opposite handle
        // so that it's collinear with the dragged one, while conserving length.
        other.setDirection(new_pos, this.#parent.position());
        break;
      case NodeType.NODE_SMOOTH:
        // auto nodes degrade into smooth nodes (above)
        other.setDirection(new_pos, this.#parent.position());
        break;
      case NodeType.NODE_SYMMETRIC:
        // for symmetric nodes, place the other handle on the opposite side
        other.setRelativePos(new_pos.sub(this.#parent.position()).neg());
        break;
      default:
        break;
    }
    this.setPosition(new_pos);
  }

  override setPosition(p: Point): void {
    super.setPosition(p);
    this.#handle_line.set_coords(this.#parent.position(), this.position());
    // update degeneration info and visibility
    this.#degenerate = are_near(this.position(), this.#parent.position());
    this.setVisible(this.#parent._handles_shown && this.#parent.visible() && !this.#degenerate);
  }

  setRelativePos(p: Point): void {
    this.setPosition(this.#parent.position().add(p));
  }

  setLength(len: number): void {
    if (this.isDegenerate()) return;
    this.setRelativePos(unit_vector(this.relativePos()).mul(len));
  }

  retract(): void {
    this.move(this.#parent.position());
  }

  /** Point the handle from `from` to `to` (or along dir), keeping its length. */
  setDirection(from: Point, to?: Point): void {
    const dir = to ? to.sub(from) : from;
    this.setRelativePos(unit_vector(dir).mul(this.length()));
  }

  override grabbed(_event: MotionEvent): boolean {
    Handle._saved_other_pos = this.other().position();
    Handle._saved_length = Handle._drag_out ? 0 : this.length();
    Handle._saved_dir = unit_vector(this._last_drag_origin().sub(this.#parent.position()));
    this.#pm()._handleGrabbed();
    return false;
  }

  override dragged(new_pos: Point, event: MotionEvent): Point {
    const confine = move_confine(event);
    const link_handles = node_link_handles(event);
    const preserve_length = node_preserve_length(event);

    const parent_pos = this.#parent.position();
    const origin = this._last_drag_origin();

    if (preserve_length) {
      // with Alt, preserve length of the handle
      new_pos = parent_pos.add(unit_vector(new_pos.sub(parent_pos)).mul(Handle._saved_length));
      Handle._saved_dir = unit_vector(this.relativePos());
    } else {
      // with nothing pressed we update the lengths
      Handle._saved_length = Handle._drag_out ? 0 : this.length();
      Handle._saved_dir = unit_vector(this.relativePos());
    }

    if (this.#parent.type() !== NodeType.NODE_CUSP && link_handles && !preserve_length) {
      // if we hold Shift, and node is not cusp, link the two handles
      this.other().setRelativePos(this.relativePos().neg());
    }

    // with Ctrl, constrain to M_PI/rotationsnapsperpi increments from vertical
    // and the original position.
    if (confine) {
      const snaps =
        2 *
        Math.min(
          Math.max(Preferences.get().getDouble('/options/rotationsnapsperpi/value', 12.0), 0.1),
          1800.0,
        );
      // note: if snapping to the original position is only desired in the original
      // direction of the handle, use Geom::Ray instead of Geom::Line
      const snap_pos = parent_pos.add(
        constrain_angle(new Point(0, 0), new_pos.sub(parent_pos), snaps, new Point(1, 0)),
      );
      const orig_pos = project_on_line(parent_pos, origin, new_pos);
      const perp_pos = project_on_line(parent_pos, parent_pos.add(rot90(origin.sub(parent_pos))), new_pos);
      let result = snap_pos;
      if (distance(orig_pos, new_pos) < distance(result, new_pos)) result = orig_pos;
      if (distance(perp_pos, new_pos) < distance(result, new_pos)) result = perp_pos;
      new_pos = result;
    }

    // Snap the handle to the stationary path segments and other targets (not with Alt).
    // TODO: the constraint along the line segment of smooth nodes, B-splines.
    const sm = this._desktop.getSnapManager();
    sm.setup(this._desktop);
    const snap = !move_no_snapping(event) && !preserve_length && sm.someSnapperMightSnap();
    sm.unSetup();
    if (snap) {
      // We will only snap this handle to stationary path segments; some path segments may move as we move the
      // handle; those path segments are connected to the parent node of this handle.
      const unselected: SnapCandidatePoint[] = [];
      for (const n of this.#parent._selection.allPoints()) {
        if (n !== this.#parent && n instanceof Node) {
          unselected.push(new SnapCandidatePoint(n.position(), n._snapSourceType(), n._snapTargetType()));
        }
      }
      sm.setupIgnoreSelection(this._desktop, true, unselected);
      const candidate = new SnapCandidatePoint(new_pos, SnapSourceType.SNAPSOURCE_NODE_HANDLE);
      new_pos = confine
        ? sm.constrainedSnap(candidate, SnapConstraint.line(parent_pos, parent_pos.sub(new_pos))).getPoint()
        : sm.freeSnap(candidate).getPoint();
      sm.unSetup();
    }

    if (this.#parent.type() === NodeType.NODE_CUSP && !Handle._drag_out) {
      if (link_handles) {
        // rotate the other handle as well
        const angle = angle_between(origin.sub(parent_pos), new_pos.sub(parent_pos));
        const rel = Handle._saved_other_pos.sub(parent_pos);
        this.other().setRelativePos(Point.polar(atan2(rel) + angle, rel.length()));
      } else {
        // restore the position
        this.other().setPosition(Handle._saved_other_pos);
      }
    }
    // The handle moves after this call; update the path with the new position.
    this.move(new_pos);
    this.#pm().update();
    return new_pos;
  }

  override ungrabbed(event: ButtonReleaseEvent | null): void {
    // hide the handle if it's less than dragtolerance away from the node
    // however, never do this for cancelled drag / broken grab
    // TODO is this actually a good idea?
    if (event) {
      const drag_tolerance = Math.min(
        Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0),
        100,
      );
      const dist = this._desktop.d2w(this.#parent.position()).sub(this._desktop.d2w(this.position()));
      if (dist.length() <= drag_tolerance) this.move(this.#parent.position());
    }
    // HACK: If the handle was dragged out, call parent's ungrabbed handler,
    // so that transform handles reappear
    if (Handle._drag_out) this.#parent.ungrabbed(event);
    Handle._drag_out = false;
    this.#pm()._handleUngrabbed();
  }

  override clicked(event: ButtonReleaseEvent): boolean {
    if (this.#pm()._nodeClicked(this.#parent, event, true)) return true;
    this.#pm()._handleClicked(this, event);
    return true;
  }

  /** Name of a handle of a node type, for tips. */
  static handle_type_to_localized_string(type: NodeType): string {
    switch (type) {
      case NodeType.NODE_CUSP:
        return _('Corner node handle');
      case NodeType.NODE_SMOOTH:
        return _('Smooth node handle');
      case NodeType.NODE_SYMMETRIC:
        return _('Symmetric node handle');
      case NodeType.NODE_AUTO:
        return _('Auto-smooth node handle');
      default:
        return '';
    }
  }
}

/**
 * Curve endpoint in an editable path (upstream Node).
 *
 * The method move() keeps node type invariants during translations.
 * TODO: linear and spatial grow (scroll, Page Up/Down), tips, BSpline paths.
 */
export class Node extends SelectableControlPoint implements ListNode {
  ln_next!: ListNode;
  ln_prev!: ListNode;
  ln_list!: NodeList;

  // Handles are always present, but are not visible if they coincide with the node
  // (are degenerate). A segment that has both handles degenerate is always treated
  // as a line segment
  /** Node handle in the backward direction of the path */
  readonly _front: Handle;
  /** Node handle in the forward direction of the path */
  readonly _back: Handle;
  /** Type of node - cusp, smooth... */
  _type = NodeType.NODE_CUSP;
  _handles_shown = false;
  /** Created on mouse down, this segment contains the curve between the previous node and the next node used for confine-to-path. */
  #short_segment_path: Path | null = null;
  /** This is used by fixNeighbors to repair smooth nodes after all move operations have been completed. */
  #unfixed_pos: Point | null = null;

  constructor(data: NodeSharedData, initial_pos: Point) {
    super(
      data.desktop,
      initial_pos,
      SPAnchorType.SP_ANCHOR_CENTER,
      CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_NODE_CUSP,
      data.selection,
      data.node_group,
    );
    this._front = new Handle(data, initial_pos, this);
    this._back = new Handle(data, initial_pos, this);
    // NOTE we do not set type here, because the handles are still degenerate
  }

  override destroy(): void {
    super.destroy();
    this._front.destroy();
    this._back.destroy();
  }

  _pm(): PathManipulator {
    return this.ln_list.subpathList().pm();
  }

  nodeList(): NodeList {
    return this.ln_list;
  }

  type(): NodeType {
    return this._type;
  }
  front(): Handle {
    return this._front;
  }
  back(): Handle {
    return this._back;
  }
  isDegenerate(): boolean {
    return this._front.isDegenerate() && this._back.isDegenerate();
  }

  _next(): Node | null {
    const n = NodeList.get_iterator(this).next();
    return n.valid() ? n.ptr() : null;
  }

  _prev(): Node | null {
    const p = NodeList.get_iterator(this).prev();
    return p.valid() ? p.ptr() : null;
  }

  override move(new_pos: Point): void {
    // move handles when the node moves.
    const delta = new_pos.sub(this.position());
    // Save original position for post-processing
    this.#unfixed_pos = this.position();
    this.setPosition(new_pos);
    this._front.setPosition(this._front.position().add(delta));
    this._back.setPosition(this._back.position().add(delta));
  }

  override transform(m: Affine): void {
    // Save original position for post-processing
    this.#unfixed_pos = this.position();
    this.setPosition(this.position().transformed(m));
    this._front.setPosition(this._front.position().transformed(m));
    this._back.setPosition(this._back.position().transformed(m));
  }

  override bounds(): Rect {
    return new Rect(this.position(), this.position())
      .expandTo(this._front.position())
      .expandTo(this._back.position());
  }

  /**
   * Affine transforms keep handle invariants for smooth and symmetric nodes,
   * but smooth nodes at ends of linear segments and auto nodes need special treatment
   *
   * Call this function once you have finished called move or transform on ALL nodes
   * that are being transformed in that one operation to avoid problematic bugs.
   */
  override fixNeighbors(): void {
    if (!this.#unfixed_pos) return;
    const new_pos = this.position();

    // This method restores handle invariants for neighboring nodes,
    // and invariants that are based on positions of those nodes for this one.

    // Fix auto handles
    if (this._type === NodeType.NODE_AUTO) this._updateAutoHandles();
    if (!this.#unfixed_pos.equals(new_pos)) {
      const next = this._next();
      const prev = this._prev();
      if (next && next._type === NodeType.NODE_AUTO) next._updateAutoHandles();
      if (prev && prev._type === NodeType.NODE_AUTO) prev._updateAutoHandles();
    }

    /* Fix smooth handles at the ends of linear segments.
       Rotate the appropriate handle to be collinear with the segment.
       If there is a smooth node at the other end of the segment, rotate it too. */
    let handle: Handle;
    let other: Node;
    let other_handle: Handle;
    const next = this._next();
    const prev = this._prev();
    if (next && Node._is_line_segment(this, next)) {
      handle = this._back;
      other = next;
      other_handle = next._front;
    } else if (prev && Node._is_line_segment(prev, this)) {
      handle = this._front;
      other = prev;
      other_handle = prev._back;
    } else {
      return;
    }

    if (this._type === NodeType.NODE_SMOOTH && !handle.isDegenerate()) {
      handle.setDirection(other.position(), new_pos);
    }
    // also update the handle on the other end of the segment
    if (other._type === NodeType.NODE_SMOOTH && !other_handle.isDegenerate()) {
      other_handle.setDirection(new_pos, other.position());
    }
    this.#unfixed_pos = null;
  }

  _updateAutoHandles(): void {
    // Recompute the position of automatic handles. For endnodes, retract both handles.
    // (It's only possible to create an end auto node through the XML editor.)
    const next = this._next();
    const prev = this._prev();
    if (!next || !prev) {
      this._front.retract();
      this._back.retract();
      return;
    }
    // auto nodes automatically adjust their handles to give
    // an appearance of smoothness, no matter what their surroundings are.
    const vec_next = next.position().sub(this.position());
    const vec_prev = prev.position().sub(this.position());
    const len_next = vec_next.length();
    const len_prev = vec_prev.length();
    if (len_next > 0 && len_prev > 0) {
      // "dir" is an unit vector perpendicular to the bisector of the angle created
      // by the previous node, this auto node and the next node.
      const dir = unit_vector(vec_next.mul(len_prev / len_next).sub(vec_prev));
      // Handle lengths are equal to 1/3 of the distance from the adjacent node.
      this._back.setRelativePos(dir.neg().mul(len_prev / 3));
      this._front.setRelativePos(dir.mul(len_next / 3));
    } else {
      // If any of the adjacent nodes coincides, retract both handles.
      this._front.retract();
      this._back.retract();
    }
  }

  showHandles(v: boolean): void {
    this._handles_shown = v;
    if (!this._front.isDegenerate()) this._front.setVisible(v);
    if (!this._back.isDegenerate()) this._back.setVisible(v);
  }

  updateHandles(): void {
    this._handleControlStyling();
    this._front._handleControlStyling();
    this._back._handleControlStyling();
  }

  /**
   * Sets the node type and optionally restores the invariants associated with the given type.
   * update_handles: Whether to restore invariants associated with the given type.
   * Passing false is useful e.g. when initially creating the path,
   * and when making cusp nodes during some node algorithms.
   * Pass true when used in response to an UI node type button.
   */
  setType(type: NodeType, update_handles = true): void {
    if (type === NodeType.NODE_PICK_BEST) {
      this.pickBestType();
      this.updateState(); // The size of the control might have changed
      return;
    }

    // if update_handles is true, adjust handle positions to match the node type
    // handle degenerate handles appropriately
    if (update_handles) {
      const next = this._next();
      const prev = this._prev();
      switch (type) {
        case NodeType.NODE_CUSP:
          // nothing to do
          break;
        case NodeType.NODE_AUTO:
          // auto handles make no sense for endnodes
          if (this.isEndNode()) return;
          this._updateAutoHandles();
          break;
        case NodeType.NODE_SMOOTH: {
          // ignore attempts to make smooth endnodes.
          if (this.isEndNode() || !next || !prev) return;
          // rotate handles to be collinear
          // for degenerate nodes set positions like auto handles
          const prev_line = Node._is_line_segment(prev, this);
          const next_line = Node._is_line_segment(this, next);
          if (this._type === NodeType.NODE_SMOOTH) {
            // For a node that is already smooth and has a degenerate handle,
            // drag out the second handle without changing the direction of the first one.
            if (this._front.isDegenerate()) {
              const dist = distance(next.position(), this.position());
              this._front.setRelativePos(unit_vector(this._back.relativePos().neg()).mul(dist / 3));
            }
            if (this._back.isDegenerate()) {
              const dist = distance(prev.position(), this.position());
              this._back.setRelativePos(unit_vector(this._front.relativePos().neg()).mul(dist / 3));
            }
          } else if (this.isDegenerate()) {
            this._updateAutoHandles();
          } else if (this._front.isDegenerate()) {
            // if the front handle is degenerate and next path segment is a line, make back collinear;
            // otherwise, pull out the other handle to 1/3 of distance to prev.
            if (next_line) {
              this._back.setDirection(next.position(), this.position());
            } else {
              const dir = direction(this._back.position(), this.position());
              this._front.setRelativePos(dir.mul(distance(prev.position(), this.position()) / 3));
            }
          } else if (this._back.isDegenerate()) {
            if (prev_line) {
              this._front.setDirection(prev.position(), this.position());
            } else {
              const dir = direction(this._front.position(), this.position());
              this._back.setRelativePos(dir.mul(distance(next.position(), this.position()) / 3));
            }
          } else {
            /* both handles are extended. make collinear while keeping length.
               first make back collinear with the vector front ---> back,
               then make front collinear with back ---> node.
               (not back ---> front, because back's position was changed in the first call) */
            this._back.setDirection(this._front.position(), this._back.position());
            this._front.setDirection(this._back.position(), this.position());
          }
          break;
        }
        case NodeType.NODE_SYMMETRIC:
          if (this.isEndNode() || !next || !prev) return; // symmetric handles make no sense for endnodes
          if (this.isDegenerate()) {
            // similar to auto handles but set the same length for both
            const vec_next = next.position().sub(this.position());
            const vec_prev = prev.position().sub(this.position());
            const len_next = vec_next.length();
            const len_prev = vec_prev.length();
            // Don't change a degenerate node if it overlaps a neighbor.
            if (len_next === 0 || len_prev === 0) return;
            const len = (len_next + len_prev) / 6; // take 1/3 of average
            if (len === 0) return;
            const dir = unit_vector(vec_next.mul(len_prev / len_next).sub(vec_prev));
            this._back.setRelativePos(dir.neg().mul(len));
            this._front.setRelativePos(dir.mul(len));
          } else {
            // At least one handle is extended. Compute average length, use direction from
            // back handle to front handle. This also works correctly for degenerates
            const len = (this._front.length() + this._back.length()) / 2;
            const dir = direction(this._back.position(), this._front.position());
            this._front.setRelativePos(dir.mul(len));
            this._back.setRelativePos(dir.neg().mul(len));
          }
          break;
        default:
          break;
      }
    }
    this._type = type;
    this._setControlType(nodeTypeToCtrlType(this._type));
    this.updateState();
  }

  /**
   * Pick the best type for this node, based on the position of its handles.
   * This is what assigns types to nodes created using the pen tool.
   */
  pickBestType(): void {
    this._type = this.#looksSmooth() ? NodeType.NODE_SMOOTH : NodeType.NODE_CUSP;
    this._setControlType(nodeTypeToCtrlType(this._type));
    this.updateState();
  }

  /** Whether the handles (or a handle and a line segment) are collinear, for pickBestType(). */
  #looksSmooth(): boolean {
    const front_degen = this._front.isDegenerate();
    const back_degen = this._back.isDegenerate();
    // if both handles are degenerate, do nothing
    if (front_degen && back_degen) return false;
    // if neither are degenerate, check their respective positions
    // for now do not automatically make nodes symmetric, it can be annoying
    if (
      !front_degen &&
      !back_degen &&
      are_collinear_within_serializing_error(this._front.position(), this.position(), this._back.position())
    ) {
      return true;
    }
    // check whether the handle aligns with the previous line segment.
    // we know that if front is degenerate, back isn't, because
    // both_degen was false
    const next = this._next();
    const prev = this._prev();
    if (front_degen && next?._back.isDegenerate()) {
      return are_collinear_within_serializing_error(next.position(), this.position(), this._back.position());
    }
    if (back_degen && prev?._front.isDegenerate()) {
      return are_collinear_within_serializing_error(prev.position(), this.position(), this._front.position());
    }
    return false;
  }

  isEndNode(): boolean {
    return !this._prev() || !this._next();
  }

  /** Gets the handle that faces the given adjacent node. */
  handleToward(to: Node): Handle {
    if (this._next() === to) return this._front;
    if (this._prev() === to) return this._back;
    throw new Error('Node.handleToward(): second node is not adjacent!');
  }

  /** Gets the node in the direction of the given handle. */
  nodeToward(dir: Handle): Node | null {
    if (this._front === dir) return this._next();
    if (this._back === dir) return this._prev();
    throw new Error('Node.nodeToward(): handle is not a child of this node!');
  }

  /** Gets the handle that goes in the direction opposite to the given adjacent node. */
  handleAwayFrom(to: Node): Handle {
    if (this._next() === to) return this._back;
    if (this._prev() === to) return this._front;
    throw new Error('Node.handleAwayFrom(): second node is not adjacent!');
  }

  /** Gets the node in the direction opposite to the given handle. */
  nodeAwayFrom(h: Handle): Node | null {
    if (this._front === h) return this._prev();
    if (this._back === h) return this._next();
    throw new Error('Node.nodeAwayFrom(): handle is not a child of this node!');
  }

  /**
   * Move the node to the bottom of its canvas group.
   * Useful for node break, to ensure that the selected nodes are above the unselected ones.
   */
  sink(): void {
    this._canvas_item_ctrl.lower_to_bottom();
  }

  static parse_nodetype(x: string | undefined): NodeType {
    switch (x) {
      case 'a':
        return NodeType.NODE_AUTO;
      case 'c':
        return NodeType.NODE_CUSP;
      case 's':
        return NodeType.NODE_SMOOTH;
      case 'z':
        return NodeType.NODE_SYMMETRIC;
      default:
        return NodeType.NODE_PICK_BEST;
    }
  }

  static node_type_to_localized_string(type: NodeType): string {
    switch (type) {
      case NodeType.NODE_CUSP:
        return _('Corner node');
      case NodeType.NODE_SMOOTH:
        return _('Smooth node');
      case NodeType.NODE_SYMMETRIC:
        return _('Symmetric node');
      case NodeType.NODE_AUTO:
        return _('Auto-smooth node');
      default:
        return '';
    }
  }

  /** Build the next segment of a geom path from this node's data */
  build_segment(builder: PathBuilder, next_node: Node): void {
    if (next_node._back.isDegenerate() && this._front.isDegenerate()) {
      builder.lineTo(next_node.position());
    } else {
      // this is a bezier segment
      builder.curveTo(this._front.position(), next_node._back.position(), next_node.position());
    }
  }

  /** Determine whether two nodes are joined by a linear segment. */
  static _is_line_segment(first: Node | null, second: Node | null): boolean {
    if (!first || !second) return false;
    if (first._next() === second) return first._front.isDegenerate() && second._back.isDegenerate();
    if (second._next() === first) return second._front.isDegenerate() && first._back.isDegenerate();
    return false;
  }

  protected override _setState(state: State): void {
    // change node size to match type and selection state
    this._canvas_item_ctrl.set_size(this.selected() ? HandleSize.LARGE : HandleSize.NORMAL);
    super._setState(state);
  }

  override grabbed(event: MotionEvent): boolean {
    if (super.grabbed(event)) return true;

    const prev = this._prev();
    const next = this._next();
    if (node_confine_to_path(event)) {
      // The segments to the previous and the next node, for confine-to-path.
      const path = new Path(prev ? prev.position() : this.position());
      if (prev) path.appendCurve(segmentOf(prev, this));
      if (next) path.appendCurve(segmentOf(this, next));
      this.#short_segment_path = path;
      return true;
    }
    this.#short_segment_path = null;

    // Dragging out handles with Shift + drag on a node.
    if (!node_drag_handle(event)) return false;

    const evp = event.pos;
    const rel_evp = evp.sub(this._last_click_event_point());

    // This should work even if dragtolerance is zero and evp coincides with node position.
    let angle_next = Number.POSITIVE_INFINITY;
    let angle_prev = Number.POSITIVE_INFINITY;
    let has_degenerate = false;
    // determine which handle to drag out based on degeneration and the direction of drag
    if (this._front.isDegenerate() && next) {
      const next_relpos = this._desktop.d2w(next.position()).sub(this._desktop.d2w(this.position()));
      angle_next = Math.abs(angle_between(rel_evp, next_relpos));
      has_degenerate = true;
    }
    if (this._back.isDegenerate() && prev) {
      const prev_relpos = this._desktop.d2w(prev.position()).sub(this._desktop.d2w(this.position()));
      angle_prev = Math.abs(angle_between(rel_evp, prev_relpos));
      has_degenerate = true;
    }
    if (!has_degenerate) return false;

    const h = angle_next < angle_prev ? this._front : this._back;
    h.setPosition(this._desktop.w2d(evp));
    h.setVisible(true);
    h.transferGrab(this, event);
    Handle._drag_out = true;
    return true;
  }

  /** The snap source type of this node: smooth or cusp. */
  _snapSourceType(): SnapSourceType {
    return this._type === NodeType.NODE_SMOOTH || this._type === NodeType.NODE_AUTO
      ? SnapSourceType.SNAPSOURCE_NODE_SMOOTH
      : SnapSourceType.SNAPSOURCE_NODE_CUSP;
  }
  /** The snap target type of this node: smooth or cusp. */
  _snapTargetType(): SnapTargetType {
    return this._type === NodeType.NODE_SMOOTH || this._type === NodeType.NODE_AUTO
      ? SnapTargetType.SNAPTARGET_NODE_SMOOTH
      : SnapTargetType.SNAPTARGET_NODE_CUSP;
  }

  /**
   * Move the node to new_pos, snapped to the snap targets and the unselected
   * nodes; Ctrl confines to the axes, Ctrl+Alt to the handle lines (with snapping
   * along these lines), Alt to the path.
   */
  override dragged(new_pos: Point, event: MotionEvent): Point {
    const confine = move_confine(event);
    const confine_handles = node_confine_handles(event);
    const confine_to_path = node_confine_to_path(event);
    const no_snap = move_no_snapping(event);

    // even if we won't really snap, we might still call the one of the
    // constrainedSnap() methods to enforce the constraints, so we need
    // to setup the snapmanager anyway; this is also required for someSnapperMightSnap()
    const sm = this._desktop.getSnapManager();
    sm.setup(this._desktop);
    const snap = !no_snap && sm.someSnapperMightSnap();
    if (snap) {
      // Build the list of unselected nodes.
      const unselected: SnapCandidatePoint[] = [];
      for (const node of this._selection.allPoints()) {
        if (node.selected() || !(node instanceof Node)) continue;
        unselected.push(
          new SnapCandidatePoint(node.position(), node._snapSourceType(), node._snapTargetType()),
        );
      }
      sm.unSetup();
      sm.setupIgnoreSelection(this._desktop, true, unselected);
    }

    // Snap candidate point for free snapping; this will consider snapping tangentially
    // and perpendicularly and therefore the origin or direction vector must be set
    const scp_free = new SnapCandidatePoint(new_pos, this._snapSourceType());

    let front_direction: Point | null = null;
    let back_direction: Point | null = null;
    const origin = this._last_drag_origin();
    const next = this._next();
    const prev = this._prev();
    if (this._front.isDegenerate()) {
      // If there is no handle for the path segment towards the next node, then this segment may be straight
      if (next && Node._is_line_segment(this, next)) {
        front_direction = next.position().sub(origin);
        if (next.selected()) scp_free.addVector(next.position().sub(this.position()));
        else scp_free.addOrigin(next.position());
      }
    } else {
      // .. this path segment is curved
      front_direction = this._front.relativePos();
      scp_free.addVector(front_direction);
    }
    if (this._back.isDegenerate()) {
      // If there is no handle for the path segment towards the previous node, then this segment may be straight
      if (prev && Node._is_line_segment(prev, this)) {
        back_direction = prev.position().sub(origin);
        if (prev.selected()) scp_free.addVector(prev.position().sub(this.position()));
        else scp_free.addOrigin(prev.position());
      }
    } else {
      // .. this path segment is curved
      back_direction = this._back.relativePos();
      scp_free.addVector(back_direction);
    }

    if (confine_to_path && this.#short_segment_path && !confine_handles && !confine) {
      // 1. Move from the cursor/drag position onto the line
      new_pos = nearestOnPath(this.#short_segment_path, new_pos);
      // 2. Free snap to move the line point to a grid or guide
      new_pos = sm.freeSnap(new SnapCandidatePoint(new_pos, this._snapSourceType())).getPoint();
      // 3. And finally move it back to the segment line to aproximate a constrained snap
      new_pos = nearestOnPath(this.#short_segment_path, new_pos);
    } else if (confine || confine_handles) {
      // We're about to consider a constrained snap, which is already limited to 1D
      const constraints: SnapConstraint[] = [];
      if (confine_handles) {
        // constrain to handle lines
        const snaps = Math.min(
          Math.max(Preferences.get().getDouble('/options/rotationsnapsperpi/value', 12.0), 0.1),
          1800.0,
        );
        const min_angle = Math.PI / snaps;
        if (front_direction) constraints.push(SnapConstraint.line(origin, front_direction));
        if (back_direction) constraints.push(SnapConstraint.line(origin, back_direction));
        // For smooth nodes, we will also snap to normals of handle lines. For cusp nodes this would be unintuitive
        // and confusing Only snap to the normals when they are further than snap increment away from the second
        // handle constraint
        if (this._type !== NodeType.NODE_CUSP) {
          const far_from = (normal: Point, other: Point | null) => {
            if (!other) return true;
            const a = Math.abs(angle_between(normal, other));
            return a > min_angle && a < Math.PI - min_angle;
          };
          if (front_direction && far_from(rot90(front_direction), back_direction)) {
            constraints.push(SnapConstraint.line(origin, rot90(front_direction)));
          }
          if (back_direction && far_from(rot90(back_direction), front_direction)) {
            constraints.push(SnapConstraint.line(origin, rot90(back_direction)));
          }
        }
      } else {
        // with Ctrl and no Alt: constrain to axes
        constraints.push(
          SnapConstraint.line(origin, new Point(1, 0)),
          SnapConstraint.line(origin, new Point(0, 1)),
        );
      }
      const valid = constraints.filter((c) => !c.getDirection().isZero());
      if (valid.length) {
        new_pos = sm
          .multipleConstrainedSnaps(new SnapCandidatePoint(new_pos, this._snapSourceType()), valid, no_snap)
          .getPoint();
      }
    } else if (snap) {
      new_pos = sm.freeSnap(scp_free).getPoint();
    }
    sm.unSetup();
    return super.dragged(new_pos, event);
  }

  override clicked(event: ButtonReleaseEvent): boolean {
    if (this._pm()._nodeClicked(this, event, false)) return true;
    return super.clicked(event);
  }
}

/** The segment from node a to its next node b. */
function segmentOf(a: Node, b: Node): LineSegment | CubicBezier {
  if (a._front.isDegenerate() && b._back.isDegenerate()) return new LineSegment(a.position(), b.position());
  return new CubicBezier(a.position(), a._front.position(), b._back.position(), b.position());
}

/** The point of path nearest to p. */
function nearestOnPath(path: Path, p: Point): Point {
  let best = path.initialPoint();
  for (const c of path.openCurves()) {
    const q = c.pointAt(nearest_time(p, c as LineSegment | CubicBezier));
    if (distance(q, p) < distance(best, p)) best = q;
  }
  return best;
}

/**
 * Iterator for editable nodes (upstream NodeIterator).
 *
 * Because paths can be cyclic, node iterators have two different ways to step:
 * inc()/dec() return the end iterator (the list sentinel) at the ends;
 * next()/prev() wrap around in closed paths and only return the end iterator
 * when the path is open. valid() is false for the end iterator and the null iterator.
 */
export class NodeIterator {
  readonly _node: ListNode | null;

  constructor(node: ListNode | null = null) {
    this._node = node;
  }

  /** Whether the iterator points to a node (upstream operator bool). */
  valid(): boolean {
    return this._node !== null && this._node.ln_list !== this._node;
  }

  /** The node. Only valid if valid() is true. */
  ptr(): Node {
    return this._node as Node;
  }

  equals(o: NodeIterator): boolean {
    return this._node === o._node;
  }

  /** The next node in sequence order (upstream ++). */
  inc(): NodeIterator {
    return new NodeIterator(this._node ? this._node.ln_next : null);
  }

  /** The previous node in sequence order (upstream --). */
  dec(): NodeIterator {
    return new NodeIterator(this._node ? this._node.ln_prev : null);
  }

  /** The next node with wrap-around in closed paths (upstream next()). */
  next(): NodeIterator {
    let r = this.inc();
    if (!r.valid() && r._node?.ln_list.closed()) r = r.inc();
    return r;
  }

  /** The previous node with wrap-around in closed paths (upstream prev()). */
  prev(): NodeIterator {
    let r = this.dec();
    if (!r.valid() && r._node?.ln_list.closed()) r = r.dec();
    return r;
  }
}

/**
 * An editable list of nodes representing a subpath (upstream NodeList).
 * It can optionally be cyclic to represent a closed path. The list itself is
 * the sentinel of the circular list of nodes.
 */
export class NodeList implements ListNode {
  ln_next: ListNode;
  ln_prev: ListNode;
  ln_list: NodeList;
  readonly #list: SubpathList;
  #closed = false;

  constructor(splist: SubpathList) {
    this.#list = splist;
    this.ln_list = this;
    this.ln_next = this;
    this.ln_prev = this;
  }

  begin(): NodeIterator {
    return new NodeIterator(this.ln_next);
  }
  end(): NodeIterator {
    return new NodeIterator(this);
  }

  *[Symbol.iterator](): IterableIterator<Node> {
    for (let ln = this.ln_next; ln !== this; ) {
      const next = ln.ln_next;
      yield ln as Node;
      ln = next;
    }
  }

  empty(): boolean {
    return this.ln_next === this;
  }

  size(): number {
    let sz = 0;
    for (let ln = this.ln_next; ln !== this; ln = ln.ln_next) ++sz;
    return sz;
  }

  closed(): boolean {
    return this.#closed;
  }

  setClosed(c: boolean): void {
    this.#closed = c;
  }

  /**
   * A subpath is degenerate if it has no segments - either one node in an open path
   * or no nodes in a closed path.
   */
  degenerate(): boolean {
    return this.#closed ? this.empty() : this.begin().inc().equals(this.end());
  }

  /** The node at the start of the segment curve_index. */
  before(curve_index: number): NodeIterator {
    let ret = this.begin();
    for (let i = 0; i < curve_index; i++) ret = ret.inc();
    return ret;
  }

  /** Insert a node before pos. */
  insert(pos: NodeIterator, x: Node): NodeIterator {
    const ins = pos._node as ListNode;
    x.ln_next = ins;
    x.ln_prev = ins.ln_prev;
    ins.ln_prev.ln_next = x;
    ins.ln_prev = x;
    x.ln_list = this;
    return new NodeIterator(x);
  }

  /** Move the nodes [first, last) of list (may be this list) before pos. */
  splice(pos: NodeIterator, _list: NodeList, first: NodeIterator, last: NodeIterator): void {
    const ins_beg = first._node as ListNode;
    const ins_end = last._node as ListNode;
    const at = pos._node as ListNode;
    for (let ln = ins_beg; ln !== ins_end; ln = ln.ln_next) ln.ln_list = this;
    ins_beg.ln_prev.ln_next = ins_end;
    ins_end.ln_prev.ln_next = at;
    at.ln_prev.ln_next = ins_beg;

    const atprev = at.ln_prev;
    at.ln_prev = ins_end.ln_prev;
    ins_end.ln_prev = ins_beg.ln_prev;
    ins_beg.ln_prev = atprev;
  }

  /** Move all nodes of list before pos. */
  spliceAll(pos: NodeIterator, list: NodeList): void {
    this.splice(pos, list, list.begin(), list.end());
  }

  reverse(): void {
    for (let ln = this.ln_next; ln !== this; ln = ln.ln_prev) {
      [ln.ln_next, ln.ln_prev] = [ln.ln_prev, ln.ln_next];
      const node = ln as Node;
      const save_pos = node._front.position();
      node._front.setPosition(node._back.position());
      node._back.setPosition(save_pos);
    }
    [this.ln_next, this.ln_prev] = [this.ln_prev, this.ln_next];
  }

  push_front(x: Node): void {
    this.insert(this.begin(), x);
  }
  push_back(x: Node): void {
    this.insert(this.end(), x);
  }

  front(): Node {
    return this.ln_next as Node;
  }
  back(): Node {
    return this.ln_prev as Node;
  }

  clear(): void {
    for (let i = this.begin(); !i.equals(this.end()); ) i = this.erase(i);
  }

  /** Remove and destroy the node at i. Returns the iterator to the next node in sequence order. */
  erase(i: NodeIterator): NodeIterator {
    // some gymnastics are required to ensure that the node is valid when deleted;
    // otherwise the code that updates handle visibility will break
    const rm = i._node as Node;
    const rmnext = rm.ln_next;
    const rmprev = rm.ln_prev;
    rm.destroy();
    rmprev.ln_next = rmnext;
    rmnext.ln_prev = rmprev;
    return new NodeIterator(rmnext);
  }

  /** Remove the nodes [first, last). */
  eraseRange(first: NodeIterator, last: NodeIterator): void {
    while (!first.equals(last)) first = this.erase(first);
  }

  /** Remove this subpath from its path (upstream kill). */
  kill(): void {
    this.#list.remove(this);
  }

  subpathList(): SubpathList {
    return this.#list;
  }

  static get_iterator(n: Node): NodeIterator {
    return new NodeIterator(n);
  }

  static get(n: Node | NodeIterator): NodeList {
    return n instanceof NodeIterator ? (n._node as ListNode).ln_list : n.ln_list;
  }
}

/**
 * List of node lists. Represents an editable path composed of one or more
 * subpaths (upstream SubpathList).
 */
export class SubpathList {
  readonly list: NodeList[] = [];
  readonly #path_manipulator: PathManipulator;

  constructor(pm: PathManipulator) {
    this.#path_manipulator = pm;
  }

  pm(): PathManipulator {
    return this.#path_manipulator;
  }

  [Symbol.iterator](): IterableIterator<NodeList> {
    return [...this.list][Symbol.iterator]();
  }

  empty(): boolean {
    return this.list.length === 0;
  }

  /** Remove a subpath and destroy its nodes. */
  remove(sp: NodeList): void {
    const i = this.list.indexOf(sp);
    if (i >= 0) this.list.splice(i, 1);
    sp.clear();
  }

  clear(): void {
    for (const sp of [...this.list]) this.remove(sp);
  }
}
