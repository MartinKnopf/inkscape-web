// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/point.cpp, src/live_effects/parameter/point.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import { type Affine, distance, Point } from '@inkscape-web/geom';
import { C_ } from '../../i18n.ts';
import type { SPItem } from '../../object/sp-item.ts';
import { svgPoint } from '../../svg/stringstream.ts';
import { spSvgNumberReadD } from '../../svg/svg-length.ts';
import {
  type KnotHolder,
  KnotHolderEntity,
  type KnotState,
  knot_state_ctrl,
} from '../../ui/knot/knot-holder-entity.ts';
import type { Effect } from '../effect.ts';
import { ParamType } from '../effect-enum.ts';
import { Parameter, type ParamWidget } from './parameter.ts';

/** Read "x,y" (upstream g_strsplit + sp_svg_number_read_d); null unless both numbers are read. */
function readPoint(str: string): Point | null {
  const [sx, sy] = str.split(',', 2);
  const x = spSvgNumberReadD(sx);
  const y = spSvgNumberReadD(sy);
  return x !== null && y !== null ? new Point(x, y) : null;
}

/** A point with an on-canvas knot (upstream PointParam). */
export class PointParam extends Parameter {
  #value: Point;
  defvalue: Point;
  liveupdate: boolean;
  handle_tip: string | null;
  _knot_entity: PointParamKnotHolderEntity | null = null;

  constructor(
    label: string,
    tip: string,
    key: string,
    effect: Effect,
    htip: string | null = null,
    default_value = new Point(0, 0),
    live_update = true,
  ) {
    super(label, tip, key, effect);
    this.defvalue = default_value;
    this.#value = default_value;
    this.liveupdate = live_update;
    this.handle_tip = htip;
  }

  /** The point (upstream: PointParam is a Geom::Point). */
  get value(): Point {
    return this.#value;
  }
  get x(): number {
    return this.#value.x;
  }
  get y(): number {
    return this.#value.y;
  }

  param_set_default(): void {
    this.param_setValue(this.defvalue, true);
  }
  param_set_liveupdate(live_update: boolean): void {
    this.liveupdate = live_update;
  }
  param_get_default(): Point {
    return this.defvalue;
  }
  param_update_default(default_point: Point | string): void {
    if (typeof default_point !== 'string') {
      this.defvalue = default_point;
      return;
    }
    const p = readPoint(default_point);
    if (p) this.defvalue = p;
  }
  param_hide_knot(hide: boolean): void {
    const knot = this._knot_entity?.knot;
    if (!knot || !this._knot_entity) return;
    let update = false;
    if (hide && knot.is_visible()) {
      update = true;
      knot.hide();
    } else if (!hide && !knot.is_visible()) {
      update = true;
      knot.show();
    }
    if (update) this._knot_entity.update_knot();
  }
  param_setValue(newpoint: Point, write = false): void {
    this.#value = newpoint;
    if (write) this.param_write_to_repr(svgPoint(newpoint.x, newpoint.y));
    if (this._knot_entity && this.liveupdate) this._knot_entity.update_knot();
  }
  param_readSVGValue(strvalue: string): boolean {
    const p = readPoint(strvalue);
    if (p) {
      this.param_setValue(p);
      return true;
    }
    return false;
  }
  param_getSVGValue(): string {
    return svgPoint(this.#value.x, this.#value.y);
  }
  param_getDefaultSVGValue(): string {
    return svgPoint(this.defvalue.x, this.defvalue.y);
  }
  override param_transform_multiply(postmul: Affine, _set: boolean): void {
    this.param_setValue(this.#value.transformed(postmul), true);
  }
  param_newWidget(): ParamWidget | null {
    return this.widget_is_visible ? { kind: 'point', x: this.#value.x, y: this.#value.y } : null;
  }
  param_set_from_widget(p: Point): void {
    this.param_write_from_widget(svgPoint(p.x, p.y), C_('Undo', 'Change point parameter'));
  }
  handleTip(): string {
    return this.handle_tip ?? this.param_tooltip;
  }
  override providesKnotHolderEntities(): boolean {
    return true;
  }
  override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    this._knot_entity = new PointParamKnotHolderEntity(this);
    this._knot_entity.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:Point',
      this.handleTip(),
    );
    knotholder.add(this._knot_entity);
  }
  paramType(): ParamType {
    return ParamType.POINT;
  }
  /** The effect (for the knot). */
  effect(): Effect {
    return this.param_effect;
  }
}

class PointParamKnotHolderEntity extends KnotHolderEntity {
  readonly #pparam: PointParam;

  constructor(p: PointParam) {
    super();
    this.#pparam = p;
  }

  override destroy(): void {
    super.destroy();
    this.#pparam._knot_entity = null;
  }

  knot_set(p: Point, origin: Point, state: KnotState): void {
    let s = this.snap_knot_position(p, state);
    if (knot_state_ctrl(state)) {
      const A = new Point(origin.x, p.y);
      const B = new Point(p.x, origin.y);
      const distanceA = distance(A, p);
      const distanceB = distance(B, p);
      s = distanceA > distanceB ? B : A;
    }
    if (this.#pparam.liveupdate) this.#pparam.param_setValue(s, true);
    else this.#pparam.param_setValue(s);
  }

  knot_ungrabbed(_p: Point, _origin: Point, _state: KnotState): void {
    this.#pparam.effect().makeUndoDone(C_('Undo', 'Move handle'));
  }

  knot_get(): Point {
    return this.#pparam.value;
  }

  override knot_click(state: KnotState): void {
    if (knot_state_ctrl(state) && state.altKey) {
      this.#pparam.param_set_default();
      this.#pparam.param_setValue(this.#pparam.value, true);
    }
  }
}
