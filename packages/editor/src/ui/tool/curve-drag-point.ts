// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/curve-drag-point.cpp, src/ui/tool/curve-drag-point.h
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2009 Authors
 */
import { C_ } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { CanvasItemCtrlType } from '../../display/control/canvas-item-ctrl.ts';
import { SPAnchorType } from '../../enums.ts';
import { type ModifierState, mod_alt, mod_ctrl, mod_shift, type ToolBase } from '../tools/tool-base.ts';
import { type ButtonReleaseEvent, ControlPoint, type MotionEvent } from './control-point.ts';
import { NodeIterator } from './node.ts';
import { SegmentType } from './node-types.ts';
import type { PathManipulator } from './path-manipulator.ts';

// Modifiers of the node tool (upstream Modifiers::Modifier defaults in src/ui/modifiers.cpp).
/** select-add-to: Shift */
const select_add_to = (s: ModifierState) => mod_shift(s);
/** node-insert: Ctrl+Alt */
const node_insert = (s: ModifierState) => mod_ctrl(s) && mod_alt(s);
/** node-delete-segment: Ctrl+Alt */
const node_delete_segment = (s: ModifierState) => mod_ctrl(s) && mod_alt(s);
/** node-straighten-segment: Alt */
const node_straighten_segment = (s: ModifierState) => mod_alt(s);

/**
 * An invisible point used to drag curves (upstream CurveDragPoint). This
 * point is used by PathManipulator to allow editing of path segments by
 * dragging them. It is updated whenever the mouse moves close to the path.
 * A click selects the two nodes of the segment, a double click inserts a node.
 */
export class CurveDragPoint extends ControlPoint {
  static #segment_was_degenerate = false;

  readonly #pm: PathManipulator;
  #t = 0;
  /** The node at the start of the segment under the point. */
  first = new NodeIterator();

  constructor(pm: PathManipulator) {
    super(
      pm._multi_path_manipulator._path_data.node_data.desktop,
      new Point(0, 0),
      SPAnchorType.SP_ANCHOR_CENTER,
      CanvasItemCtrlType.CANVAS_ITEM_CTRL_TYPE_INVISIPOINT,
      pm._multi_path_manipulator._path_data.dragpoint_group,
    );
    this.#pm = pm;
    this.setVisible(false);
  }

  setSize(sz: number): void {
    this._setSize(sz);
  }
  setTimeValue(t: number): void {
    this.#t = t;
  }
  getTimeValue(): number {
    return this.#t;
  }
  setIterator(i: NodeIterator): void {
    this.first = i;
  }
  getIterator(): NodeIterator {
    return this.first;
  }

  override _eventHandler(tool: ToolBase | null, event: Event): boolean {
    // do not process any events when the manipulator is empty
    if (this.#pm.empty()) {
      this.setVisible(false);
      return false;
    }
    return super._eventHandler(tool, event);
  }

  override grabbed(_event: MotionEvent): boolean {
    this.#pm._selection.hideTransformHandles();
    if (!this.first.valid() || !this.first.next().valid()) return false;
    const a = this.first.ptr();
    const b = this.first.next().ptr();

    // move the handles to 1/3 the length of the segment for line segments
    if (a.front().isDegenerate() && b.back().isDegenerate()) {
      CurveDragPoint.#segment_was_degenerate = true;
      // delta is a vector equal 1/3 of distance from first to second
      const delta = b.position().sub(a.position()).div(3.0);
      a.front().move(a.front().position().add(delta));
      b.back().move(b.back().position().sub(delta));
      this.#pm.update();
    } else {
      CurveDragPoint.#segment_was_degenerate = false;
    }
    return false;
  }

  override dragged(new_pos: Point, event: MotionEvent): Point {
    if (!this.first.valid() || !this.first.next().valid()) return new_pos;
    const a = this.first.ptr();
    const b = this.first.next().ptr();

    // special cancel handling - retract handles when if the segment was degenerate
    if (this._is_drag_cancelled(event) && CurveDragPoint.#segment_was_degenerate) {
      a.front().retract();
      b.back().retract();
      this.#pm.update();
      return new_pos;
    }
    // TODO: snapping.

    // Magic Bezier Drag Equations follow!
    // "weight" describes how the influence of the drag should be distributed
    // among the handles; 0 = front handle only, 1 = back handle only.
    const t = this.#t;
    let weight: number;
    if (t <= 1.0 / 6.0) weight = 0;
    else if (t <= 0.5) weight = ((6 * t - 1) / 2.0) ** 3 / 2;
    else if (t <= 5.0 / 6.0) weight = (1 - ((6 * (1 - t) - 1) / 2.0) ** 3) / 2 + 0.5;
    else weight = 1;

    const delta = new_pos.sub(this.position());
    const offset0 = delta.mul((1 - weight) / (3 * t * (1 - t) * (1 - t)));
    const offset1 = delta.mul(weight / (3 * t * t * (1 - t)));

    a.front().move(a.front().position().add(offset0));
    b.back().move(b.back().position().add(offset1));
    this.#pm.update();
    return new_pos;
  }

  override ungrabbed(_event: ButtonReleaseEvent | null): void {
    this.#pm._updateDragPoint(this._desktop.d2w(this.position()));
    this.#pm._commit(C_('Undo', 'Drag curve'));
    this.#pm._selection.restoreTransformHandles();
  }

  override clicked(event: ButtonReleaseEvent): boolean {
    // This check is probably redundant
    if (!this.first.valid() || event.button !== 0) return false;
    // the next iterator can be invalid if we click very near the end of path
    const second = this.first.next();
    if (!second.valid()) return false;

    if (node_insert(event)) {
      this._insertNode(false);
      return true;
    }

    const sel = this.#pm._selection;
    if (select_add_to(event)) {
      // if both nodes of the segment are selected, deselect;
      // otherwise add to selection
      if (this.first.ptr().selected() && second.ptr().selected()) {
        sel.erase(this.first.ptr());
        sel.erase(second.ptr());
      } else {
        sel.insert(this.first.ptr());
        sel.insert(second.ptr());
      }
    } else {
      // without Shift, take selection
      sel.clear();
      sel.insert(this.first.ptr(), false, false);
      sel.insert(second.ptr());
    }
    return true;
  }

  override doubleclicked(event: ButtonReleaseEvent): boolean {
    if (event.button !== 0 || !this.first.valid() || !this.first.next().valid()) return false;
    if (node_delete_segment(event)) {
      this.#pm.deleteSegments();
      this.#pm.update(true);
      this.#pm._commit(C_('Undo', 'Remove segment'));
    } else if (node_straighten_segment(event)) {
      this.#pm.setSegmentType(SegmentType.SEGMENT_STRAIGHT);
      this.#pm.update(true);
      this.#pm._commit(C_('Undo', 'Straighten segments'));
    } else {
      this.#pm._updateDragPoint(this._desktop.d2w(this.position()));
      this._insertNode(true);
    }
    return true;
  }

  _insertNode(take_selection: boolean): void {
    // The purpose of this call is to make way for the just created node.
    // Otherwise clicks on the new node would only work after the user moves the mouse a bit.
    // PathManipulator will restore visibility when necessary.
    this.setVisible(false);
    this.#pm.insertNode(this.first, this.#t, take_selection);
  }
}
