// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/tool/manipulator.h
/* Authors:
 *   Krzysztof Kosiński <tweenk.pl@gmail.com>
 *
 * Copyright (C) 2009 Authors
 */
import type { SPDesktop } from '../../desktop.ts';
import type { ToolBase } from '../tools/tool-base.ts';
import type { ControlPointSelection } from './control-point-selection.ts';

/** Tool component that processes events and does something in response to them. */
export abstract class Manipulator {
  readonly _desktop: SPDesktop;

  constructor(d: SPDesktop) {
    this._desktop = d;
  }

  /** Handle an event. Returns true if it was handled. */
  abstract event(tool: ToolBase, event: Event): boolean;
}

export enum ExtremumType {
  EXTR_MIN_X,
  EXTR_MAX_X,
  EXTR_MIN_Y,
  EXTR_MAX_Y,
}

/** Manipulator that operates on control points. */
export abstract class PointManipulator extends Manipulator {
  readonly _selection: ControlPointSelection;

  constructor(d: SPDesktop, sel: ControlPointSelection) {
    super(d);
    this._selection = sel;
  }
}
