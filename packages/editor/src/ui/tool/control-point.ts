// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/control-point.cpp, src/ui/tool/control-point.h
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2012 Authors
 * Copyright (C) 2009 Authors
 */
import { Preferences, Signal } from '@inkscape-web/core';
import { type Affine, Point, Rect } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { CanvasItemGroup } from '../../display/control/canvas-item.ts';
import { CanvasItemCtrl, type CanvasItemCtrlType } from '../../display/control/canvas-item-ctrl.ts';
import type { SPAnchorType } from '../../enums.ts';
import type { ModifierState, ToolBase } from '../tools/tool-base.ts';

/** A pointer motion during a drag (upstream MotionEvent). pos is in world coordinates. */
export interface MotionEvent extends ModifierState {
  pos: Point;
  /** Set for the fake event that moves the point back when a drag is canceled. */
  control_point_synthesized?: boolean;
}

/** A button release (upstream ButtonReleaseEvent). pos is in world coordinates. */
export interface ButtonReleaseEvent extends ModifierState {
  button: number;
  pos: Point;
}

/** Visual state of a control point. */
export enum State {
  /** Normal state. */
  STATE_NORMAL,
  /** Mouse is hovering over the control point. */
  STATE_MOUSEOVER,
  /** First mouse button pressed over the control point. */
  STATE_CLICKED,
}

/** Maximum time between two presses of a double click, in ms. */
const DOUBLE_CLICK_TIME = 400;

const NO_MODIFIERS: ModifierState = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };

/** Modifier state and world position of a DOM event. */
function eventData(desktop: SPDesktop, event: MouseEvent): ModifierState & { pos: Point } {
  const canvas = desktop.getCanvas();
  return {
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    pos: canvas.canvas_to_world(canvas.windowPoint(event)),
  };
}

/**
 * Draggable point, the workhorse of on-canvas editing (upstream ControlPoint).
 *
 * Control points (formerly known as knots) are graphical representations of
 * some significant point in the drawing. The drawing can be changed by
 * dragging the point and the things that are attached to it with the mouse.
 *
 * When a drag happens, the order of calls is: grabbed(), dragged() (any
 * number of times), ungrabbed(). A press and release without motion beyond
 * the drag tolerance calls clicked(); the release of the second press of a
 * double click calls doubleclicked() instead.
 *
 * The point receives the pointer events of its canvas item; handled events do
 * not reach the tool. Positions are in desktop coordinates; event positions
 * (pos) are in world coordinates, like the upstream canvas event positions.
 * TODO: tips in the status bar, snapping, autoscroll, cursors.
 */
export class ControlPoint {
  /** Holds the currently mouseovered control point. */
  static mouseovered_point: ControlPoint | null = null;
  /** Emitted when the mouseovered point changes. The parameter is the new mouseovered point. */
  static readonly signal_mouseover_change = new Signal<[ControlPoint | null]>();

  /** Event position of the button press of the current drag, in world coordinates. */
  protected static _drag_event_origin = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  /** Position of the point when the drag started, in desktop coordinates. */
  protected static _drag_origin = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  protected static _drag_initiated = false;
  /** The point that has the pointer grab, if any. */
  static #grabbed: ControlPoint | null = null;
  static #grab_pointer_id = -1;
  /** Offset from the pointer hotspot to the center of the grabbed knot in desktop coords. */
  static #pointer_offset = new Point(0, 0);
  /** Number of last doubleclicked button. */
  static #next_release_doubleclick = 0;
  static #last_press: { time: number; pos: Point } | null = null;

  readonly _desktop: SPDesktop;
  protected readonly _canvas_item_ctrl: CanvasItemCtrl;
  protected _state = State.STATE_NORMAL;
  protected _double_clicked = false;
  #position: Point;
  #selected_appearance = false;
  #destroyed = false;

  constructor(
    d: SPDesktop,
    initial_pos: Point,
    anchor: SPAnchorType,
    type: CanvasItemCtrlType,
    group: CanvasItemGroup | null = null,
  ) {
    this._desktop = d;
    this.#position = initial_pos;
    this._canvas_item_ctrl = new CanvasItemCtrl(group ?? d.getCanvasControls(), type);
    this._canvas_item_ctrl.set_anchor(anchor);
    this._canvas_item_ctrl.set_position(initial_pos);
    const el = this._canvas_item_ctrl.element;
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'pointerenter',
      'pointerleave',
    ]) {
      el.addEventListener(type, this.#onEvent);
    }
  }

  /** Remove the point from the canvas (upstream destructor). */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    // MUST release the static global lock.
    if (ControlPoint.#grabbed === this) {
      this.#ungrab();
      ControlPoint._drag_initiated = false;
    }
    // avoid storing invalid points in mouseovered_point
    if (this === ControlPoint.mouseovered_point) ControlPoint._clearMouseover();
    this._canvas_item_ctrl.unlink();
  }

  /** The point that currently has the pointer grab (is pressed or dragged), if any. */
  static grabbedPoint(): ControlPoint | null {
    return ControlPoint.#grabbed;
  }

  /** Current position of the control point, in desktop coordinates. */
  position(): Point {
    return this.#position;
  }

  /** Relocate the control point without side effects. */
  setPosition(pos: Point): void {
    this.#position = pos;
    this._canvas_item_ctrl.set_position(pos);
  }

  /** Move the control point to new position with side effects. Subclasses override it. */
  move(pos: Point): void {
    this.setPosition(pos);
  }

  /** Apply an arbitrary affine transformation to a control point. */
  transform(m: Affine): void {
    this.move(this.position().transformed(m));
  }

  /** Restore the point's invariants after a transform of several points. */
  fixNeighbors(): void {}

  /** Bounds of the point and its dependents (handles). */
  bounds(): Rect {
    return new Rect(this.#position, this.#position);
  }

  visible(): boolean {
    return this._canvas_item_ctrl.is_visible();
  }

  setVisible(v: boolean): void {
    this._canvas_item_ctrl.set_visible(v);
  }

  /** Redraw with the current state (upstream updateState). */
  updateState(): void {
    this._setState(this._state);
  }

  set_selected_appearance(selected: boolean): void {
    if (this.#selected_appearance === selected) return;
    this.#selected_appearance = selected;
    this._canvas_item_ctrl.set_selected(selected);
  }

  protected _selected_appearance(): boolean {
    return this.#selected_appearance;
  }

  protected _setSize(size: number): void {
    this._canvas_item_ctrl._set_size(size);
  }

  protected _setControlType(type: CanvasItemCtrlType): void {
    this._canvas_item_ctrl.set_type(type);
  }

  /** Reset the size to the handle size preference (after a change of the preference or the style). */
  _handleControlStyling(): void {
    this._canvas_item_ctrl.set_size_default();
  }

  /** The event position of the last button press, in world coordinates. */
  protected _last_click_event_point(): Point {
    return ControlPoint._drag_event_origin;
  }

  /** The position of the point when the drag started, in desktop coordinates. */
  protected _last_drag_origin(): Point {
    return ControlPoint._drag_origin;
  }

  protected _is_drag_cancelled(event: MotionEvent): boolean {
    return !!event.control_point_synthesized;
  }

  readonly #onEvent = (event: Event): void => {
    if (this.#destroyed) return;
    if (this._eventHandler(this._desktop.getTool(), event)) event.stopPropagation();
  };

  /** Main event callback, which emits all other callbacks. Returns true if the event was handled. */
  _eventHandler(tool: ToolBase | null, event: Event): boolean {
    if (!tool) return false;
    this._double_clicked = false;
    const drag_tolerance = Math.min(
      Math.max(Preferences.get().getInt('/options/dragtolerance/value', 0), 0),
      100,
    );
    let ret = false;

    switch (event.type) {
      case 'pointerdown': {
        const e = event as PointerEvent;
        const data = eventData(this._desktop, e);
        // Two presses close in time and space: the release of the second one is a double click.
        const last = ControlPoint.#last_press;
        const now = e.timeStamp;
        const second =
          last !== null &&
          now - last.time < DOUBLE_CLICK_TIME &&
          Math.max(Math.abs(data.pos.x - last.pos.x), Math.abs(data.pos.y - last.pos.y)) <= drag_tolerance;
        ControlPoint.#last_press = second ? null : { time: now, pos: data.pos };
        ControlPoint.#next_release_doubleclick = 0;
        if (e.button === 0) {
          // 1st mouse button click. internally, start dragging, but do not emit signals
          // or change position until drag tolerance is exceeded.
          this._desktop.getCanvas().svg.focus({ preventScroll: true });
          ControlPoint._drag_event_origin = data.pos;
          ControlPoint.#pointer_offset = this.#position.sub(this._desktop.w2d(data.pos));
          ControlPoint._drag_initiated = false;
          // route all events to this handler
          this.#grab(e.pointerId);
          this._setState(State.STATE_CLICKED);
          if (second) ControlPoint.#next_release_doubleclick = 1;
          ret = true;
        } else {
          ret = ControlPoint.#grabbed !== null;
        }
        break;
      }
      case 'pointermove': {
        const e = event as PointerEvent;
        if (ControlPoint.#grabbed !== this) break;
        const data = eventData(this._desktop, e);
        let transferred = false;
        if (!ControlPoint._drag_initiated) {
          const d = data.pos.sub(ControlPoint._drag_event_origin);
          if (Math.max(Math.abs(d.x), Math.abs(d.y)) <= drag_tolerance) {
            ret = true;
            break;
          }
          // if we are here, it means the tolerance was just exceeded.
          ControlPoint._drag_origin = this.#position;
          transferred = this.grabbed(data);
          // _drag_initiated might change during the above virtual call
          ControlPoint._drag_initiated = true;
        }
        if (!transferred) {
          // dragging in progress
          let new_pos = this._desktop.w2d(data.pos).add(ControlPoint.#pointer_offset);
          // the new position can be changed in the handlers.
          new_pos = this.dragged(new_pos, data);
          this.move(new_pos);
          // TODO: drag tip, autoscroll, coordinate status, snap delay.
        }
        ret = true;
        break;
      }
      case 'pointerup':
      case 'pointercancel': {
        const e = event as PointerEvent;
        if (ControlPoint.#grabbed !== this || e.button !== 0) break;
        const data = eventData(this._desktop, e);
        this.#ungrab();
        ControlPoint._setMouseover(this, data);
        if (ControlPoint._drag_initiated) {
          // it is the end of a drag
          ControlPoint._drag_initiated = false;
          this.ungrabbed({ ...data, button: e.button });
          ret = true;
        } else if (event.type === 'pointerup') {
          // it is the end of a click
          if (ControlPoint.#next_release_doubleclick) {
            this._double_clicked = true;
            ret = this.doubleclicked({ ...data, button: e.button });
          } else {
            ret = this.clicked({ ...data, button: e.button });
          }
        }
        break;
      }
      case 'pointerenter':
        ControlPoint._setMouseover(this, event as PointerEvent);
        return true;
      case 'pointerleave':
        if (ControlPoint.#grabbed !== this) ControlPoint._clearMouseover();
        return true;
      case 'keydown': {
        const e = event as KeyboardEvent;
        // Escape cancels a drag; ignore it if this is not a drag.
        if (e.key !== 'Escape' || !ControlPoint._drag_initiated || ControlPoint.#grabbed !== this) break;
        // make a fake event for dragging
        // ASSUMPTION: dragging a point without modifiers will never prevent us from moving it
        //             to its original position
        const fake: MotionEvent = {
          ...NO_MODIFIERS,
          pos: ControlPoint._drag_event_origin,
          control_point_synthesized: true,
        };
        const new_pos = this.dragged(ControlPoint._drag_origin, fake);
        this.move(new_pos);
        this.#ungrab();
        ControlPoint._clearMouseover(); // this will also reset state to normal
        ControlPoint._drag_initiated = false;
        this.ungrabbed(null); // ungrabbed handlers can handle a null event
        return true;
      }
    }
    // do not propagate events during grab - it might cause problems
    return ret || ControlPoint.#grabbed !== null;
  }

  #grab(pointerId: number): void {
    ControlPoint.#grabbed = this;
    ControlPoint.#grab_pointer_id = pointerId;
    this._canvas_item_ctrl.element.setPointerCapture?.(pointerId);
  }

  #ungrab(): void {
    const el = this._canvas_item_ctrl.element;
    const id = ControlPoint.#grab_pointer_id;
    if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
    ControlPoint.#grabbed = null;
  }

  /**
   * Transfer the grab to this point: it receives the rest of the drag that
   * started on prev_point (e.g. dragging a handle out of a node).
   */
  transferGrab(prev_point: ControlPoint, event: MotionEvent): void {
    if (ControlPoint.#grabbed !== prev_point) return;
    this.grabbed(event);
    const id = ControlPoint.#grab_pointer_id;
    prev_point.#ungrab();
    this.#grab(id);
    ControlPoint._drag_initiated = true;
    prev_point._setState(State.STATE_NORMAL);
    ControlPoint._setMouseover(this, event);
  }

  protected static _setMouseover(p: ControlPoint, _state: ModifierState): void {
    const visible = p.visible();
    if (visible) {
      // invisible points shouldn't get mouseovered
      p._setState(State.STATE_MOUSEOVER);
    }
    // TODO: p._updateTip(state)
    if (visible && ControlPoint.mouseovered_point !== p) {
      ControlPoint.mouseovered_point = p;
      ControlPoint.signal_mouseover_change.emit(p);
    }
  }

  protected static _clearMouseover(): void {
    const p = ControlPoint.mouseovered_point;
    if (p) {
      p._setState(State.STATE_NORMAL);
      ControlPoint.mouseovered_point = null;
      ControlPoint.signal_mouseover_change.emit(null);
    }
  }

  /** Change the state of the knot. Alters the appearance of the knot to match one of the states. */
  protected _setState(state: State): void {
    this._canvas_item_ctrl.set_normal(this.#selected_appearance);
    switch (state) {
      case State.STATE_NORMAL:
        break;
      case State.STATE_MOUSEOVER:
        this._canvas_item_ctrl.set_hover();
        break;
      case State.STATE_CLICKED:
        this._canvas_item_ctrl.set_click();
        break;
    }
    this._state = state;
  }

  // Event handlers (dummy implementations)

  /**
   * Called when the drag tolerance is exceeded. Returns true if the grab was
   * transferred to another point (then dragged() is not called).
   */
  grabbed(_event: MotionEvent): boolean {
    return false;
  }

  /** Called while dragging, before the move. Returns the new position, possibly constrained. */
  dragged(new_pos: Point, _event: MotionEvent): Point {
    return new_pos;
  }

  /** Called at the end of a drag; event is null for a canceled drag. */
  ungrabbed(_event: ButtonReleaseEvent | null): void {}

  /** Called for a click without drag. Returns true if handled. */
  clicked(_event: ButtonReleaseEvent): boolean {
    return false;
  }

  /** Called for the release of a double click. Returns true if handled. */
  doubleclicked(_event: ButtonReleaseEvent): boolean {
    return false;
  }
}
