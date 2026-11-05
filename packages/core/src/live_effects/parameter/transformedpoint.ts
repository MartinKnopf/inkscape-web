// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/transformedpoint.cpp, src/live_effects/parameter/transformedpoint.h
/*
 * Copyright (C) Theodore Janeczko 2012 <flutterguy317@gmail.com>
 *
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { type Affine, Point } from '@inkscape-web/geom';
import { C_ } from '../../i18n.ts';
import { svgPoint } from '../../svg/stringstream.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';
import { readOriginAndVector, readPointValue, writeOriginAndVector } from './vector.ts';

/**
 * A vector with an origin, written as "ox,oy , vx,vy" (upstream TransformedPointParam). Unlike
 * VectorParam, the transform of the item does not change it when noTransform is set.
 * Upstream's knot is never added: its addKnotHolderEntities() has another signature than
 * Parameter's, so the effects do not call it.
 */
export class TransformedPointParam extends Parameter {
  defvalue: Point;
  origin = new Point(0, 0);
  vector: Point;
  noTransform: boolean;

  constructor(
    label: string,
    tip: string,
    key: string,
    effect: Effect,
    default_vector = new Point(1, 0),
    dontTransform = false,
  ) {
    super(label, tip, key, effect);
    this.defvalue = default_vector;
    this.vector = default_vector;
    this.noTransform = dontTransform;
  }

  getVector(): Point {
    return this.vector;
  }
  getOrigin(): Point {
    return this.origin;
  }
  setValues(new_origin: Point, new_vector: Point): void {
    this.setVector(new_vector);
    this.setOrigin(new_origin);
  }
  setVector(new_vector: Point): void {
    this.vector = new_vector;
  }
  setOrigin(new_origin: Point): void {
    this.origin = new_origin;
  }

  param_set_default(): void {
    this.setOrigin(new Point(0, 0));
    this.setVector(this.defvalue);
  }
  param_get_default(): Point {
    return this.defvalue;
  }
  param_update_default(default_point: Point | string): void {
    if (typeof default_point !== 'string') {
      this.defvalue = default_point;
      return;
    }
    const p = readPointValue(default_point);
    if (p) this.defvalue = p;
  }
  param_readSVGValue(strvalue: string): boolean {
    const v = readOriginAndVector(strvalue);
    if (!v) return false;
    this.setOrigin(v[0]);
    this.setVector(v[1]);
    return true;
  }
  param_getSVGValue(): string {
    return writeOriginAndVector(this.origin, this.vector);
  }
  param_getDefaultSVGValue(): string {
    return svgPoint(this.defvalue.x, this.defvalue.y);
  }
  /** The vector as x and y (upstream: a RegisteredVector in polar coordinates). */
  param_newWidget(): ParamWidget | null {
    return this.widget_is_visible ? { kind: 'point', x: this.vector.x, y: this.vector.y } : null;
  }
  /** Write the vector from the widget. */
  param_set_from_widget(v: Point): void {
    this.param_write_from_widget(writeOriginAndVector(this.origin, v), C_('Undo', 'Change vector parameter'));
  }
  set_and_write_new_values(new_origin: Point, new_vector: Point): void {
    this.setValues(new_origin, new_vector);
    this.param_write_to_repr(this.param_getSVGValue());
  }
  override param_transform_multiply(postmul: Affine, _set: boolean): void {
    if (!this.noTransform) {
      this.set_and_write_new_values(
        this.origin.transformed(postmul),
        this.vector.transformed(postmul.withoutTranslation()),
      );
    }
  }
  override providesKnotHolderEntities(): boolean {
    return true;
  }
  paramType(): ParamType {
    return ParamType.TRANSFORMED_POINT;
  }
}
