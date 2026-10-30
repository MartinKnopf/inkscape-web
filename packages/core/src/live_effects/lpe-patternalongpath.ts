// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-patternalongpath.cpp, src/live_effects/lpe-patternalongpath.h
/*
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 */
import {
  type Affine,
  CubicBezier,
  distance,
  dot,
  LineSegment,
  Path,
  type PathVector,
  Point,
  PathVector as PV,
  rad_from_deg,
  write_svg_path,
} from '@inkscape-web/geom';
import { _, N_ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { SPShape } from '../object/sp-shape.ts';
import { pathBoolopBackend } from '../path/path-boolop.ts';
import { Preferences } from '../preferences.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { PathParam } from './parameter/path.ts';

export enum PAPCopyType {
  PAPCT_SINGLE = 0,
  PAPCT_SINGLE_STRETCHED,
  PAPCT_REPEATED,
  PAPCT_REPEATED_STRETCHED,
  PAPCT_END, // This must be last
}

const PAPCopyTypeConverter = new EnumDataConverter<PAPCopyType>(
  [
    { id: PAPCopyType.PAPCT_SINGLE, label: N_('Single'), key: 'single' },
    { id: PAPCopyType.PAPCT_SINGLE_STRETCHED, label: N_('Single, stretched'), key: 'single_stretched' },
    { id: PAPCopyType.PAPCT_REPEATED, label: N_('Repeated'), key: 'repeated' },
    { id: PAPCopyType.PAPCT_REPEATED_STRETCHED, label: N_('Repeated, stretched'), key: 'repeated_stretched' },
  ],
  PAPCopyType.PAPCT_END,
);

/**
 * Pattern Along Path (upstream LPEPatternAlongPath): places copies of the pattern path along the
 * item's path. The 2geom part (doEffect_pwd2) runs in WASM.
 */
export class LPEPatternAlongPath extends Effect {
  readonly pattern: PathParam;
  original_height = 0.0;
  readonly prop_scale: ScalarParam;
  readonly copytype: EnumParam<PAPCopyType>;
  readonly scale_y_rel: BoolParam;
  readonly spacing: ScalarParam;
  readonly normal_offset: ScalarParam;
  readonly tang_offset: ScalarParam;
  readonly prop_units: BoolParam;
  readonly vertical_pattern: BoolParam;
  readonly hide_knot: BoolParam;
  readonly fuse_tolerance: ScalarParam;
  helper_path: PathVector = [];
  _knot_entity: KnotHolderEntityWidthPatternAlongPath | null = null;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.pattern = new PathParam(
      _('Pattern source:'),
      _('Path to put along the skeleton path'),
      'pattern',
      this,
      'M0,0 L1,0',
    );
    this.prop_scale = new ScalarParam(_('_Width:'), _('Width of the pattern'), 'prop_scale', this, 1.0);
    this.copytype = new EnumParam(
      _('Pattern copies:'),
      _('How many pattern copies to place along the skeleton path'),
      'copytype',
      PAPCopyTypeConverter,
      this,
      PAPCopyType.PAPCT_SINGLE_STRETCHED,
    );
    this.scale_y_rel = new BoolParam(
      _('Wid_th in units of length'),
      _('Scale the width of the pattern in units of its length'),
      'scale_y_rel',
      this,
      false,
    );
    this.spacing = new ScalarParam(
      _('Spa_cing:'),
      _(
        'Space between copies of the pattern. Negative values allowed, but are limited to -90% of pattern width.',
      ),
      'spacing',
      this,
      0,
    );
    this.normal_offset = new ScalarParam(_('No_rmal offset:'), '', 'normal_offset', this, 0);
    this.tang_offset = new ScalarParam(_('Tan_gential offset:'), '', 'tang_offset', this, 0);
    this.prop_units = new BoolParam(
      _('Offsets in _unit of pattern size'),
      _('Spacing, tangential and normal offset are expressed as a ratio of width/height'),
      'prop_units',
      this,
      false,
    );
    this.vertical_pattern = new BoolParam(
      _('Pattern is _vertical'),
      _('Rotate pattern 90 deg before applying'),
      'vertical_pattern',
      this,
      false,
    );
    this.hide_knot = new BoolParam(_('Hide width knot'), _('Hide width knot'), 'hide_knot', this, false);
    this.fuse_tolerance = new ScalarParam(
      _('_Fuse nearby ends:'),
      _("Fuse ends closer than this number. 0 means don't fuse."),
      'fuse_tolerance',
      this,
      0,
    );
    this.registerParameter(this.pattern);
    this.registerParameter(this.copytype);
    this.registerParameter(this.prop_scale);
    this.registerParameter(this.scale_y_rel);
    this.registerParameter(this.spacing);
    this.registerParameter(this.normal_offset);
    this.registerParameter(this.tang_offset);
    this.registerParameter(this.prop_units);
    this.registerParameter(this.vertical_pattern);
    this.registerParameter(this.hide_knot);
    this.registerParameter(this.fuse_tolerance);
    this.prop_scale.param_set_digits(3);
    this.prop_scale.param_set_increments(0.01, 0.1);
    this._provides_knotholder_entities = true;
  }

  protected override doOnOpen(_lpeitem: SPLPEItem): boolean {
    if (!this.is_load || this.is_applied) return false;
    this.pattern.reload();
    return false;
  }

  protected override transform_multiply(postmul: Affine, _set: boolean): void {
    if (this.sp_lpe_item?.pathEffectsEnabled() && this.sp_lpe_item.optimizeTransforms()) {
      this.pattern.param_transform_multiply(postmul, false);
    }
  }

  protected override doBeforeEffect(_lpeitem: SPLPEItem): void {
    const bbox = PV.boundsFast(this.pattern.get_pathvector());
    if (bbox) this.original_height = bbox.yInterval.max() - bbox.yInterval.min();
    if (this.is_load) this.pattern.reload();
    const knot = this._knot_entity?.knot;
    if (knot && this._knot_entity) {
      if (this.hide_knot.get_value()) {
        this.helper_path = [];
        knot.hide();
      } else {
        knot.show();
      }
      this._knot_entity.update_knot();
    }
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const pattern = this.pattern.get_pathvector();
    if (pattern.length === 0) return path_in;
    const affine = this.pattern.get_relative_affine();
    const d = pathBoolopBackend().patternAlongPath(
      write_svg_path(path_in),
      write_svg_path(pattern.map((p) => p.transformed(affine))),
      {
        copytype: this.copytype.get_value(),
        spacing: this.spacing.get_value(),
        normal_offset: this.normal_offset.get_value(),
        tang_offset: this.tang_offset.get_value(),
        prop_units: this.prop_units.get_value(),
        vertical_pattern: this.vertical_pattern.get_value(),
        prop_scale: this.prop_scale.get_value(),
        scale_y_rel: this.scale_y_rel.get_value(),
        fuse_tolerance: this.fuse_tolerance.get_value(),
      },
    );
    return sp_svg_read_pathv(d);
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.push(this.helper_path);
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    const knot_entity = new KnotHolderEntityWidthPatternAlongPath(this);
    this._knot_entity = knot_entity;
    knot_entity.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:PatternAlongPath',
      _('Change the width'),
    );
    knotholder.add(knot_entity);
    if (this.hide_knot.get_value()) {
      knot_entity.knot?.hide();
      knot_entity.update_knot();
    }
  }
}

/** The start of the path and the direction of its normal (shared by knot_get and knot_set). */
function startRay(item: SPItem | null): { ptA: Point; angle: number } | null {
  if (!(item instanceof SPShape)) return null;
  const path_in = item.curveForEdit()?.[0];
  if (!path_in || path_in.empty()) {
    // Path::pointAt would have thrown an exception
    console.warn('PatternAlongPath::knot_set: path is empty!');
    return null;
  }
  const ptA = path_in.pointAt(0);
  const first_curve = path_in.at(0);
  const B = path_in.pointAt(1);
  const dir = first_curve instanceof CubicBezier ? first_curve.controlPoint(1).sub(ptA) : B.sub(ptA);
  return { ptA, angle: Math.atan2(dir.y, dir.x) + rad_from_deg(90) };
}

class KnotHolderEntityWidthPatternAlongPath extends LPEKnotHolderEntity<LPEPatternAlongPath> {
  override destroy(): void {
    super.destroy();
    this._effect._knot_entity = null;
  }

  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    const ray = startRay(this.item);
    if (ray && this._effect.original_height && this.knot && this.item) {
      const { ptA, angle } = ray;
      const knot_pos = this.knot.pos.transformed(this.item.i2dtAffine().inverse());
      // Geom::Ray::nearestTime is 0 when the point is behind the start of the ray
      const nearest_to_ray = Math.max(0, dot(knot_pos.sub(ptA), Point.polar(angle)));
      const half = this._effect.original_height / 2.0;
      this._effect.prop_scale.param_set_value((nearest_to_ray === 0 ? -1 : 1) * (distance(s, ptA) / half));
    }
    if (this.item instanceof SPShape) {
      if (!this._effect.original_height) this._effect.prop_scale.param_set_value(0);
      Preferences.get().setDouble('/live_effects/skeletal/width', this._effect.prop_scale.get_value());
    }
    if (this.item && 'path_effect_list' in this.item) {
      sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, true);
    }
  }

  knot_get(): Point {
    const ray = startRay(this.item);
    if (!ray) return new Point(0, 0);
    const { ptA, angle } = ray;
    const result_point = Point.polar(
      angle,
      (this._effect.original_height / 2.0) * this._effect.prop_scale.get_value(),
    ).add(ptA);
    this._effect.helper_path = [];
    if (!this._effect.hide_knot.get_value()) {
      const hp = new Path(result_point);
      hp.appendCurve(new LineSegment(result_point, ptA));
      this._effect.helper_path.push(hp);
    }
    return result_point;
  }
}
