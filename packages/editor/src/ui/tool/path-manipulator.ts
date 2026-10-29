// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/path-manipulator.cpp, src/ui/tool/path-manipulator.h
/**
 * Path manipulator - implementation.
 */
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2009 Authors
 */
import {
  bezier_fit,
  C_,
  DocumentUndo,
  type InputPoint,
  LivePathEffectObject,
  type NodeObserver,
  PathParam,
  Preferences,
  pathv_to_linear_and_cubic_beziers,
  SP_OBJECT_MODIFIED_FLAG,
  SPPath,
  sp_lpe_item_update_patheffect,
  type Node as XmlNode,
} from '@inkscape-web/core';
import {
  Affine,
  BezierCurve,
  CubicBezier,
  distance,
  middle_point,
  type Path,
  PathBuilder,
  type PathVector,
  type Point,
  pathv_nearest_time,
  pathv_point_at,
} from '@inkscape-web/geom';
import { type ModifierState, mod_alt, mod_ctrl, type ToolBase } from '../tools/tool-base.ts';
import type { ButtonReleaseEvent } from './control-point.ts';
import { CurveDragPoint } from './curve-drag-point.ts';
import { ExtremumType, PointManipulator } from './manipulator.ts';
import type { MultiPathManipulator } from './multi-path-manipulator.ts';
import { type Handle, Node, NodeIterator, NodeList, nodeTypeChar, SubpathList } from './node.ts';
import { NodeType, SegmentType } from './node-types.ts';
import type { SelectableControlPoint } from './selectable-control-point.ts';

/** Types of path changes that we must react to. */
enum PathChange {
  PATH_CHANGE_D,
  PATH_CHANGE_TRANSFORM,
}

export enum NodeDeleteMode {
  /** try to preserve shape if deleted nodes do not form sharp corners */
  automatic,
  /** opposite of what automatic mode would do */
  inverse_auto,
  /** preserve shape */
  curve_fit,
  /** do not preserve shape; delete nodes and connect subpaths with a line segment */
  line_segment,
  /** Remove the connection between the selected nodes, leaving a gap */
  gap_nodes,
  /** Remove the connection between the selected lines, leaving a gap */
  gap_lines,
}

// Modifiers of the node tool (upstream Modifiers::Modifier defaults in src/ui/modifiers.cpp).
/** node-cycle-type: Ctrl */
const node_cycle_type = (s: ModifierState) => mod_ctrl(s);
/** node-delete: Ctrl+Alt */
const node_delete = (s: ModifierState) => mod_ctrl(s) && mod_alt(s);
/** node-retract-handle: Alt */
const node_retract_handle = (s: ModifierState) => mod_alt(s);

function pathvEquals(a: readonly Path[], b: readonly Path[]): boolean {
  return a.length === b.length && a.every((p, i) => p.equals(b[i] as Path));
}

/** Angle at p1 between the directions to p0 and p2. */
function get_angle(p0: Point, p1: Point, p2: Point): number {
  const d1 = p1.sub(p0);
  const d2 = p1.sub(p2);
  if (d1.isZero() || d2.isZero()) return Math.PI;
  return Math.atan2(d1.y, d1.x) - Math.atan2(d2.y, d2.x);
}

/** Times in (0, 1) where the derivative of the cubic polynomial with coefficients c is zero. */
function cubic_extrema(c: readonly [number, number, number, number]): number[] {
  // derivative: 3 * ((c1-c0)(1-t)^2 + 2(c2-c1)t(1-t) + (c3-c2)t^2)
  const a0 = c[1] - c[0];
  const a1 = c[2] - c[1];
  const a2 = c[3] - c[2];
  const A = a0 - 2 * a1 + a2;
  const B = 2 * (a1 - a0);
  const C = a0;
  const roots: number[] = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) roots.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-B + s) / (2 * A), (-B - s) / (2 * A));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/**
 * Manipulator that edits a single path using nodes with handles (upstream
 * PathManipulator). Currently only cubic bezier and linear segments are
 * supported. Node and handle positions are in desktop coordinates; the path
 * data (_spcurve) is in item coordinates.
 * A path with a path effect is edited before the effect (inkscape:original-d). With an lpe_key,
 * the manipulator edits the path parameter of that key of a LivePathEffectObject.
 * TODO: path outline and direction display, BSpline and Spiro paths,
 * simplifyInvisible, copySelectedPath, single handle scaling and rotation with the keyboard.
 */
export class PathManipulator extends PointManipulator {
  readonly _subpaths: SubpathList;
  readonly _multi_path_manipulator: MultiPathManipulator;
  _path: SPPath | LivePathEffectObject | null;
  readonly _lpe_key: string;
  /** In item coordinates. */
  _spcurve: PathVector = [];
  /** an invisible control point hovering over curve */
  readonly _dragpoint: CurveDragPoint;
  /** desktop-to-item transform */
  #d2i_transform = Affine.identity();
  /** item-to-desktop transform, inverse of _d2i_transform */
  #i2d_transform = Affine.identity();
  /** additional transform to apply to editing controls */
  #edit_transform: Affine;
  #show_handles = true;
  #live_outline = true;
  #live_objects = true;
  #observer_blocked = false;
  readonly #observer: NodeObserver;
  readonly #repr: XmlNode;
  readonly #disconnects: (() => void)[] = [];

  constructor(mpm: MultiPathManipulator, path: SPPath | LivePathEffectObject, et: Affine, lpe_key = '') {
    super(mpm._path_data.node_data.desktop, mpm._path_data.node_data.selection);
    this._subpaths = new SubpathList(this);
    this._multi_path_manipulator = mpm;
    this._path = path;
    this._lpe_key = lpe_key;
    this._dragpoint = new CurveDragPoint(this);
    this.#edit_transform = et;
    // Notifies the path manipulator when something changes the path being edited (e.g. undo / redo)
    this.#observer = {
      notifyAttributeChanged: (_node, name) => {
        // do nothing if blocked
        if (this.#observer_blocked) return;
        // only react to "d" (path data) and "transform" attribute changes
        if (name === 'd' || name === 'inkscape:original-d' || (this._lpe_key && name === this._lpe_key)) {
          this._externalChange(PathChange.PATH_CHANGE_D);
        } else if (name === 'transform') this._externalChange(PathChange.PATH_CHANGE_TRANSFORM);
      },
    };
    this.#repr = path.getRepr();
    this.#repr.addObserver(this.#observer);

    this.#i2d_transform = path instanceof SPPath ? path.i2dtAffine() : Affine.identity();
    this.#d2i_transform = this.#i2d_transform.inverse();
    this._dragpoint.setVisible(false);

    this._getGeometry();

    this.#disconnects.push(
      this._selection.signal_update.connect(() => this.update(false)),
      this._selection.signal_selection_changed.connect((pvec, selected) =>
        this._selectionChangedM(pvec, selected),
      ),
      // Detect changes to document transform
      this._desktop
        .getDocument()
        .modifiedSignal.connect(() => this._externalChange(PathChange.PATH_CHANGE_TRANSFORM)),
    );

    this._createControlPointsFromGeometry();
  }

  #destroyed = false;

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this._dragpoint.destroy();
    this.#repr.removeObserver(this.#observer);
    for (const d of this.#disconnects) d();
    this.clear();
  }

  /** Handle motion events to update the position of the curve drag point. */
  event(_tool: ToolBase, event: Event): boolean {
    if (this.empty()) return false;
    if (event.type === 'pointermove') {
      const canvas = this._desktop.getCanvas();
      this._updateDragPoint(canvas.canvas_to_world(canvas.windowPoint(event as PointerEvent)));
    }
    return false;
  }

  /** Check whether the manipulator has any nodes. */
  empty(): boolean {
    return !this._path || this._subpaths.empty();
  }

  item(): SPPath | LivePathEffectObject | null {
    return this._path;
  }

  subpathList(): SubpathList {
    return this._subpaths;
  }

  /** Update the display and the outline of the path, but don't commit. */
  update(_alert_LPE = false): void {
    this.#observer_blocked = true;
    this._createGeometryFromControlPoints();
    this.#observer_blocked = false;
  }

  /** Store the changes to the path in XML. */
  writeXML(): void {
    this._setGeometry();
    if (!this._path) return;
    this.#observer_blocked = true;
    if (!this.empty()) {
      this._path.updateRepr();
      this._path.setAttribute(this._nodetypesKey(), this._createTypeString());
    } else {
      // this manipulator will have to be destroyed right after this call
      this._path.deleteObject(true);
      this._path = null;
    }
    this.#observer_blocked = false;
  }

  /** Remove all nodes from the path. */
  clear(): void {
    this._subpaths.clear();
  }

  /** Select all nodes in subpaths that have something selected. */
  selectSubpaths(): void {
    for (const sp of this._subpaths) {
      if ([...sp].some((n) => n.selected())) {
        // if at least one of the nodes from this subpath is selected,
        // select all nodes from this subpath
        for (const n of sp) this._selection.insert(n);
      }
    }
  }

  /** Invert selection in the selected subpaths. */
  invertSelectionInSubpaths(): void {
    for (const sp of this._subpaths) {
      if (![...sp].some((n) => n.selected())) continue;
      // found selected node - invert selection in this subpath
      for (const k of sp) {
        if (k.selected()) this._selection.erase(k);
        else this._selection.insert(k);
      }
    }
  }

  /** Insert a new node in the middle of each selected segment. */
  insertNodes(): void {
    if (this._selection.size() < 2) return;
    for (const sp of this._subpaths) {
      for (let j = sp.begin(); !j.equals(sp.end()); j = j.inc()) {
        const k = j.next();
        if (k.valid() && j.ptr().selected() && k.ptr().selected()) {
          j = this.subdivideSegment(j, 0.5);
          this._selection.insert(j.ptr());
        }
      }
    }
  }

  /** Insert a node on the path at the window point pt, if the curve drag point is there. */
  insertNodeAt(pt: Point): void {
    const dist = this._updateDragPoint(pt);
    // 1e-6 is too small, as observed occasionally when inserting a node at a snapped intersection of paths
    if (dist < 1e-5) this.insertNode(this._dragpoint.getIterator(), this._dragpoint.getTimeValue(), true);
  }

  insertNode(first: NodeIterator, t: number, take_selection: boolean): void {
    const inserted = this.subdivideSegment(first, t);
    if (take_selection) this._selection.clear();
    this._selection.insert(inserted.ptr());
    this.update(true);
    this._commit(C_('Undo', 'Add node'));
  }

  /** Insert a new node at the extremum of the selected segments. */
  insertNodeAtExtremum(extremum: ExtremumType): void {
    if (this._selection.size() < 2) return;
    const sign = extremum === ExtremumType.EXTR_MIN_X || extremum === ExtremumType.EXTR_MIN_Y ? -1 : 1;
    const dim = extremum === ExtremumType.EXTR_MIN_X || extremum === ExtremumType.EXTR_MAX_X ? 0 : 1;
    for (const sp of this._subpaths) {
      let extrvalue = Number.NEGATIVE_INFINITY;
      let extremum_vector: [NodeIterator, number][] = [];
      const add_or_replace_if_extremum = (testvalue: number, node: NodeIterator, t: number) => {
        if (testvalue > extrvalue) {
          // replace all extreme nodes with the new one
          extremum_vector = [[node, t]];
          extrvalue = testvalue;
        } else if (Math.abs(testvalue - extrvalue) < 1e-6) {
          // very rare but: extremum node at the same extreme value!!! so add it to the list
          extremum_vector.push([node, t]);
        }
      };
      for (let first = sp.begin(); !first.equals(sp.end()); first = first.inc()) {
        const second = first.next();
        if (!(second.valid() && first.ptr().selected() && second.ptr().selected())) continue;
        const a = first.ptr();
        const b = second.ptr();
        add_or_replace_if_extremum(sign * a.position().at(dim), first, 0);
        add_or_replace_if_extremum(sign * b.position().at(dim), first, 1);
        // a line segment has is extrema at the start and end, no node should be added
        if (a.front().isDegenerate() && b.back().isDegenerate()) continue;
        const c: [number, number, number, number] = [
          a.position().at(dim),
          a.front().position().at(dim),
          b.back().position().at(dim),
          b.position().at(dim),
        ];
        for (const r of cubic_extrema(c)) {
          const v =
            c[0] * (1 - r) ** 3 + 3 * c[1] * r * (1 - r) ** 2 + 3 * c[2] * r * r * (1 - r) + c[3] * r ** 3;
          add_or_replace_if_extremum(sign * v, first, r);
        }
      }
      for (const [it, t] of extremum_vector) {
        // don't insert node at the start or end of a segment, i.e. round values for extr_t
        if (Math.abs(t - Math.round(t)) > 1e-6) this._selection.insert(this.subdivideSegment(it, t).ptr());
      }
    }
  }

  /**
   * Insert new nodes exactly at the positions of selected nodes while preserving shape.
   * This is equivalent to breaking, except that it doesn't split into subpaths.
   */
  duplicateNodes(): void {
    if (this._selection.empty()) return;
    for (const sp of this._subpaths) {
      for (let j = sp.begin(); !j.equals(sp.end()); j = j.inc()) {
        if (!j.ptr().selected()) continue;
        const k = j.next();
        const n = new Node(this._multi_path_manipulator._path_data.node_data, j.ptr().position());
        if (k.valid()) {
          // Move the new node to the bottom of the Z-order. This way you can drag all
          // nodes that were selected before this operation without deselecting
          // everything because there is a new node above.
          n.sink();
        }
        n.front().setPosition(j.ptr().front().position());
        j.ptr().front().retract();
        j.ptr().setType(NodeType.NODE_CUSP, false);
        sp.insert(k.valid() ? k : sp.end(), n);
        if (k.valid()) {
          // We need to manually call the selection change callback to refresh
          // the handle display correctly.
          this._selectionChanged(j.ptr(), true);
          this._selectionChanged(n, false);
          j = j.inc(); // skip the new node
        } else {
          // select the new end node instead of the node just before it
          this._selection.erase(j.ptr());
          this._selection.insert(n);
          break; // this was the end node, nothing more to do
        }
      }
    }
  }

  /** Replace contiguous selections of nodes in each subpath with one node. */
  weldNodes(preserve_pos: NodeIterator = new NodeIterator()): void {
    if (this._selection.size() < 2) return;
    this.hideDragPoint();
    let pos_valid = preserve_pos.valid();
    for (const sp of this._subpaths) {
      let num_selected = 0;
      let num_unselected = 0;
      for (const j of sp) {
        if (j.selected()) ++num_selected;
        else ++num_unselected;
      }
      if (num_selected < 2) continue;
      // if all nodes in a subpath are selected, the operation doesn't make much sense
      if (num_unselected === 0) continue;

      // Start from unselected node in closed paths, so that we don't start in the middle
      // of a selection
      let sel_beg = sp.begin();
      if (sp.closed()) while (sel_beg.ptr().selected()) sel_beg = sel_beg.inc();

      // Work loop
      while (num_selected > 0) {
        // Find selected node
        while (sel_beg.valid() && !sel_beg.ptr().selected()) sel_beg = sel_beg.next();
        if (!sel_beg.valid()) {
          throw new Error('Join nodes: end of open path reached, but there are still nodes to process!');
        }
        // note: this is initialized to zero, because the loop below counts sel_beg as well
        // the loop conditions are simpler that way
        let num_points = 0;
        let use_pos = false;
        const back_pos = sel_beg.ptr().back().position();
        let front_pos = back_pos;
        let sel_end = sel_beg;
        for (; sel_end.valid() && sel_end.ptr().selected(); sel_end = sel_end.next()) {
          ++num_points;
          front_pos = sel_end.ptr().front().position();
          if (pos_valid && sel_end.equals(preserve_pos)) use_pos = true;
        }
        if (num_points > 1) {
          let joined_pos: Point;
          if (use_pos) {
            joined_pos = preserve_pos.ptr().position();
            pos_valid = false;
          } else {
            joined_pos = middle_point(back_pos, front_pos);
          }
          const beg = sel_beg.ptr();
          beg.setType(NodeType.NODE_CUSP, false);
          beg.move(joined_pos);
          // do not move handles if they aren't degenerate
          if (!beg.back().isDegenerate()) beg.back().setPosition(back_pos);
          if (!sel_end.prev().ptr().front().isDegenerate()) beg.front().setPosition(front_pos);
          sel_beg = sel_beg.next();
          while (!sel_beg.equals(sel_end)) {
            const next = sel_beg.next();
            sp.erase(sel_beg);
            sel_beg = next;
            --num_selected;
          }
        }
        --num_selected; // for the joined node or single selected node
      }
    }
  }

  /** Remove nodes in the middle of selected segments. */
  weldSegments(): void {
    if (this._selection.size() < 2) return;
    this.hideDragPoint();
    for (const sp of this._subpaths) {
      let num_selected = 0;
      let num_unselected = 0;
      for (const j of sp) {
        if (j.selected()) ++num_selected;
        else ++num_unselected;
      }
      // if 2 or fewer nodes are selected, there can't be any middle points to remove.
      if (num_selected <= 2) continue;
      // if all nodes in a closed subpath are selected, the operation doesn't make much sense
      if (num_unselected === 0 && sp.closed()) continue;

      // Start from unselected node in closed paths, so that we don't start in the middle
      // of a selection
      let sel_beg = sp.begin();
      if (sp.closed()) while (sel_beg.ptr().selected()) sel_beg = sel_beg.inc();

      // Work loop
      while (num_selected > 0) {
        // Find selected node
        while (sel_beg.valid() && !sel_beg.ptr().selected()) sel_beg = sel_beg.next();
        if (!sel_beg.valid()) {
          throw new Error('Join nodes: end of open path reached, but there are still nodes to process!');
        }
        let num_points = 0;
        // find the end of selected segment
        let sel_end = sel_beg;
        for (; sel_end.valid() && sel_end.ptr().selected(); sel_end = sel_end.next()) ++num_points;
        if (num_points > 2) {
          // remove nodes in the middle
          // TODO: fit bezier to the former shape
          sel_beg = sel_beg.next();
          while (!sel_beg.equals(sel_end.prev())) {
            const next = sel_beg.next();
            sp.erase(sel_beg);
            sel_beg = next;
          }
        }
        sel_beg = sel_end;
        // decrease num_selected by the number of points processed
        num_selected -= num_points;
      }
    }
  }

  /** Break the subpath at selected nodes. It also works for single node closed paths. */
  breakNodes(new_nodes = true): void {
    const list = this._subpaths.list;
    for (let idx = 0; idx < list.length; idx++) {
      const sp = list[idx] as NodeList;
      let cur = sp.begin();
      let end = sp.end();
      if (!sp.closed()) {
        // Each open path must have at least two nodes so no checks are required.
        // For 2-node open paths, cur == end
        cur = cur.inc();
        end = end.dec();
      }
      for (; !cur.equals(end); cur = cur.inc()) {
        if (!cur.ptr().selected()) continue;
        let ins: NodeList;
        let becomes_open = false;

        if (sp.closed()) {
          // Move the node to break at to the beginning of path
          if (!cur.equals(sp.begin())) sp.splice(sp.begin(), sp, cur, sp.end());
          sp.setClosed(false);
          ins = sp;
          becomes_open = true;
        } else {
          const new_sp = new NodeList(this._subpaths);
          new_sp.splice(new_sp.end(), sp, sp.begin(), cur);
          list.splice(idx, 0, new_sp);
          idx++;
          ins = new_sp;
        }

        const c = cur.ptr();
        // When cutting nodes, we don't want to make new nodes, they'd just be deleted anyway
        if (new_nodes) {
          const n = new Node(this._multi_path_manipulator._path_data.node_data, c.position());
          ins.insert(ins.end(), n);
          c.setType(NodeType.NODE_CUSP, false);
          n.back().setRelativePos(c.back().relativePos());
          c.back().retract();
          n.sink();
        } else {
          c.setType(NodeType.NODE_CUSP, false);
          c.back().retract();
        }

        if (becomes_open) {
          cur = sp.begin(); // this will be increased to ++sp->begin()
          end = sp.end().dec();
        }
      }
    }
  }

  /**
   * Delete selected nodes in the path, optionally substituting deleted segments with bezier curves
   * in a way that attempts to preserve the original shape of the curve.
   */
  deleteNodes(delete_mode: NodeDeleteMode): void {
    if (this._selection.empty()) return;
    this.hideDragPoint();

    if (delete_mode === NodeDeleteMode.gap_nodes) {
      // Break nodes first to create gaps
      this.breakNodes(false);
    } else if (delete_mode === NodeDeleteMode.gap_lines) {
      // Delete nodes but preserve end points
      this._deleteSegments(true);
      return;
    }

    const list = this._subpaths.list;
    for (let idx = 0; idx < list.length; ) {
      const sp = list[idx] as NodeList;
      // If there are less than 2 unselected nodes in an open subpath or no unselected nodes
      // in a closed one, delete entire subpath.
      let num_unselected = 0;
      let num_selected = 0;
      for (const j of sp) {
        if (j.selected()) ++num_selected;
        else ++num_unselected;
      }
      if (num_selected === 0) {
        ++idx;
        continue;
      }
      if (sp.closed() ? num_unselected < 1 : num_unselected < 2) {
        this._subpaths.remove(sp);
        continue;
      }

      if (sp.closed() && num_unselected === 1) {
        // Special case for deleting all but one node in a closed path, to avoid a troublesome
        // empty path.
        let keep = sp.begin();
        while (keep.ptr().selected()) keep = keep.next();
        this._deleteRest(keep);
        ++idx;
        continue;
      }

      // In closed paths, start from an unselected node - otherwise we might start in the middle
      // of a selected stretch and the resulting bezier fit would be suboptimal
      let sel_beg = sp.begin();
      if (sp.closed()) while (sel_beg.ptr().selected()) sel_beg = sel_beg.inc();

      while (num_selected > 0) {
        while (sel_beg.valid() && !sel_beg.ptr().selected()) sel_beg = sel_beg.next();
        let sel_end = sel_beg;
        while (sel_end.valid() && sel_end.ptr().selected()) sel_end = sel_end.next();
        num_selected -= this._deleteStretch(sel_beg, sel_end, delete_mode);
        sel_beg = sel_end;
      }
      ++idx;
    }
  }

  /**
   * Delete all nodes except for one in a closed subpath.
   * keep: The node not to delete.
   */
  _deleteRest(keep: NodeIterator): void {
    let cur = keep.next();
    // This function should only be called with an iterator on a closed path, where there is
    // always a next node.
    if (!cur.valid()) return;
    const nl = keep.ptr().nodeList();
    while (cur.valid() && !cur.equals(keep)) {
      const next = cur.next();
      nl.erase(cur);
      cur = next;
    }
  }

  /**
   * Delete nodes between the two iterators.
   * The given range can cross the beginning of the subpath in closed subpaths.
   * Returns the number of deleted nodes.
   */
  _deleteStretch(start: NodeIterator, end: NodeIterator, mode: NodeDeleteMode): number {
    const samples_per_segment = 10;
    const t_step = 1.0 / samples_per_segment;

    let del_len = 0;
    for (let i = start; !i.equals(end); i = i.next()) ++del_len;
    if (del_len === 0) return 0;

    let keep_shape = mode === NodeDeleteMode.automatic || mode === NodeDeleteMode.curve_fit;

    if (
      (mode === NodeDeleteMode.automatic || mode === NodeDeleteMode.inverse_auto) &&
      start.prev().valid() &&
      end.valid()
    ) {
      const angle_flat = Math.min(
        Math.max(Preferences.get().getDouble('/tools/node/flat-cusp-angle', 135), 1),
        180,
      );
      for (let cur = start; !cur.equals(end); cur = cur.next()) {
        const n = cur.ptr();
        const back = n.back().isDegenerate() ? cur.prev().ptr().position() : n.back().position();
        const front = n.front().isDegenerate() ? cur.next().ptr().position() : n.front().position();
        const angle = get_angle(back, n.position(), front);
        const a = Math.abs(angle) % (2 * Math.PI);
        const diff = Math.abs(a - Math.PI);
        const tolerance = ((180 - angle_flat) * Math.PI) / 180;
        const flat = diff < tolerance; // flat if *somewhat* close to 180 degrees (+-tolerance)
        if (!flat && distance(back, front) > 1) {
          // detected a cusp, so we'll try to remove nodes and insert line segment, rather than fitting a curve
          // if in auto mode, or the opposite in inverse_auto
          keep_shape = !keep_shape;
          break;
        }
      }
    }

    // set surrounding node types to cusp if:
    // we are deleting at the end or beginning of an open path
    if (!end.valid() && start.prev().valid()) {
      const p = start.prev().ptr();
      p.setType(NodeType.NODE_CUSP, false);
      p.front().retract();
    }
    if (!start.prev().valid() && end.valid()) {
      end.ptr().setType(NodeType.NODE_CUSP, false);
      end.ptr().back().retract();
    }

    if (keep_shape && start.prev().valid() && end.valid()) {
      const input: InputPoint[] = [];
      for (let cur = start.prev(); !cur.equals(end); cur = cur.next()) {
        const a = cur.ptr();
        const b = cur.next().ptr();
        const bc = new CubicBezier(a.position(), a.front().position(), b.back().position(), b.position());
        for (let s = 0; s < samples_per_segment; ++s) {
          const t = t_step * s;
          input.push({ pt: bc.pointAt(t), t });
        }
      }
      // Fill last point: last point + its slope
      const e = end.ptr();
      input.push({ pt: e.position(), t: 1.0, back: e.back().position() });
      // get slope for the first point
      const sp = start.prev().ptr();
      input[0] = { pt: sp.position(), t: 0.0, front: sp.front().position() };

      // Compute replacement bezier curve
      const result = bezier_fit(input);
      if (result) {
        sp.front().setPosition(result[1]);
        e.back().setPosition(result[2]);
      }
    }

    // We can't use nl->erase(start, end), because it would break when the stretch
    // crosses the beginning of a closed subpath
    const nl = start.ptr().nodeList();
    while (!start.equals(end)) {
      const next = start.next();
      nl.erase(start);
      start = next;
    }
    if (mode === NodeDeleteMode.line_segment) {
      // Handle line straigtening
      if (start.prev().valid()) {
        const p = start.prev().ptr();
        p.setType(NodeType.NODE_CUSP);
        p.front().move(p.position());
      }
      if (end.valid()) {
        end.ptr().setType(NodeType.NODE_CUSP);
        end.ptr().back().move(end.ptr().position());
      }
    }
    return del_len;
  }

  deleteSegments(): void {
    this._deleteSegments(false);
  }

  /** Removes selected segments */
  _deleteSegments(delete_singles: boolean): void {
    if (this._selection.empty()) return;
    this.hideDragPoint();

    const list = this._subpaths.list;
    for (let idx = 0; idx < list.length; ) {
      const sp = list[idx] as NodeList;
      let has_unselected = false;
      let num_selected = 0;
      for (const j of sp) {
        if (j.selected()) ++num_selected;
        else has_unselected = true;
      }
      if (!has_unselected) {
        this._subpaths.remove(sp);
        continue;
      }

      let sel_beg = sp.begin();
      if (sp.closed()) while (sel_beg.valid() && sel_beg.ptr().selected()) sel_beg = sel_beg.inc();
      while (num_selected > 0) {
        if (!sel_beg.valid()) break;
        if (!sel_beg.ptr().selected()) {
          sel_beg = sel_beg.next();
          continue;
        }
        let sel_end = sel_beg;
        let num_points = 0;
        while (sel_end.valid() && sel_end.ptr().selected()) {
          sel_end = sel_end.next();
          ++num_points;
        }
        if (num_points >= 2 - (delete_singles ? 1 : 0)) {
          // Retract end handles
          const last = sel_end.prev().ptr();
          last.setType(NodeType.NODE_CUSP, false);
          last.back().retract();
          sel_beg.ptr().setType(NodeType.NODE_CUSP, false);
          sel_beg.ptr().front().retract();
          if (sp.closed()) {
            // In closed paths, relocate the beginning of the path to the last selected
            // node and then unclose it. Remove the nodes from the first selected node
            // to the new end of path.
            if (!sel_end.prev().equals(sp.begin())) sp.splice(sp.begin(), sp, sel_end.prev(), sp.end());
            sp.setClosed(false);
            sp.eraseRange(sel_beg.next(), sp.end());
          } else {
            // for open paths:
            // 1. At end or beginning, delete including the node on the end or beginning
            // 2. In the middle, delete only inner nodes
            if (sel_beg.equals(sp.begin())) {
              sp.eraseRange(sp.begin(), sel_end.prev());
            } else if (sel_end.equals(sp.end())) {
              sp.eraseRange(sel_beg.next(), sp.end());
            } else {
              const new_sp = new NodeList(this._subpaths);
              new_sp.splice(new_sp.end(), sp, sp.begin(), sel_beg.next());
              list.splice(idx, 0, new_sp);
              idx++;
              if (sel_end.prev().valid()) sp.eraseRange(sp.begin(), sel_end.prev());
            }
          }
        }
        sel_beg = sel_end;
        num_selected -= num_points;
      }
      ++idx;
    }
  }

  /**
   * Reverse subpaths of the path. With selected_only, only paths that have at
   * least one selected node will be reversed. Otherwise all subpaths will be reversed.
   */
  reverseSubpaths(selected_only: boolean): void {
    for (const sp of this._subpaths) {
      if (!selected_only || [...sp].some((n) => n.selected())) sp.reverse();
    }
  }

  /** Make selected segments curves / lines. */
  setSegmentType(type: SegmentType): void {
    if (this._selection.empty()) return;
    for (const sp of this._subpaths) {
      for (let j = sp.begin(); !j.equals(sp.end()); j = j.inc()) {
        const k = j.next();
        if (!(k.valid() && j.ptr().selected() && k.ptr().selected())) continue;
        const a = j.ptr();
        const b = k.ptr();
        switch (type) {
          case SegmentType.SEGMENT_STRAIGHT:
            if (a.front().isDegenerate() && b.back().isDegenerate()) break;
            a.front().move(a.position());
            b.back().move(b.position());
            break;
          case SegmentType.SEGMENT_CUBIC_BEZIER:
            if (!a.front().isDegenerate() || !b.back().isDegenerate()) break;
            // move both handles to 1/3 of the line
            a.front().move(a.position().add(b.position().sub(a.position()).div(3)));
            b.back().move(b.position().add(a.position().sub(b.position()).div(3)));
            break;
        }
      }
    }
  }

  /** Set the visibility of handles. */
  showHandles(show: boolean): void {
    if (show === this.#show_handles) return;
    if (show) {
      for (const sp of this._subpaths) {
        for (let j = sp.begin(); !j.equals(sp.end()); j = j.inc()) {
          if (!j.ptr().selected()) continue;
          j.ptr().showHandles(true);
          if (j.prev().valid()) j.prev().ptr().showHandles(true);
          if (j.next().valid()) j.next().ptr().showHandles(true);
        }
      }
    } else {
      for (const sp of this._subpaths) for (const j of sp) j.showHandles(false);
    }
    this.#show_handles = show;
  }

  showOutline(_show: boolean): void {
    // TODO: the path outline (CanvasItemBpath).
  }

  showPathDirection(_show: boolean): void {
    // TODO: the path direction arrows on the outline.
  }

  setLiveOutline(set: boolean): void {
    this.#live_outline = set;
  }

  setLiveObjects(set: boolean): void {
    this.#live_objects = set;
  }

  updateHandles(): void {
    for (const sp of this._subpaths) for (const j of sp) j.updateHandles();
  }

  setControlsTransform(tnew: Affine): void {
    const delta = this.#i2d_transform
      .inverse()
      .multiply(this.#edit_transform.inverse())
      .multiply(tnew)
      .multiply(this.#i2d_transform);
    this.#edit_transform = tnew;
    for (const sp of this._subpaths) for (const j of sp) j.transform(delta);
    this._createGeometryFromControlPoints();
  }

  /**
   * Hide the curve drag point until the next motion event.
   * This should be called at the beginning of every method that can delete nodes.
   * Otherwise the invalidated iterator in the dragpoint can cause crashes.
   */
  hideDragPoint(): void {
    this._dragpoint.setVisible(false);
    this._dragpoint.setIterator(new NodeIterator());
  }

  /** Insert a node in the segment beginning with the supplied iterator, at the given time value */
  subdivideSegment(first: NodeIterator, t: number): NodeIterator {
    if (!first.valid()) throw new Error('Subdivide after invalid iterator');
    const list = NodeList.get(first);
    const second = first.next();
    if (!second.valid()) throw new Error('Subdivide after last node in open path');
    const a = first.ptr();
    const b = second.ptr();
    if (a.type() === NodeType.NODE_SYMMETRIC) a.setType(NodeType.NODE_SMOOTH, false);
    if (b.type() === NodeType.NODE_SYMMETRIC) b.setType(NodeType.NODE_SMOOTH, false);

    // We need to insert the segment after 'first'. We can't simply use 'second'
    // as the point of insertion, because when 'first' is the last node of closed path,
    // the new node will be inserted as the first node instead.
    const insert_at = first.inc();

    const data = this._multi_path_manipulator._path_data.node_data;
    if (a.front().isDegenerate() && b.back().isDegenerate()) {
      // for a line segment, insert a cusp node
      const n = new Node(data, a.position().lerp(t, b.position()));
      n.setType(NodeType.NODE_CUSP, false);
      return list.insert(insert_at, n);
    }
    // build bezier curve and subdivide
    const temp = new CubicBezier(a.position(), a.front().position(), b.back().position(), b.position());
    const seg1 = temp.portion(0, t).controlPoints();
    const seg2 = temp.portion(t, 1).controlPoints();

    // set new handle positions
    const n = new Node(data, seg2[0] as Point);
    n.back().setPosition(seg1[2] as Point);
    n.front().setPosition(seg2[1] as Point);
    n.setType(NodeType.NODE_SMOOTH, false);
    const inserted = list.insert(insert_at, n);

    a.front().move(seg1[1] as Point);
    b.back().move(seg2[2] as Point);
    return inserted;
  }

  /** Find the node that is closest/farthest from the origin. Returns an invalid iterator if none found. */
  extremeNode(
    origin: NodeIterator,
    search_selected: boolean,
    search_unselected: boolean,
    closest: boolean,
  ): NodeIterator {
    let match = new NodeIterator();
    let extr_dist = closest ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    if (this._selection.empty() && !search_unselected) return match;
    for (const sp of this._subpaths) {
      for (let j = sp.begin(); !j.equals(sp.end()); j = j.inc()) {
        if (j.ptr().selected() ? !search_selected : !search_unselected) continue;
        const dist = distance(j.ptr().position(), origin.ptr().position());
        if (closest ? dist < extr_dist : dist > extr_dist) {
          match = j;
          extr_dist = dist;
        }
      }
    }
    return match;
  }

  /** Called when a process updates the path in-situe */
  updatePath(): void {
    this._externalChange(PathChange.PATH_CHANGE_D);
  }

  /** Called by the XML observer when something else than us modifies the path. */
  _externalChange(type: PathChange): void {
    switch (type) {
      case PathChange.PATH_CHANGE_D: {
        this.hideDragPoint();
        this._getGeometry();
        // ugly: stored offsets of selected nodes in a vector
        const selpos: boolean[] = [];
        for (const sp of this._subpaths) for (const j of sp) selpos.push(j.selected());
        this._createControlPointsFromGeometry();
        let curpos = 0;
        for (const sp of this._subpaths) {
          for (const j of sp) {
            if (curpos >= selpos.length) return;
            if (selpos[curpos]) this._selection.insert(j);
            ++curpos;
          }
        }
        break;
      }
      case PathChange.PATH_CHANGE_TRANSFORM: {
        const path = this._path;
        if (!(path instanceof SPPath) || !path.parent) break;
        const i2d = path.i2dtAffine();
        // Document modifications without a change of the transform are common (every drag step).
        if (i2d.isNear(this.#i2d_transform, 1e-12)) break;
        this.hideDragPoint();
        const i2d_change = this.#d2i_transform.multiply(i2d);
        this.#i2d_transform = i2d;
        this.#d2i_transform = i2d.inverse();
        for (const sp of this._subpaths) for (const j of sp) j.transform(i2d_change);
        break;
      }
    }
  }

  _getTransform(): Affine {
    return this.#i2d_transform.multiply(this.#edit_transform);
  }

  /** Create nodes and handles based on the XML of the edited path. */
  _createControlPointsFromGeometry(): void {
    this.clear();
    // sanitize pathvector and store it in SPCurve,
    // so that _updateDragPoint doesn't crash on paths with naked movetos
    // note that close paths cannot have naked movetos - they have at least a degenerate closing path
    const pathv = pathv_to_linear_and_cubic_beziers(this._spcurve).filter((p) => !(p.empty() && !p.closed()));
    if (pathv.length === 0) return;
    this._spcurve = pathv;

    const m = this._getTransform();
    const data = this._multi_path_manipulator._path_data.node_data;
    // in this loop, we know that there are no zero-segment open subpaths
    for (const item_path of pathv) {
      const pit = item_path.transformed(m);
      // prepare new subpath
      const subpath = new NodeList(this._subpaths);
      this._subpaths.list.push(subpath);

      let previous_node = new Node(data, pit.initialPoint());
      subpath.push_back(previous_node);

      const closed = pit.closed();
      const curves = pit.curves();
      curves.forEach((cit, i) => {
        const pos = cit.finalPoint();
        let current_node: Node;
        // if the closing segment is degenerate and the path is closed, we need to move
        // the handle of the first node instead of creating a new one
        if (closed && i === curves.length - 1) {
          current_node = subpath.begin().ptr();
        } else {
          /* regardless of segment type, create a new node at the end
           * of this segment (unless this is the last segment of a closed path
           * with a degenerate closing segment */
          current_node = new Node(data, pos);
          subpath.push_back(current_node);
        }
        // if this is a bezier segment, move handles appropriately
        if (cit instanceof BezierCurve && cit.order() === 3) {
          previous_node.front().setPosition(cit.controlPoint(1));
          current_node.back().setPosition(cit.controlPoint(2));
        }
        previous_node = current_node;
      });
      // If the path is closed, make the list cyclic
      if (closed) subpath.setClosed(true);
    }

    // we need to set the nodetypes after all the handles are in place,
    // so that pickBestType works correctly
    // TODO maybe migrate to inkscape:node-types?
    const nts_raw = this._path?.getAttribute(this._nodetypesKey()) ?? '';
    /* pad the string to required length with a bogus value.
     * 'b' and any other letter not recognized by the parser causes the best fit to be set
     * as the node type */
    let tsi = 0;
    for (const sp of this._subpaths) {
      for (const j of sp) {
        const nodetype = tsi < nts_raw.length ? nts_raw[tsi++] : 'b';
        j.setType(Node.parse_nodetype(nodetype), false);
      }
      if (sp.closed() && tsi < nts_raw.length) {
        // STUPIDITY ALERT: it seems we need to use the duplicate type symbol instead of
        // the first one to remain backward compatible.
        sp.begin().ptr().setType(Node.parse_nodetype(nts_raw[tsi++]), false);
      }
    }
  }

  /** Construct the geometric representation of nodes and handles, update the outline and display */
  _createGeometryFromControlPoints(): void {
    const builder = new PathBuilder();
    for (const subpath of this._subpaths) {
      if (subpath.empty()) {
        this._subpaths.list.splice(this._subpaths.list.indexOf(subpath), 1);
        continue;
      }
      let prev = subpath.begin();
      builder.moveTo(prev.ptr().position());
      for (let i = subpath.begin().inc(); !i.equals(subpath.end()); i = i.inc()) {
        prev.ptr().build_segment(builder, i.ptr());
        prev = i;
      }
      if (subpath.closed()) {
        // Here we link the last and first node if the path is closed.
        // If the last segment is Bezier, we add it.
        if (!prev.ptr().front().isDegenerate() || !subpath.begin().ptr().back().isDegenerate()) {
          prev.ptr().build_segment(builder, subpath.begin().ptr());
        }
        // if that segment is linear, we just call closePath().
        builder.closePath();
      }
    }
    builder.flush();
    const m = this._getTransform().inverse();
    const pathv = builder
      .peek()
      .map((p) => p.transformed(m))
      .filter((p) => !(p.empty() && !p.closed()));
    if (pathv.length === 0) return;
    if (pathvEquals(this._spcurve, pathv)) return;
    this._spcurve = pathv;
    // TODO: alert LPEs (powerstroke adjustForNewPath), the outline (_live_outline).
    void this.#live_outline;
    if (this.#live_objects) this._setGeometry();
  }

  /** Construct a node type string to store in the sodipodi:nodetypes attribute. */
  _createTypeString(): string {
    // precondition: no single-node subpaths
    let tstr = '';
    for (const sp of this._subpaths) {
      for (const j of sp) tstr += nodeTypeChar(j.type());
      // nodestring format peculiarity: first node is counted twice for closed paths
      if (sp.closed()) tstr += nodeTypeChar(sp.begin().ptr().type());
    }
    return tstr;
  }

  /** Retrieve the geometry of the edited object from the object tree */
  _getGeometry(): void {
    if (this._path instanceof LivePathEffectObject) {
      const pathparam = this._path.get_lpe()?.getParameter(this._lpe_key);
      if (pathparam instanceof PathParam) this._spcurve = pathparam.get_pathvector();
    } else {
      this._spcurve = this._path?.curveForEdit() ?? [];
    }
  }

  /** Set the geometry of the edited object in the object tree, but do not commit to XML */
  _setGeometry(): void {
    // return true to leave the decision on empty to the caller.
    // Maybe the path become empty and we want to update to empty
    const path = this._path;
    if (path instanceof LivePathEffectObject) {
      // NOTE: if we are editing an LPE param, _path is not actually an SPPath, it is
      // a LivePathEffectObject. (mad laughter)
      const pathparam = path.get_lpe()?.getParameter(this._lpe_key);
      if (pathparam instanceof PathParam) {
        if (pathvEquals(pathparam.get_pathvector(), this._spcurve)) return; //False we dont update LPE
        pathparam.set_new_value(this._spcurve, false);
        path.requestModified(SP_OBJECT_MODIFIED_FLAG);
      }
      return;
    }
    if (this.empty() || !path) return;
    if (path.curveBeforeLPE()) {
      path.setCurveBeforeLPE(this._spcurve);
      if (path.hasPathEffectRecursive()) sp_lpe_item_update_patheffect(path, true, false);
    } else {
      path.setCurve(this._spcurve);
    }
  }

  /** Figure out in what attribute to store the nodetype string. */
  _nodetypesKey(): string {
    return this._path instanceof LivePathEffectObject ? `${this._lpe_key}-nodetypes` : 'sodipodi:nodetypes';
  }

  /**
   * Process a mouse click on a node (also used when its handles are clicked).
   * skip_auto: When cycling through node types, whether to skip the NODE_AUTO type (handle
   * clicks will set this to true)
   */
  _nodeClicked(n: Node, event: ButtonReleaseEvent, skip_auto: boolean): boolean {
    if (event.button !== 0) return false;
    if (node_delete(event)) {
      this.hideDragPoint();
      const iter = NodeList.get_iterator(n);
      const nl = n.nodeList();
      if (nl.size() <= 1 || (nl.size() <= 2 && !nl.closed())) {
        // Removing last node of closed path, or one of last two of an open path - delete the
        // whole path
        nl.kill();
      } else if (nl.size() === 2 && nl.closed()) {
        // Removing one of two nodes in a closed path - special case deletion to avoid a single
        // node with an empty path.
        this._deleteRest(iter.next());
      } else {
        // In other cases, delete the node under cursor
        this._deleteStretch(iter, iter.next(), NodeDeleteMode.curve_fit);
      }
      if (!this.empty()) this.update(true);
      // We need to call MPM's method because it could have been our last node
      this._multi_path_manipulator._doneWithCleanup(C_('Undo', 'Delete node'));
      return true;
    }
    if (node_cycle_type(event)) {
      if (!n.isEndNode()) {
        let next = n.type() + 1;
        if (skip_auto && next === NodeType.NODE_AUTO) next += 1;
        n.setType((next % NodeType.NODE_LAST_REAL_TYPE) as NodeType);
        this.update();
        this._commit(C_('Undo', 'Cycle node type'));
      }
      return true;
    }
    return false;
  }

  _handleGrabbed(): void {
    this._selection.hideTransformHandles();
  }

  _handleUngrabbed(): void {
    this._selection.restoreTransformHandles();
    this._commit(C_('Undo', 'Drag handle'));
  }

  _handleClicked(h: Handle, event: ButtonReleaseEvent): boolean {
    if (event.button === 0 && node_retract_handle(event)) {
      h.move(h.parent().position());
      this.update();
      this._commit(C_('Undo', 'Retract handle'));
      return true;
    }
    return false;
  }

  _selectionChangedM(pvec: SelectableControlPoint[], selected: boolean): void {
    for (const n of pvec) this._selectionChanged(n, selected);
  }

  _selectionChanged(p: SelectableControlPoint, selected: boolean): void {
    // don't do anything if we do not show handles
    if (!this.#show_handles) return;
    // only do something if a node changed selection state
    if (!(p instanceof Node) || p.nodeList()?.subpathList() !== this._subpaths) return;
    const node = p;

    // update handle display
    const iters: NodeIterator[] = Array.from({ length: 5 }, () => new NodeIterator());
    iters[2] = NodeList.get_iterator(node);
    iters[1] = (iters[2] as NodeIterator).prev();
    iters[3] = (iters[2] as NodeIterator).next();
    if (selected) {
      // selection - show handles on this node and adjacent ones
      node.showHandles(true);
      if (iters[1]?.valid()) iters[1].ptr().showHandles(true);
      if (iters[3]?.valid()) iters[3].ptr().showHandles(true);
    } else {
      /* Deselection is more complex.
       * The change might affect 3 nodes - this one and two adjacent.
       * If the node and both its neighbors are deselected, hide handles.
       * Otherwise, leave as is. */
      if (iters[1]?.valid()) iters[0] = iters[1].prev();
      if (iters[3]?.valid()) iters[4] = iters[3].next();
      const nodesel = iters.map((it) => it.valid() && it.ptr().selected());
      for (let i = 1; i < 4; ++i) {
        const it = iters[i] as NodeIterator;
        if (it.valid() && !nodesel[i - 1] && !nodesel[i] && !nodesel[i + 1]) it.ptr().showHandles(false);
      }
    }
  }

  /** Update the XML representation and put the specified annotation on the undo stack */
  _commit(annotation: string, key: string | null = null): void {
    this.writeXML();
    const doc = this._desktop.getDocument();
    if (key) DocumentUndo.maybeDone(doc, key, annotation, 'tool-node-editor');
    else DocumentUndo.done(doc, annotation, 'tool-node-editor');
  }

  /**
   * Update the position of the curve drag point such that it is over the nearest
   * point of the path. evp is in world coordinates. Returns the distance in screen px.
   * TODO: snapping.
   */
  _updateDragPoint(evp: Point): number {
    let dist = Number.POSITIVE_INFINITY;
    const to_desktop = this._getTransform();
    const pvp = pathv_nearest_time(this._spcurve, this._desktop.w2d(evp).transformed(to_desktop.inverse()));
    if (!pvp) return dist;

    const nearest_pt_dt = pathv_point_at(this._spcurve, pvp).transformed(to_desktop);
    const nearest_pt = this._desktop.d2w(nearest_pt_dt);
    dist = distance(evp, nearest_pt);
    const stroke_tolerance = this._getStrokeTolerance();

    let drag_point_updated = false;
    if (dist < stroke_tolerance) {
      const fracpart = pvp.t;
      const sp = this._subpaths.list[pvp.path_index];
      const first = sp ? sp.before(pvp.curve_index) : new NodeIterator();
      if (first.valid() && first.next().valid() && fracpart !== 0.0 && fracpart !== 1.0) {
        drag_point_updated = true;
        // stroke_tolerance is at least two.
        const tolerance = Math.max(2, Math.trunc(stroke_tolerance));
        this._dragpoint.setPosition(this._desktop.w2d(nearest_pt));
        this._dragpoint.setSize(2 * tolerance - 1);
        this._dragpoint.setTimeValue(fracpart);
        this._dragpoint.setIterator(first);
      }
    }
    this._dragpoint.setVisible(drag_point_updated);
    return dist;
  }

  /**
   * Compute the radius from the edge of the path where clicks should initiate a curve drag
   * or segment selection, in window coordinates.
   */
  _getStrokeTolerance(): number {
    /* Stroke event tolerance is equal to half the stroke's width plus the global
     * drag tolerance setting.  */
    let ret = Math.min(Math.max(Preferences.get().getInt('/options/dragtolerance/value', 2), 0), 100);
    const style = this._path instanceof SPPath ? this._path.style : null;
    if (style && !style.stroke.isNone()) {
      ret +=
        style.stroke_width.computed *
        0.5 *
        this._getTransform().descrim() * // scale to desktop coords
        this._desktop.current_zoom(); // == _d2w.descrim() - scale to window coords
    }
    return ret;
  }

  /** Whether item can be edited by a path manipulator (upstream is_item_type). */
  static is_item_type(item: unknown): item is SPPath {
    return item instanceof SPPath;
  }
}
