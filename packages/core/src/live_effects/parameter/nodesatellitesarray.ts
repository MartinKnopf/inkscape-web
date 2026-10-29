// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/parameter/nodesatellitesarray.cpp, src/live_effects/parameter/nodesatellitesarray.h
/*
 * Author(s):
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 *
 * Copyright (C) 2014 Author(s)
 */
import {
  type Affine,
  are_near,
  BezierCurve,
  distance,
  nearest_time,
  type PathVector,
  Point,
} from '@inkscape-web/geom';
import { count_path_nodes } from '../../helper/geom.ts';
import {
  arcLengthAt,
  curveLength,
  NodeSatellite,
  NodeSatelliteType,
  timeAtArcLength,
} from '../../helper/geom-nodesatellite.ts';
import { curveOf, type PathVectorNodeSatellites } from '../../helper/geom-pathvector_nodesatellites.ts';
import { _, C_ } from '../../i18n.ts';
import type { SPItem } from '../../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../../object/sp-lpe-item.ts';
import { Preferences } from '../../preferences.ts';
import { svgNumber } from '../../svg/stringstream.ts';
import { spSvgNumberReadD } from '../../svg/svg-length.ts';
import {
  type KnotHolder,
  KnotHolderEntity,
  type KnotState,
  knot_state_ctrl,
} from '../../ui/knot/knot-holder-entity.ts';
import type { Effect } from '../effect.ts';
import { EffectType } from '../effect-enum.ts';
import { ArrayParam } from './array.ts';

/** The effect that owns the parameter (the knots set its helper path flag). */
interface FilletChamferLike extends Effect {
  helperpath: boolean;
}

function knotTip(type: NodeSatelliteType): string {
  switch (type) {
    case NodeSatelliteType.CHAMFER:
      return _(
        '<b>Chamfer</b>: <b>Ctrl+Click</b> toggles type, <b>Shift+Click</b> open dialog, <b>Ctrl+Alt+Click</b> reset',
      );
    case NodeSatelliteType.INVERSE_CHAMFER:
      return _(
        '<b>Inverse Chamfer</b>: <b>Ctrl+Click</b> toggles type, <b>Shift+Click</b> open dialog, <b>Ctrl+Alt+Click</b> reset',
      );
    case NodeSatelliteType.INVERSE_FILLET:
      return _(
        '<b>Inverse Fillet</b>: <b>Ctrl+Click</b> toggles type, <b>Shift+Click</b> open dialog, <b>Ctrl+Alt+Click</b> reset',
      );
    default:
      return _(
        '<b>Fillet</b>: <b>Ctrl+Click</b> toggles type, <b>Shift+Click</b> open dialog, <b>Ctrl+Alt+Click</b> reset',
      );
  }
}

/**
 * The corners of the Corners effect, one list per subpath (upstream NodeSatelliteArrayParam),
 * written as "F,0,0,1,0,2.5,0,1 @ F,... | ...". Each corner has a knot, and a mirror knot on
 * the incoming curve.
 */
export class NodeSatelliteArrayParam extends ArrayParam<NodeSatellite[]> {
  _last_pathvector_nodesatellites: PathVectorNodeSatellites | null = null;
  _use_distance = false;
  _global_knot_hide = false;
  _current_zoom = 0;
  _effectType = EffectType.INVALID_LPE;
  _hp: PathVector = [];

  constructor(label: string, tip: string, key: string, effect: Effect) {
    super(label, tip, key, effect, 0);
    this.param_widget_is_visible(false);
  }

  protected readsvg(str: string): NodeSatellite[] {
    const subpath_nodesatellites: NodeSatellite[] = [];
    for (const item of str.split('@')) {
      const sub = item.split(',', 8);
      if (sub.length < 8 || !sub[7]) continue; //steps always > 0
      const nodesatellite = new NodeSatellite();
      nodesatellite.setNodeSatellitesType((sub[0] as string).trim());
      nodesatellite.is_time = (sub[1] ?? '').startsWith('1');
      nodesatellite.selected = (sub[2] ?? '').startsWith('1');
      nodesatellite.has_mirror = (sub[3] ?? '').startsWith('1');
      nodesatellite.hidden = (sub[4] ?? '').startsWith('1');
      nodesatellite.amount = spSvgNumberReadD(sub[5]) ?? 0;
      nodesatellite.angle = spSvgNumberReadD(sub[6]) ?? 0;
      nodesatellite.steps = Math.trunc(spSvgNumberReadD((sub[7] as string).trim()) ?? 0);
      subpath_nodesatellites.push(nodesatellite);
    }
    return subpath_nodesatellites;
  }

  protected writesvgData(vector_data: NodeSatellite[]): string {
    // separate nodes with @ symbol ( we use | for paths)
    return vector_data
      .map(
        (s) =>
          `${s.getNodeSatellitesTypeGchar()},${s.is_time ? 1 : 0},${s.selected ? 1 : 0},${s.has_mirror ? 1 : 0},${s.hidden ? 1 : 0},${svgNumber(s.amount)},${svgNumber(s.angle)},${Math.trunc(s.steps)}`,
      )
      .join(' @ ');
  }

  protected defaultValue(): NodeSatellite[] {
    return [];
  }

  setPathVectorNodeSatellites(pathVectorNodeSatellites: PathVectorNodeSatellites, write = true): void {
    this._last_pathvector_nodesatellites = pathVectorNodeSatellites;
    if (write) this.param_set_and_write_new_value(pathVectorNodeSatellites.getNodeSatellites());
    else this.param_setValue(pathVectorNodeSatellites.getNodeSatellites());
  }

  /** Rebuild the knots (upstream: the shape editors of the node tool reset their item). */
  reloadKnots(): void {
    this.onReloadKnots?.();
  }
  /** Set by the editor to rebuild the knot holders (upstream reloadKnots() finds the node tool). */
  onReloadKnots: (() => void) | null = null;

  setUseDistance(use_knot_distance: boolean): void {
    this._use_distance = use_knot_distance;
  }
  setCurrentZoom(current_zoom: number): void {
    this._current_zoom = current_zoom;
  }
  setGlobalKnotHide(global_knot_hide: boolean): void {
    this._global_knot_hide = global_knot_hide;
  }
  setEffectType(et: EffectType): void {
    this._effectType = et;
  }

  override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this._hp);
  }

  override param_transform_multiply(postmul: Affine, _set: boolean): void {
    if (Preferences.get().getBool('/options/transform/rectcorners', true)) {
      for (const i of this._vector) {
        for (const j of i) {
          if (!j.is_time && j.amount > 0)
            j.amount = j.amount * ((postmul.expansionX() + postmul.expansionY()) / 2);
        }
      }
      this.param_set_and_write_new_value(this._vector);
    }
  }

  override providesKnotHolderEntities(): boolean {
    return true;
  }

  override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem, mirror = true): void {
    const last = this._last_pathvector_nodesatellites;
    if (!last) return;
    let index = 0;
    this._vector.forEach((sats, i) => {
      sats.forEach((sat, j) => {
        if (!sat.has_mirror && mirror) return;
        if (mirror && i === 0 && j === 0) index += last.getTotalNodeSatellites();
        if (this._effectType === EffectType.FILLET_CHAMFER) {
          const e = new FilletChamferKnotHolderEntity(this, index);
          e.create(
            null,
            item,
            knotholder,
            'CANVAS_ITEM_CTRL_TYPE_LPE',
            'LPE:Chamfer',
            knotTip(sat.nodesatellite_type),
          );
          knotholder.add(e);
        }
        index++;
      });
    });
    if (mirror) this.addKnotHolderEntities(knotholder, item, false);
  }

  updateAmmount(amount: number): void {
    const last = this._last_pathvector_nodesatellites;
    if (!last) return;
    const pathv = last.getPathVector();
    const nodesatellites = last.getNodeSatellites();
    for (let i = 0; i < nodesatellites.length; ++i) {
      for (let j = 0; j < (nodesatellites[i] as NodeSatellite[]).length; ++j) {
        const sat = this._vector[i]?.[j];
        if (!sat) continue;
        const curve_in = curveOf(pathv[i] ?? pathv[0]!, j);
        if (this.param_effect.isNodePointSelected(curve_in.initialPoint())) {
          sat.amount = amount;
          sat.setSelected(true);
        } else {
          sat.setSelected(false);
        }
      }
    }
  }

  /** The effect of the parameter (for the knots). */
  effect(): FilletChamferLike {
    return this.param_effect as FilletChamferLike;
  }
}

const INF_POINT = new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

/**
 * The knot of a corner (upstream FilletChamferKnotHolderEntity). Its index counts the corners;
 * indexes from the total count on are the mirror knots on the incoming curves.
 * TODO: the knot shape and angle, Shift+Click (the Fillet/Chamfer properties dialog).
 */
class FilletChamferKnotHolderEntity extends KnotHolderEntity {
  readonly #pparam: NodeSatelliteArrayParam;
  readonly #index: number;
  #updating = false;
  #set_circle = false;

  constructor(p: NodeSatelliteArrayParam, index: number) {
    super();
    this.#pparam = p;
    this.#index = index;
  }

  #valid_index(i: number, j: number): boolean {
    return (this.#pparam._vector[i]?.length ?? 0) > j;
  }

  /** [path index, node index, is mirror] of this knot, or null. */
  #location(): [number, number, boolean] | null {
    const last = this.#pparam._last_pathvector_nodesatellites;
    if (!last || this.#pparam._global_knot_hide) return null;
    const total = last.getTotalNodeSatellites();
    let index = this.#index;
    let is_mirror = false;
    if (index >= total) {
      index -= total;
      is_mirror = true;
    }
    const [i, j] = last.getIndexData(index);
    return this.#valid_index(i, j) ? [i, j, is_mirror] : null;
  }

  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const loc = this.#location();
    const last = this.#pparam._last_pathvector_nodesatellites;
    if (!loc || !last) return;
    const [satelite_index, subsatelite_index, is_mirror] = loc;
    const s = p;
    const nodesatellite = (
      (this.#pparam._vector[satelite_index] as NodeSatellite[])[subsatelite_index] as NodeSatellite
    ).clone();
    const pathv = last.getPathVector();
    const path = pathv[satelite_index];
    if (!path) return;
    if (
      nodesatellite.hidden ||
      (!path.closed() && (subsatelite_index === 0 || count_path_nodes(path) - 1 === subsatelite_index))
    ) {
      return;
    }
    let previous_index = subsatelite_index - 1;
    if (subsatelite_index === 0 && path.closed()) previous_index = count_path_nodes(path) - 1;
    if (previous_index < 0) return;
    const curve_in = curveOf(path, previous_index);
    const curve_out = curveOf(path, subsatelite_index);
    let mirror_time = curve_in instanceof BezierCurve ? nearest_time(s, curve_in) : 0;
    const mirror = curve_in.pointAt(mirror_time);
    const normal_time = curve_out instanceof BezierCurve ? nearest_time(s, curve_out) : 0;
    const normal = curve_out.pointAt(normal_time);
    const distance_mirror = distance(mirror, s);
    const distance_normal = distance(normal, s);
    if (
      (normal_time === 0 && !is_mirror) ||
      (mirror_time === 1 && is_mirror) ||
      are_near(s, curve_out.initialPoint(), 1.5 / this.#pparam._current_zoom)
    ) {
      nodesatellite.amount = 0;
    } else if (distance_mirror < distance_normal) {
      const nodesatellites = last.getNodeSatellites();
      const time_start = (
        (nodesatellites[satelite_index] as NodeSatellite[])[previous_index] as NodeSatellite
      ).time(curve_in);
      if (time_start > mirror_time) mirror_time = time_start;
      const size = arcLengthAt(mirror_time, curve_in);
      let amount = curveLength(curve_in) - size;
      if (nodesatellite.is_time) amount = timeAtArcLength(amount, curve_out);
      if (this.#set_circle && time_start < 0.1001) return;
      nodesatellite.amount = amount;
    } else {
      nodesatellite.setPosition(s, curve_out);
    }
    this.#pparam.effect().helperpath = true;
    this.#pparam.updateAmmount(nodesatellite.amount);
    (this.#pparam._vector[satelite_index] as NodeSatellite[])[subsatelite_index] = nodesatellite;
    if (!this.#updating) {
      const b = this.knot_get();
      const a = this.snap_knot_position(b, state);
      if (!are_near(b, a, 0.001)) {
        this.#updating = true;
        this.knot_set(a, new Point(0, 0), state);
        this.knot_get();
        this.#updating = false;
      }
    }
    if (this.item && 'path_effect_list' in this.item) {
      sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, false);
    }
  }

  knot_ungrabbed(_p: Point, _origin: Point, _state: KnotState): void {
    if (!this.#pparam._last_pathvector_nodesatellites || this.#pparam._global_knot_hide) return;
    const effect = this.#pparam.effect();
    effect.helperpath = false;
    effect.makeUndoDone(C_('Undo', 'Move handle'));
  }

  knot_get(): Point {
    const loc = this.#location();
    const last = this.#pparam._last_pathvector_nodesatellites;
    if (!loc || !last) return INF_POINT;
    const [satelite_index, subsatelite_index, is_mirror] = loc;
    const nodesatellite = (this.#pparam._vector[satelite_index] as NodeSatellite[])[
      subsatelite_index
    ] as NodeSatellite;
    const pathv = last.getPathVector();
    const path = pathv[satelite_index];
    if (!path) return INF_POINT;
    if (
      nodesatellite.hidden ||
      (!path.closed() && (subsatelite_index === 0 || subsatelite_index === count_path_nodes(path) - 1))
    ) {
      return INF_POINT; // ignore first and last nodesatellites on open paths
    }
    let previous_index = subsatelite_index - 1;
    if (subsatelite_index === 0 && path.closed()) previous_index = count_path_nodes(path) - 1;
    if (previous_index < 0 || subsatelite_index > path.sizeOpen()) return INF_POINT;
    const ssat_path = curveOf(path, subsatelite_index);
    const curve_in = curveOf(path, previous_index);
    const s = nodesatellite.arcDistance(ssat_path);
    if (are_near(curveLength(ssat_path), 0, 0.5) || are_near(curveLength(curve_in), 0, 0.5)) return INF_POINT;
    let t = nodesatellite.timeAt(s, true, curve_in);
    if (t > 1) t = 1;
    if (t < 0) t = 0;
    const time_start = (
      (last.getNodeSatellites()[satelite_index] as NodeSatellite[])[previous_index] as NodeSatellite
    ).time(curve_in);
    if (time_start > t) t = time_start;
    const other = curve_in.pointAt(t);
    let tmp_point = nodesatellite.getPosition(ssat_path);
    const contracted = ssat_path.pointAt(0.1);
    if (is_mirror) tmp_point = other;
    this.knot?.show();
    if (nodesatellite.amount === 0) {
      if (is_mirror) {
        this.knot?.hide();
      } else {
        tmp_point = contracted;
        this.#set_circle = true;
      }
    }
    const zoom = this.#pparam._current_zoom;
    if (
      zoom &&
      (are_near(ssat_path.pointAt(0), ssat_path.pointAt(0.1), 0.5 / zoom) ||
        are_near(curve_in.pointAt(0), curve_in.pointAt(0.1), 0.5 / zoom))
    ) {
      this.knot?.hide();
    }
    return tmp_point;
  }

  override knot_click(state: KnotState): void {
    const loc = this.#location();
    const last = this.#pparam._last_pathvector_nodesatellites;
    if (!loc || !last) return;
    const [i, j] = loc;
    const path = last.getPathVector()[i];
    if (!path) return;
    if (!path.closed() && (j === 0 || count_path_nodes(path) - 1 === j)) return; // ignore last nodesatellite in open paths
    const sat = this.#pparam._vector[i]?.[j] as NodeSatellite;
    if (!knot_state_ctrl(state)) return; // TODO: Shift+Click opens the Fillet/Chamfer properties dialog.
    if (state.altKey) {
      sat.amount = 0.0;
    } else {
      switch (sat.nodesatellite_type) {
        case NodeSatelliteType.FILLET:
          sat.nodesatellite_type = NodeSatelliteType.INVERSE_FILLET;
          break;
        case NodeSatelliteType.INVERSE_FILLET:
          sat.nodesatellite_type = NodeSatelliteType.CHAMFER;
          break;
        case NodeSatelliteType.CHAMFER:
          sat.nodesatellite_type = NodeSatelliteType.INVERSE_CHAMFER;
          break;
        default:
          sat.nodesatellite_type = NodeSatelliteType.FILLET;
          break;
      }
      this.knot?.show();
    }
    if (this.item && 'path_effect_list' in this.item) {
      sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, false);
    }
  }
}
