// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/vector.cpp, src/live_effects/parameter/vector.h
/*
 * Copyright (C) Johan Engelen 2008 <j.b.c.engelen@utwente.nl>
 */
import { type Affine, Point } from '@inkscape-web/geom';
import { C_ } from '../../i18n.ts';
import type { SPItem } from '../../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../../object/sp-lpe-item.ts';
import { svgNumber, svgPoint } from '../../svg/stringstream.ts';
import { spSvgNumberReadD } from '../../svg/svg-length.ts';
import { type KnotHolder, KnotHolderEntity, type KnotState } from '../../ui/knot/knot-holder-entity.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** Read "ox,oy,vx,vy" (upstream g_strsplit + sp_svg_number_read_d); null unless all 4 numbers are read. */
export function readOriginAndVector(str: string): [Point, Point] | null {
  const val: number[] = [];
  for (const s of str.split(',', 4)) {
    const v = spSvgNumberReadD(s);
    if (v === null) break;
    val.push(v);
  }
  if (val.length !== 4) return null;
  return [new Point(val[0] as number, val[1] as number), new Point(val[2] as number, val[3] as number)];
}

/** Read "x,y"; null unless both numbers are read. */
export function readPointValue(str: string): Point | null {
  const [sx, sy] = str.split(',', 2);
  const x = spSvgNumberReadD(sx);
  const y = spSvgNumberReadD(sy);
  return x !== null && y !== null ? new Point(x, y) : null;
}

/** Upstream `os << origin << " , " << vector` with SVGOStringStream. */
export function writeOriginAndVector(origin: Point, vector: Point): string {
  return `${svgNumber(origin.x)},${svgNumber(origin.y)} , ${svgNumber(vector.x)},${svgNumber(vector.y)}`;
}

/**
 * A vector with an origin, both with an on-canvas knot (upstream VectorParam). Written as
 * "ox,oy , vx,vy".
 */
export class VectorParam extends Parameter {
  defvalue: Point;
  origin = new Point(0, 0);
  vector: Point;

  constructor(label: string, tip: string, key: string, effect: Effect, default_vector = new Point(1, 0)) {
    super(label, tip, key, effect);
    this.defvalue = default_vector;
    this.vector = default_vector;
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
  handleTip(): string {
    return this.param_tooltip;
  }

  param_set_default(): void {
    this.setOrigin(new Point(0, 0));
    this.setVector(this.defvalue);
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
    this.set_and_write_new_values(
      this.origin.transformed(postmul),
      this.vector.transformed(postmul.withoutTranslation()),
    );
  }
  override providesKnotHolderEntities(): boolean {
    return true;
  }
  override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    const origin_e = new VectorParamKnotHolderEntity_Origin(this);
    origin_e.create(null, item, knotholder, 'CANVAS_ITEM_CTRL_TYPE_LPE', 'LPE:Origin', this.handleTip());
    knotholder.add(origin_e);
    const vector_e = new VectorParamKnotHolderEntity_Vector(this);
    vector_e.create(null, item, knotholder, 'CANVAS_ITEM_CTRL_TYPE_LPE', 'LPE:Vector', this.handleTip());
    knotholder.add(vector_e);
  }
  paramType(): ParamType {
    return ParamType.VECTOR;
  }
  effect(): Effect {
    return this.param_effect;
  }
}

function updateItem(item: SPItem | null): void {
  if (item && 'path_effect_list' in item) sp_lpe_item_update_patheffect(item as SPLPEItem, false, false);
}

class VectorParamKnotHolderEntity_Origin extends KnotHolderEntity {
  constructor(readonly param: VectorParam) {
    super();
  }
  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    this.param.setOrigin(s);
    this.param.set_and_write_new_values(this.param.origin, this.param.vector);
    updateItem(this.item);
  }
  knot_get(): Point {
    return this.param.origin;
  }
  knot_ungrabbed(_p: Point, _origin: Point, _state: KnotState): void {
    this.param.effect().makeUndoDone(C_('Undo', 'Move handle'));
  }
}

class VectorParamKnotHolderEntity_Vector extends KnotHolderEntity {
  constructor(readonly param: VectorParam) {
    super();
  }
  knot_set(p: Point, _origin: Point, _state: KnotState): void {
    const s = p.sub(this.param.origin);
    /// @todo implement angle snapping when holding CTRL
    this.param.setVector(s);
    this.param.set_and_write_new_values(this.param.origin, this.param.vector);
    updateItem(this.item);
  }
  knot_get(): Point {
    return this.param.origin.add(this.param.vector);
  }
  knot_ungrabbed(_p: Point, _origin: Point, _state: KnotState): void {
    this.param.effect().makeUndoDone(C_('Undo', 'Move handle'));
  }
}
