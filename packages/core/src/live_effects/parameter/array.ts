// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/array.cpp, src/live_effects/parameter/array.h
/*
 * Copyright (C) Johan Engelen 2008 <j.b.c.engelen@utwente.nl>
 */
import { Point } from '@inkscape-web/geom';
import { svgNumber, svgPoint } from '../../svg/stringstream.ts';
import { spSvgNumberReadD } from '../../svg/svg-length.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/**
 * A list of values written as "a | b | c" (upstream ArrayParam<StorageType>). Subclasses give
 * readsvg() and writesvgData() for their type.
 */
export abstract class ArrayParam<T> extends Parameter {
  _vector: T[] = [];
  protected _default_size: number;

  constructor(label: string, tip: string, key: string, effect: Effect, n = 0) {
    super(label, tip, key, effect);
    this._default_size = n;
  }

  protected abstract readsvg(str: string): T;
  protected abstract writesvgData(data: T): string;
  /** The value of a new element (upstream StorageType()). */
  protected abstract defaultValue(): T;

  data(): readonly T[] {
    return this._vector;
  }
  param_newWidget(): ParamWidget | null {
    return null;
  }
  param_readSVGValue(strvalue: string): boolean {
    // (upstream g_strsplit gives no element for an empty string)
    this._vector = strvalue === '' ? [] : strvalue.split('|').map((s) => this.readsvg(s.trim()));
    return true;
  }
  param_update_default(_default_value: string): void {}
  param_getSVGValue(): string {
    return this.writesvg(this._vector);
  }
  param_getDefaultSVGValue(): string {
    return '';
  }
  param_setValue(new_vector: T[]): void {
    this._vector = new_vector;
  }
  param_set_default(): void {
    this.param_setValue(Array.from({ length: this._default_size }, () => this.defaultValue()));
  }
  param_set_and_write_new_value(new_vector: T[]): void {
    this.param_write_to_repr(this.writesvg(new_vector));
  }
  paramType(): ParamType {
    return ParamType.ARRAY;
  }
  valid_index(index: number): boolean {
    return this._vector.length > index;
  }
  protected writesvg(vector: readonly T[]): string {
    // separate items with pipe symbol
    return vector.map((v) => this.writesvgData(v)).join(' | ');
  }
}

/** An array of numbers (upstream ArrayParam<double>). */
export class ScalarArrayParamBase extends ArrayParam<number> {
  protected readsvg(str: string): number {
    return spSvgNumberReadD(str) ?? Number.POSITIVE_INFINITY;
  }
  protected writesvgData(data: number): string {
    return svgNumber(data);
  }
  protected defaultValue(): number {
    return 0;
  }
}

/** An array of points (upstream ArrayParam<Geom::Point>). */
export class PointArrayParam extends ArrayParam<Point> {
  protected readsvg(str: string): Point {
    const [sx, sy] = str.split(',', 2);
    const x = spSvgNumberReadD(sx);
    const y = spSvgNumberReadD(sy);
    return x !== null && y !== null
      ? new Point(x, y)
      : new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  }
  protected writesvgData(data: Point): string {
    return svgPoint(data.x, data.y);
  }
  protected defaultValue(): Point {
    return new Point(0, 0);
  }
}

/** An array of strings (upstream ArrayParam<Glib::ustring>). */
export class StringArrayParam extends ArrayParam<string> {
  protected readsvg(str: string): string {
    return str;
  }
  protected writesvgData(data: string): string {
    return data;
  }
  protected defaultValue(): string {
    return '';
  }
}
