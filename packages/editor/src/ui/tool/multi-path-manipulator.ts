// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/multi-path-manipulator.cpp, src/ui/tool/multi-path-manipulator.h
/**
 * Multi path manipulator - implementation.
 */
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Abhishek Sharma
 *
 * Copyright (C) 2009 Authors
 */
import {
  C_,
  DocumentUndo,
  LivePathEffectObject,
  Preferences,
  Signal,
  type SPObject,
  SPPath,
} from '@inkscape-web/core';
import { type Dim2, distance, middle_point, type Point, Scale, Translate, X } from '@inkscape-web/geom';
import type { CanvasItemGroup } from '../../display/control/canvas-item.ts';
import {
  mod_alt,
  mod_alt_only,
  mod_ctrl,
  mod_shift,
  mod_shift_only,
  type ToolBase,
} from '../tools/tool-base.ts';
import { CommitEvent } from './commit-events.ts';
import { ControlPoint } from './control-point.ts';
import type { ControlPointSelection } from './control-point-selection.ts';
import { type ExtremumType, PointManipulator } from './manipulator.ts';
import { Node, NodeIterator, NodeList, type NodeSharedData } from './node.ts';
import { type AlignTargetNode, NodeType, SegmentType } from './node-types.ts';
import { NodeDeleteMode, PathManipulator } from './path-manipulator.ts';
import { type ShapeRecord, ShapeRole } from './shape-record.ts';

/** Canvas groups and data shared by the path manipulators of the node tool (upstream PathSharedData). */
export interface PathSharedData {
  node_data: NodeSharedData;
  outline_group: CanvasItemGroup;
  dragpoint_group: CanvasItemGroup;
}

type IterPair = [NodeIterator, NodeIterator];

/** Find pairs of selected endnodes suitable for joining. */
function find_join_iterators(sel: ControlPointSelection): IterPair[] {
  const pairs: IterPair[] = [];
  // find all endnodes in selection
  const join_iters: NodeIterator[] = [];
  for (const i of sel) {
    if (!(i instanceof Node)) continue;
    const iter = NodeList.get_iterator(i);
    if (!iter.next().valid() || !iter.prev().valid()) join_iters.push(iter);
  }
  if (join_iters.length < 2) return pairs;

  // Below we find the closest pairs. The algorithm is O(N^3).
  while (join_iters.length >= 2) {
    let closest = Number.MAX_VALUE;
    let closest_pair: [number, number] = [0, 1];
    for (let i = 0; i < join_iters.length; ++i) {
      for (let j = 0; j < i; ++j) {
        const dist = distance(
          (join_iters[i] as NodeIterator).ptr().position(),
          (join_iters[j] as NodeIterator).ptr().position(),
        );
        if (dist < closest) {
          closest = dist;
          closest_pair = [i, j];
        }
      }
    }
    const [i, j] = closest_pair;
    pairs.push([join_iters[i] as NodeIterator, join_iters[j] as NodeIterator]);
    join_iters.splice(Math.max(i, j), 1);
    join_iters.splice(Math.min(i, j), 1);
  }
  return pairs;
}

/**
 * After this function, first should be at the end of path and second at the beginning.
 * Returns true if the nodes are in the same subpath.
 */
function prepare_join(join_iters: IterPair): boolean {
  if (NodeList.get(join_iters[0]) === NodeList.get(join_iters[1])) {
    // if first is begin, swap the iterators
    if (join_iters[0].next().valid()) join_iters.reverse();
    return true;
  }
  const sp_first = NodeList.get(join_iters[0]);
  const sp_second = NodeList.get(join_iters[1]);
  if (join_iters[0].next().valid()) {
    // first is begin
    if (join_iters[1].next().valid()) {
      // second is begin
      sp_first.reverse();
    } else {
      // second is end
      join_iters.reverse();
    }
  } else {
    // first is end
    if (join_iters[1].next().valid()) {
      // second is begin - do nothing
    } else {
      // second is end
      sp_second.reverse();
    }
  }
  return false;
}

/**
 * Manipulator that manages multiple path manipulators active at the same
 * time (upstream MultiPathManipulator). Performs operations that are not
 * per-path, like node joins, and commits the changes of all paths with an
 * undo step.
 */
export class MultiPathManipulator extends PointManipulator {
  /** Emitted when the node selection or the node positions change. */
  readonly signal_coords_changed = new Signal<[]>();
  readonly _path_data: PathSharedData;
  readonly #mmap = new Map<SPObject, { record: ShapeRecord; pm: PathManipulator }>();
  #show_handles = true;
  #show_outline = false;
  #show_path_direction = false;
  #live_outline = true;
  #live_objects = true;
  readonly #disconnects: (() => void)[];

  constructor(data: PathSharedData) {
    super(data.node_data.desktop, data.node_data.selection);
    this._path_data = data;
    this.#disconnects = [
      this._selection.signal_commit.connect((ce) => this._commit(ce)),
      this._selection.signal_selection_changed.connect(() => this.signal_coords_changed.emit()),
    ];
  }

  destroy(): void {
    for (const d of this.#disconnects) d();
    for (const { pm } of this.#mmap.values()) pm.destroy();
    this.#mmap.clear();
  }

  empty(): boolean {
    return this.#mmap.size === 0;
  }

  /** The path manipulators, in the order of the edited items. */
  manipulators(): PathManipulator[] {
    return [...this.#mmap.values()].map((v) => v.pm);
  }

  /** Remove empty manipulators. */
  cleanup(): void {
    for (const [key, { pm }] of [...this.#mmap]) {
      if (pm.empty()) {
        pm.destroy();
        this.#mmap.delete(key);
      }
    }
  }

  /**
   * Change the set of items to edit.
   * This method attempts to preserve as much of the state as possible.
   */
  setItems(s: readonly ShapeRecord[]): void {
    const shapes = new Map(s.map((r) => [r.object, r]));
    // iterate over currently edited items, modifying / removing them as necessary
    for (const [key, entry] of [...this.#mmap]) {
      const sr_new = shapes.get(key);
      if (!sr_new) {
        // This item is no longer supposed to be edited - remove its manipulator
        entry.pm.destroy();
        this.#mmap.delete(key);
      } else {
        // if the shape record differs, replace the key only and modify other values
        if (!entry.record.edit_transform.equals(sr_new.edit_transform)) {
          entry.pm.setControlsTransform(sr_new.edit_transform);
        }
        entry.record = sr_new;
        shapes.delete(key); // remove the processed record
      }
    }

    // add newly selected items
    for (const r of shapes.values()) {
      const lpe_param = r.role === ShapeRole.SHAPE_ROLE_LPE_PARAM && r.object instanceof LivePathEffectObject;
      if (!(r.object instanceof SPPath) && !lpe_param) continue;
      const newpm = new PathManipulator(
        this,
        r.object as SPPath | LivePathEffectObject,
        r.edit_transform,
        r.lpe_key,
      );
      newpm.showHandles(this.#show_handles);
      // always show outlines for clips and masks
      newpm.showOutline(this.#show_outline || r.role !== ShapeRole.SHAPE_ROLE_NORMAL);
      newpm.showPathDirection(this.#show_path_direction);
      newpm.setLiveOutline(this.#live_outline);
      newpm.setLiveObjects(this.#live_objects);
      this.#mmap.set(r.object, { record: r, pm: newpm });
    }
  }

  #invokeForAll(f: (pm: PathManipulator) => void): void {
    for (const { pm } of [...this.#mmap.values()]) f(pm);
  }

  selectSubpaths(): void {
    if (this._selection.empty()) this._selection.selectAll();
    else this.#invokeForAll((pm) => pm.selectSubpaths());
  }

  /** Select the next (dir 1) or previous (dir -1) node after the last selected one. */
  shiftSelection(dir: number): void {
    if (this.empty()) return;
    const all: Node[] = [];
    for (const pm of this.manipulators()) for (const sp of pm.subpathList()) all.push(...sp);
    if (all.length === 0) return;
    // find last selected node (when tabbing backwards, the first one)
    let index = -1;
    for (let i = 0; i < all.length; i++) {
      if ((all[i] as Node).selected()) {
        index = i;
        if (dir === -1) break;
      }
    }
    let target: Node;
    if (index < 0) {
      // select first / last node
      target = (dir === 1 ? all[0] : all[all.length - 1]) as Node;
    } else {
      target = all[(index + dir + all.length) % all.length] as Node;
    }
    this._selection.clear();
    this._selection.insert(target);
  }

  invertSelectionInSubpaths(): void {
    this.#invokeForAll((pm) => pm.invertSelectionInSubpaths());
  }

  setNodeType(type: NodeType): void {
    if (this._selection.empty()) return;
    // When all selected nodes are already cusp, retract their handles
    let retract_handles = type === NodeType.NODE_CUSP;
    for (const i of this._selection) {
      if (!(i instanceof Node)) continue;
      retract_handles &&= i.type() === NodeType.NODE_CUSP;
      i.setType(type);
    }
    if (retract_handles) {
      for (const i of this._selection) {
        if (!(i instanceof Node)) continue;
        i.front().retract();
        i.back().retract();
      }
    }
    this._done(retract_handles ? C_('Undo', 'Retract handles') : C_('Undo', 'Change node type'));
  }

  setSegmentType(type: SegmentType): void {
    if (this._selection.empty()) return;
    this.#invokeForAll((pm) => pm.setSegmentType(type));
    if (type === SegmentType.SEGMENT_STRAIGHT) this._done(C_('Undo', 'Straighten segments'));
    else this._done(C_('Undo', 'Make segments curves'));
  }

  insertNodes(): void {
    if (this._selection.empty()) return;
    this.#invokeForAll((pm) => pm.insertNodes());
    this._done(C_('Undo', 'Add nodes'));
  }

  insertNodesAtExtrema(extremum: ExtremumType): void {
    if (this._selection.empty()) return;
    this.#invokeForAll((pm) => pm.insertNodeAtExtremum(extremum));
    this._done(C_('Undo', 'Add extremum nodes'));
  }

  /** Insert a node at the window point pt of the edited paths. */
  insertNode(pt: Point): void {
    // When double clicking to insert nodes, we might not have a selection of nodes (and we don't need one)
    // so don't check for "_selection.empty()" here, contrary to the other methods above and below this one
    this.#invokeForAll((pm) => pm.insertNodeAt(pt));
    this._done(C_('Undo', 'Add nodes'));
  }

  duplicateNodes(): void {
    if (this._selection.empty()) return;
    this.#invokeForAll((pm) => pm.duplicateNodes());
    this._done(C_('Undo', 'Duplicate nodes'));
  }

  joinNodes(): void {
    if (this._selection.empty()) return;
    this.#invokeForAll((pm) => pm.hideDragPoint());
    // Node join has two parts. In the first one we join two subpaths by fusing endpoints
    // into one. In the second we fuse nodes in each subpath.
    let preserve_pos = new NodeIterator();
    const mouseover_node = ControlPoint.mouseovered_point;
    if (mouseover_node instanceof Node) preserve_pos = NodeList.get_iterator(mouseover_node);
    const joins = find_join_iterators(this._selection);

    for (const join of joins) {
      const same_path = prepare_join(join);
      const sp_first = NodeList.get(join[0]);
      const sp_second = NodeList.get(join[1]);
      const first = join[0].ptr();
      const second = join[1].ptr();
      first.setType(NodeType.NODE_CUSP, false);

      const pos_handle_front = second.front().position();
      const pos_handle_back = first.back().position();
      let joined_pos: Point;
      // When we encounter the mouseover node, we unset the iterator - it will be invalidated
      if (join[0].equals(preserve_pos)) {
        joined_pos = first.position();
        preserve_pos = new NodeIterator();
      } else if (join[1].equals(preserve_pos)) {
        joined_pos = second.position();
        preserve_pos = new NodeIterator();
      } else {
        joined_pos = middle_point(first.position(), second.position());
      }

      // if the handles aren't degenerate, don't move them
      first.move(joined_pos);
      if (!second.front().isDegenerate()) first.front().setPosition(pos_handle_front);
      if (!first.back().isDegenerate()) first.back().setPosition(pos_handle_back);
      sp_second.erase(join[1]);

      if (same_path) {
        sp_first.setClosed(true);
      } else {
        sp_first.spliceAll(sp_first.end(), sp_second);
        sp_second.kill();
      }
      this._selection.insert(first);
    }

    if (joins.length === 0) {
      // Second part replaces contiguous selections of nodes with single nodes
      this.#invokeForAll((pm) => pm.weldNodes(preserve_pos));
    }
    this._doneWithCleanup(C_('Undo', 'Join nodes'), true);
  }

  breakNodes(): void {
    if (this._selection.empty()) return;
    this.#invokeForAll((pm) => pm.breakNodes());
    this._done(C_('Undo', 'Break nodes'), true);
  }

  /** Delete nodes; without mode, the preference decides which mode to use. */
  deleteNodes(mode?: NodeDeleteMode): void {
    mode ??= Preferences.get().getInt('/tools/nodes/delete_mode', 0) as NodeDeleteMode;
    if (this._selection.empty()) return;
    this.#invokeForAll((pm) => pm.deleteNodes(mode));
    this._doneWithCleanup(C_('Undo', 'Delete nodes'), true);
  }

  /** Join selected endpoints to create segments. */
  joinSegments(): void {
    if (this._selection.empty()) return;
    const joins = find_join_iterators(this._selection);
    for (const join of joins) {
      const same_path = prepare_join(join);
      const sp_first = NodeList.get(join[0]);
      const sp_second = NodeList.get(join[1]);
      join[0].ptr().setType(NodeType.NODE_CUSP, false);
      join[1].ptr().setType(NodeType.NODE_CUSP, false);
      if (same_path) {
        sp_first.setClosed(true);
      } else {
        sp_first.spliceAll(sp_first.end(), sp_second);
        sp_second.kill();
      }
    }
    if (joins.length === 0) this.#invokeForAll((pm) => pm.weldSegments());
    this._doneWithCleanup(C_('Undo', 'Join segments'), true);
  }

  deleteSegments(): void {
    if (this._selection.empty()) return;
    this.#invokeForAll((pm) => pm.deleteSegments());
    this._doneWithCleanup(C_('Undo', 'Delete segments'), true);
  }

  alignNodes(d: Dim2, target: AlignTargetNode): void {
    if (this._selection.empty()) return;
    this._selection.align(d, target);
    if (d === X) this._done(C_('Undo', 'Align nodes to a horizontal line'));
    else this._done(C_('Undo', 'Align nodes to a vertical line'));
  }

  distributeNodes(d: Dim2): void {
    if (this._selection.empty()) return;
    this._selection.distribute(d);
    if (d === X) this._done(C_('Undo', 'Distribute nodes horizontally'));
    else this._done(C_('Undo', 'Distribute nodes vertically'));
  }

  reverseSubpaths(): void {
    if (this._selection.empty()) {
      this.#invokeForAll((pm) => pm.reverseSubpaths(false));
      this._done(C_('Undo', 'Reverse subpaths'));
    } else {
      this.#invokeForAll((pm) => pm.reverseSubpaths(true));
      this._done(C_('Undo', 'Reverse selected subpaths'));
    }
  }

  /** Move the selected nodes by delta (desktop coordinates). */
  move(delta: Point): void {
    if (this._selection.empty()) return;
    this._selection.transform(Translate(delta));
    this._maybeDone('manipulator:move', C_('Undo', 'Move nodes'));
  }

  scale(center: Point, scale: Point): void {
    if (this._selection.empty()) return;
    this._selection.transform(Translate(center.neg()).multiply(Scale(scale)).multiply(Translate(center)));
    this._maybeDone('manipulator:scale', C_('Undo', 'Scale nodes'));
  }

  showOutline(show: boolean): void {
    for (const { record, pm } of this.#mmap.values()) {
      // always show outlines for clipping paths and masks
      pm.showOutline(show || record.role !== ShapeRole.SHAPE_ROLE_NORMAL);
    }
    this.#show_outline = show;
  }

  showHandles(show: boolean): void {
    this.#invokeForAll((pm) => pm.showHandles(show));
    this.#show_handles = show;
  }

  showPathDirection(show: boolean): void {
    this.#invokeForAll((pm) => pm.showPathDirection(show));
    this.#show_path_direction = show;
  }

  /**
   * Set live outline update status.
   * When set to true, outline will be updated continuously when dragging
   * or transforming nodes. Otherwise it will only update when changes are committed to XML.
   */
  setLiveOutline(set: boolean): void {
    this.#invokeForAll((pm) => pm.setLiveOutline(set));
    this.#live_outline = set;
  }

  /**
   * Set live object update status.
   * When set to true, objects will be updated continuously when dragging
   * or transforming nodes. Otherwise they will only update when changes are committed to XML.
   */
  setLiveObjects(set: boolean): void {
    this.#invokeForAll((pm) => pm.setLiveObjects(set));
    this.#live_objects = set;
  }

  updateHandles(): void {
    this.#invokeForAll((pm) => pm.updateHandles());
  }

  updatePaths(): void {
    this.#invokeForAll((pm) => pm.updatePath());
  }

  /** Keys of the node tool and the curve drag point updates on motion. */
  event(tool: ToolBase, event: Event): boolean {
    // TODO: single handle adjustments with the left / right Alt and Ctrl keys (ModifierTracker).
    if (event.type === 'pointermove') {
      for (const { pm } of this.#mmap.values()) if (pm.event(tool, event)) return true;
      return false;
    }
    if (event.type !== 'keydown') return false;
    const e = event as KeyboardEvent;
    const prefs = Preferences.get();
    switch (e.key) {
      case 'Insert':
        // Insert - insert nodes in the middle of selected segments
        this.insertNodes();
        return true;
      case 'i':
      case 'I':
        if (!mod_shift_only(e)) break;
        // Shift+I - insert nodes (alternate keybinding for Mac keyboards
        //           that don't have the Insert key)
        this.insertNodes();
        return true;
      case 'd':
      case 'D':
        if (!mod_shift_only(e)) break;
        this.duplicateNodes();
        return true;
      case 'j':
      case 'J':
        if (mod_shift_only(e)) {
          // Shift+J - join nodes
          this.joinNodes();
          return true;
        }
        if (mod_alt_only(e)) {
          // Alt+J - join segments
          this.joinSegments();
          return true;
        }
        break;
      case 'b':
      case 'B':
        if (!mod_shift_only(e)) break;
        // Shift+B - break nodes
        this.breakNodes();
        return true;
      case 'c':
      case 'C':
        if (!mod_shift_only(e)) break;
        // Shift+C - make nodes cusp
        this.setNodeType(NodeType.NODE_CUSP);
        return true;
      case 's':
      case 'S':
        if (!mod_shift_only(e)) break;
        // Shift+S - make nodes smooth
        this.setNodeType(NodeType.NODE_SMOOTH);
        return true;
      case 'a':
      case 'A':
        if (!mod_shift_only(e)) break;
        // Shift+A - make nodes auto-smooth
        this.setNodeType(NodeType.NODE_AUTO);
        return true;
      case 'y':
      case 'Y':
        if (!mod_shift_only(e)) break;
        // Shift+Y - make nodes symmetric
        this.setNodeType(NodeType.NODE_SYMMETRIC);
        return true;
      case 'r':
      case 'R':
        if (!mod_shift_only(e)) break;
        // Shift+R - reverse subpaths
        this.reverseSubpaths();
        return true;
      case 'l':
      case 'L':
        if (!mod_shift_only(e)) break;
        // Shift+L - make segments linear
        this.setSegmentType(SegmentType.SEGMENT_STRAIGHT);
        return true;
      case 'u':
      case 'U':
        if (!mod_shift_only(e)) break;
        // Shift+U - make segments curves
        this.setSegmentType(SegmentType.SEGMENT_CUBIC_BEZIER);
        return true;
      case 'Delete':
      case 'Backspace':
        if (mod_shift(e)) {
          this.deleteNodes(prefs.getInt('/tools/node/delete-mode-shift', NodeDeleteMode.inverse_auto));
        } else if (mod_alt(e)) {
          this.deleteNodes(prefs.getInt('/tools/node/delete-mode-alt', NodeDeleteMode.gap_nodes));
        } else if (mod_ctrl(e)) {
          this.deleteNodes(prefs.getInt('/tools/node/delete-mode-ctrl', NodeDeleteMode.line_segment));
        } else {
          this.deleteNodes(prefs.getInt('/tools/node/delete-mode-default', NodeDeleteMode.automatic));
        }
        // TODO: delete any selected gradient nodes as well (tool->deleteSelectedDrag).
        return true;
    }
    return false;
  }

  /**
   * Commit changes to XML and add undo stack entry based on the action that was done. Invoked
   * by sub-manipulators, for example TransformHandleSet and ControlPointSelection.
   */
  _commit(cps: CommitEvent): void {
    let reason: string;
    let key: string | null = null;
    switch (cps) {
      case CommitEvent.COMMIT_MOUSE_MOVE:
        reason = C_('Undo', 'Move nodes');
        break;
      case CommitEvent.COMMIT_KEYBOARD_MOVE_X:
        reason = C_('Undo', 'Move nodes horizontally');
        key = 'node:move:x';
        break;
      case CommitEvent.COMMIT_KEYBOARD_MOVE_Y:
        reason = C_('Undo', 'Move nodes vertically');
        key = 'node:move:y';
        break;
      case CommitEvent.COMMIT_MOUSE_ROTATE:
        reason = C_('Undo', 'Rotate nodes');
        break;
      case CommitEvent.COMMIT_KEYBOARD_ROTATE:
        reason = C_('Undo', 'Rotate nodes');
        key = 'node:rotate';
        break;
      case CommitEvent.COMMIT_MOUSE_SCALE_UNIFORM:
        reason = C_('Undo', 'Scale nodes uniformly');
        break;
      case CommitEvent.COMMIT_MOUSE_SCALE:
        reason = C_('Undo', 'Scale nodes');
        break;
      case CommitEvent.COMMIT_KEYBOARD_SCALE_UNIFORM:
        reason = C_('Undo', 'Scale nodes uniformly');
        key = 'node:scale:uniform';
        break;
      case CommitEvent.COMMIT_KEYBOARD_SCALE_X:
        reason = C_('Undo', 'Scale nodes horizontally');
        key = 'node:scale:x';
        break;
      case CommitEvent.COMMIT_KEYBOARD_SCALE_Y:
        reason = C_('Undo', 'Scale nodes vertically');
        key = 'node:scale:y';
        break;
      case CommitEvent.COMMIT_MOUSE_SKEW_X:
        reason = C_('Undo', 'Skew nodes horizontally');
        key = 'node:skew:x';
        break;
      case CommitEvent.COMMIT_MOUSE_SKEW_Y:
        reason = C_('Undo', 'Skew nodes vertically');
        key = 'node:skew:y';
        break;
      case CommitEvent.COMMIT_FLIP_X:
        reason = C_('Undo', 'Flip nodes horizontally');
        break;
      case CommitEvent.COMMIT_FLIP_Y:
        reason = C_('Undo', 'Flip nodes vertically');
        break;
      default:
        return;
    }
    this._selection.signal_update.emit();
    this.#invokeForAll((pm) => pm.writeXML());
    const doc = this._desktop.getDocument();
    if (key) DocumentUndo.maybeDone(doc, key, reason, 'tool-node-editor');
    else DocumentUndo.done(doc, reason, 'tool-node-editor');
    this.signal_coords_changed.emit();
  }

  /** Commits changes to XML and adds undo stack entry. */
  _done(reason: string, alert_LPE = false): void {
    this.#invokeForAll((pm) => pm.update(alert_LPE));
    this.#invokeForAll((pm) => pm.writeXML());
    DocumentUndo.done(this._desktop.getDocument(), reason, 'tool-node-editor');
    this.signal_coords_changed.emit();
  }

  _maybeDone(key: string, reason: string, alert_LPE = false): void {
    this.#invokeForAll((pm) => pm.update(alert_LPE));
    this.#invokeForAll((pm) => pm.writeXML());
    DocumentUndo.maybeDone(this._desktop.getDocument(), key, reason, 'tool-node-editor');
    this.signal_coords_changed.emit();
  }

  /** Commits changes to XML, adds undo stack entry and removes empty manipulators. */
  _doneWithCleanup(reason: string, alert_LPE = false): void {
    this._done(reason, alert_LPE);
    this.cleanup();
  }
}
