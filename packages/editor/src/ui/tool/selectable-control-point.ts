// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/selectable-control-point.cpp, src/ui/tool/selectable-control-point.h
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *   Jon A. Cruz <jon@joncruz.org>
 *
 * Copyright (C) 2009 Authors
 */
import type { Point } from '@inkscape-web/geom';
import type { SPDesktop } from '../../desktop.ts';
import type { CanvasItemGroup } from '../../display/control/canvas-item.ts';
import type { CanvasItemCtrlType } from '../../display/control/canvas-item-ctrl.ts';
import type { SPAnchorType } from '../../enums.ts';
import { mod_shift } from '../tools/tool-base.ts';
import { type ButtonReleaseEvent, ControlPoint, type MotionEvent, State } from './control-point.ts';
import type { ControlPointSelection } from './control-point-selection.ts';

/** A control point that can be selected; it belongs to one ControlPointSelection. */
export class SelectableControlPoint extends ControlPoint {
  readonly _selection: ControlPointSelection;

  constructor(
    d: SPDesktop,
    initial_pos: Point,
    anchor: SPAnchorType,
    type: CanvasItemCtrlType,
    sel: ControlPointSelection,
    group: CanvasItemGroup | null = null,
  ) {
    super(d, initial_pos, anchor, type, group);
    this._selection = sel;
    this._selection.allPoints().add(this);
  }

  override destroy(): void {
    this._selection.erase(this);
    this._selection.allPoints().delete(this);
    super.destroy();
  }

  override grabbed(_event: MotionEvent): boolean {
    // if a point is dragged while not selected, it should select itself
    if (!this.selected()) this._takeSelection();
    this._selection._pointGrabbed(this);
    return false;
  }

  override dragged(new_pos: Point, event: MotionEvent): Point {
    this._selection._pointDragged(new_pos, event);
    return new_pos;
  }

  override ungrabbed(_event: ButtonReleaseEvent | null): void {
    this._selection._pointUngrabbed();
  }

  override clicked(event: ButtonReleaseEvent): boolean {
    if (this._selection._pointClicked(this, event)) return true;
    if (event.button !== 0) return false;
    if (mod_shift(event)) {
      if (this.selected()) this._selection.erase(this);
      else this._selection.insert(this);
    } else {
      this._takeSelection();
    }
    return true;
  }

  select(toselect: boolean): void {
    if (toselect) this._selection.insert(this);
    else this._selection.erase(this);
  }

  selected(): boolean {
    return this._selection.has(this);
  }

  protected _takeSelection(): void {
    this._selection.clear();
    this._selection.insert(this);
  }

  protected override _setState(state: State): void {
    if (!this.selected()) {
      super._setState(state);
      return;
    }
    this._canvas_item_ctrl.set_normal(true);
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
}
