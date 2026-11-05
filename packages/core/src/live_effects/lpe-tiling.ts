// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-tiling.cpp, src/live_effects/lpe-tiling.h
/** \file
 * LPE <tiling> implementation
 */
/*
 * Authors:
 *   Jabiertxo Arraiza Cenoz <jabier.arraiza@marker.es>
 *   Adam Belis <>
 * Copyright (C) Authors 2022-2022
 */
import {
  Affine,
  type OptRect,
  Path,
  type PathVector,
  Point,
  PathVector as PV,
  Rect,
  Rotate,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _ } from '../i18n.ts';
import type { SPItem } from '../object/sp-item.ts';
import { type SPLPEItem, sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { FillRule } from '../path/path-boolop.ts';
import { SPWindRule } from '../style-enums.ts';
import { sp_svg_transform_read, sp_svg_transform_write } from '../svg/svg-affine.ts';
import { convertUnit, svgLengthUnitAbbr } from '../svg/svg-length.ts';
import { type KnotHolder, type KnotState, LPEKnotHolderEntity } from '../ui/knot/knot-holder-entity.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { HiddenParam } from './parameter/hidden.ts';
import { ScalarParam } from './parameter/parameter.ts';
import { RandomParam } from './parameter/random.ts';
import { UnitParam } from './parameter/unit.ts';

/* RNG of RandomParam (random.cpp) */
const RAND_m = 2147483647;
const RAND_a = 16807;
const RAND_q = 127773;
const RAND_r = 2836;
const BSize = 0x100;

/** RandomParam with upstream param_get_random_number(): the next number of the sequence in [0, 1). */
class TilingRandomParam extends RandomParam {
  param_get_random_number(): number {
    let result = RAND_a * (this.seed % RAND_q) - RAND_r * Math.trunc(this.seed / RAND_q);
    if (result <= 0) result += RAND_m;
    this.seed = result;
    return (result % BSize) / BSize;
  }
}

const NO_POINT = () => new Point(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

/** Upstream: rect *= affine (the bounding box of the transformed corners). */
const rectTransformed = (r: Rect, m: Affine): Rect => r.transformed(m);

/** Scale r by s around its midpoint. */
const scaledAroundMid = (r: Rect, s: number): Rect => {
  const mid = r.midpoint();
  return rectTransformed(r, Translate(mid.neg()).multiply(Scale(s, s)).multiply(Translate(mid)));
};

/**
 * Tiling (upstream LPETiling): copies of the item in rows and columns, with gaps, offsets,
 * mirroring and (interpolated or random) scale and rotation.
 * TODO: split elements (each copy as a separate satellite object, lpesatellites).
 */
export class LPETiling extends GroupBBoxEffect {
  readonly unit: UnitParam;
  readonly gapx: ScalarParam;
  readonly gapy: ScalarParam;
  readonly num_rows: ScalarParam;
  readonly num_cols: ScalarParam;
  readonly rotate: ScalarParam;
  readonly scale: ScalarParam;
  readonly offset: ScalarParam;
  readonly offset_type: BoolParam;
  readonly random_scale: BoolParam;
  readonly random_rotate: BoolParam;
  readonly random_gap_x: BoolParam;
  readonly random_gap_y: BoolParam;
  readonly seed: TilingRandomParam;
  readonly interpolate_scalex: BoolParam;
  readonly interpolate_rotatex: BoolParam;
  readonly interpolate_scaley: BoolParam;
  readonly interpolate_rotatey: BoolParam;
  readonly mirrorrowsx: BoolParam;
  readonly mirrorrowsy: BoolParam;
  readonly mirrorcolsx: BoolParam;
  readonly mirrorcolsy: BoolParam;
  readonly mirrortrans: BoolParam;
  readonly split_items: BoolParam;
  readonly link_styles: BoolParam;
  readonly shrink_interp: BoolParam;
  readonly transformorigin: HiddenParam;

  gapx_unit = 0;
  gapy_unit = 0;
  original_width = 0;
  original_height = 0;
  gap_bbox: OptRect = null;
  originalbbox: OptRect = null;
  scaleok = 1.0;
  legacy = false;
  transformoriginal = Affine.identity();
  _knotholder: KnotHolder | null = null;
  private display_unit: string;
  private prev_unit = '';
  private random_x: number[] = [];
  private random_y: number[] = [];
  private random_s: number[] = [];
  private random_r: number[] = [];
  // used by the split mode (TODO), as originatrans
  private affinebase = Affine.identity();
  private hideaffine = Affine.identity();

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    // do not change name of this parameter is used in oncommit
    this.unit = new UnitParam(_('Unit:'), _('Unit'), 'unit', this, 'px');
    this.num_cols = new ScalarParam(_('Columns'), _('Number of columns'), 'num_cols', this, 3);
    this.num_rows = new ScalarParam(_('Rows'), _('Number of rows'), 'num_rows', this, 3);
    this.gapx = new ScalarParam(
      _('Gap X'),
      _('Horizontal gap between tiles (uses selected unit)'),
      'gapx',
      this,
      0.0,
    );
    this.gapy = new ScalarParam(
      _('Gap Y'),
      _('Vertical gap between tiles (uses selected unit)'),
      'gapy',
      this,
      0.0,
    );
    this.scale = new ScalarParam(_('Scale %'), _('Scale tiles by this percentage'), 'scale', this, 0.0);
    this.rotate = new ScalarParam(
      _('Rotate °'),
      _('Rotate tiles by this amount of degrees'),
      'rotate',
      this,
      0.0,
    );
    this.offset = new ScalarParam(
      _('Offset %'),
      _('Offset tiles by this percentage of width/height'),
      'offset',
      this,
      0.0,
    );
    this.offset_type = new BoolParam(
      _('Offset type'),
      _('Choose whether to offset rows or columns'),
      'offset_type',
      this,
      false,
    );
    this.interpolate_scalex = new BoolParam(
      _('Interpolate scale X'),
      _('Interpolate tile size in each row'),
      'interpolate_scalex',
      this,
      false,
    );
    this.interpolate_scaley = new BoolParam(
      _('Interpolate scale Y'),
      _('Interpolate tile size in each column'),
      'interpolate_scaley',
      this,
      true,
    );
    this.shrink_interp = new BoolParam(
      _('Minimize gaps'),
      _('Minimize gaps between scaled objects (does not work with rotation/diagonal mode)'),
      'shrink_interp',
      this,
      false,
    );
    this.interpolate_rotatex = new BoolParam(
      _('Interpolate rotation X'),
      _('Interpolate tile rotation in row'),
      'interpolate_rotatex',
      this,
      false,
    );
    this.interpolate_rotatey = new BoolParam(
      _('Interpolate rotation Y'),
      _('Interpolate tile rotation in column'),
      'interpolate_rotatey',
      this,
      true,
    );
    this.split_items = new BoolParam(
      _('Split elements'),
      _('Split elements, so they can be selected, styled, and moved (if grouped) independently'),
      'split_items',
      this,
      false,
    );
    this.mirrorrowsx = new BoolParam(
      _('Mirror rows in X'),
      _('Mirror rows horizontally'),
      'mirrorrowsx',
      this,
    );
    this.mirrorrowsy = new BoolParam(_('Mirror rows in Y'), _('Mirror rows vertically'), 'mirrorrowsy', this);
    this.mirrorcolsx = new BoolParam(
      _('Mirror cols in X'),
      _('Mirror columns horizontally'),
      'mirrorcolsx',
      this,
    );
    this.mirrorcolsy = new BoolParam(
      _('Mirror cols in Y'),
      _('Mirror columns vertically'),
      'mirrorcolsy',
      this,
    );
    this.mirrortrans = new BoolParam(
      _('Mirror transforms'),
      _('Mirror transformations'),
      'mirrortrans',
      this,
    );
    this.link_styles = new BoolParam(
      _('Link styles'),
      _('Link styles in split mode, can also be used to reset style of copies'),
      'link_styles',
      this,
      false,
    );
    this.random_gap_x = new BoolParam(
      _('Random gaps X'),
      _('Randomize horizontal gaps'),
      'random_gap_x',
      this,
    );
    this.random_gap_y = new BoolParam(_('Random gaps Y'), _('Randomize vertical gaps'), 'random_gap_y', this);
    this.random_rotate = new BoolParam(
      _('Random rotation'),
      _('Randomize tile rotation'),
      'random_rotate',
      this,
    );
    this.random_scale = new BoolParam(_('Random scale'), _('Randomize scale'), 'random_scale', this);
    this.seed = new TilingRandomParam(_('Seed'), _('Randomization seed'), 'seed', this, 1);
    this.transformorigin = new HiddenParam(
      'transformorigin:',
      'transformorigin',
      'transformorigin',
      this,
      '',
      true,
    );
    this.show_orig_path = true;
    this._provides_knotholder_entities = true;

    // register all your parameters here, so Inkscape knows which parameters this effect has:
    // please intense work on this widget and is important reorder parameters very carefully
    this.registerParameter(this.unit);
    this.registerParameter(this.seed);
    this.registerParameter(this.num_rows);
    this.registerParameter(this.num_cols);
    this.registerParameter(this.gapx);
    this.registerParameter(this.gapy);
    this.registerParameter(this.offset);
    this.registerParameter(this.offset_type);
    this.registerParameter(this.scale);
    this.registerParameter(this.rotate);
    this.registerParameter(this.mirrorrowsx);
    this.registerParameter(this.mirrorrowsy);
    this.registerParameter(this.mirrorcolsx);
    this.registerParameter(this.mirrorcolsy);
    this.registerParameter(this.mirrortrans);
    this.registerParameter(this.shrink_interp);
    this.registerParameter(this.split_items);
    this.registerParameter(this.link_styles);
    this.registerParameter(this.interpolate_scalex);
    this.registerParameter(this.interpolate_scaley);
    this.registerParameter(this.interpolate_rotatex);
    this.registerParameter(this.interpolate_rotatey);
    this.registerParameter(this.random_scale);
    this.registerParameter(this.random_rotate);
    this.registerParameter(this.random_gap_y);
    this.registerParameter(this.random_gap_x);
    this.registerParameter(this.transformorigin);

    this.num_cols.param_set_range(1, 9999); // we need the input a bit tiny so this seems enough
    this.num_cols.param_make_integer();
    this.num_cols.param_set_increments(1, 10);
    this.num_rows.param_set_range(1, 9999);
    this.num_rows.param_make_integer();
    this.num_rows.param_set_increments(1, 10);
    this.scale.param_set_range(-9999.99, 9999.99);
    this.scale.param_set_increments(1, 10);
    this.gapx.param_set_range(-99999, 99999);
    this.gapx.param_set_increments(1.0, 10.0);
    this.gapy.param_set_range(-99999, 99999);
    this.gapy.param_set_increments(1.0, 10.0);
    this.rotate.param_set_increments(1.0, 10.0);
    this.rotate.param_set_range(-900, 900);
    this.offset.param_set_range(-300, 300);
    this.offset.param_set_increments(1.0, 10.0);
    this.seed.param_set_range(1.0, 1.0);
    this.seed.param_set_randomsign(true);
    this.apply_to_clippath_and_mask = true;
    // TODO: split mode is not ported (satellites), so its widgets are hidden.
    this.split_items.param_widget_is_visible(false);
    this.link_styles.param_widget_is_visible(false);
    this.transformorigin.param_widget_is_visible(false);
    const doc = this.getSPDoc();
    this.display_unit = doc ? svgLengthUnitAbbr(doc.getRoot().width.unit) : 'px';
  }

  override destroy(): void {
    this._knotholder = null;
    super.destroy();
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    this.transformorigin.param_setValue(lpeitem.getAttribute('transform') ?? '', true);
    this.lpeversion.param_setValue('1.3.1', true);
    this.legacy = false;
    this.doBeforeEffect(lpeitem);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    const doc = this.getSPDoc();
    if (!doc) return;
    if (this.is_load) {
      this.legacy = this.lpeversion.param_getSVGValue() < '1.3.1';
      this.prev_unit = this.unit.get_abbreviation();
    }
    if (lpeitem.getAttribute('transform')) {
      this.transformorigin.read_from_SVG();
      const transformorigin_str = this.transformorigin.param_getSVGValue();
      this.transformoriginal = Affine.identity();
      if (transformorigin_str) {
        this.transformoriginal = sp_svg_transform_read(transformorigin_str) ?? Affine.identity();
      }
    } else {
      this.transformorigin.param_setValue('', true);
      this.transformoriginal = Affine.identity();
    }
    this.seed.resetRandomizer();
    this.random_x = [];
    this.random_y = [];
    this.random_s = [];
    this.random_r = [];
    const unit = this.unit.get_abbreviation();
    if (this.prev_unit && this.prev_unit !== unit) {
      const newgapx = convertUnit(this.gapx.get_value(), this.prev_unit, unit);
      const newgapy = convertUnit(this.gapy.get_value(), this.prev_unit, unit);
      this.gapx.param_set_value(newgapx);
      this.gapy.param_set_value(newgapy);
      this.prev_unit = unit;
      this.writeParamsToSVG();
    }
    const rotate = this.rotate.get_value();
    this.scaleok = (this.scale.get_value() + 100) / 100.0;
    const scaleok = this.scaleok;
    const seedset = this.seed.param_get_random_number() - this.seed.param_get_random_number();
    this.affinebase = Affine.identity();
    if (this.random_rotate.get_value() && rotate) {
      this.affinebase = this.affinebase.multiply(Rotate.from_degrees(seedset * rotate));
    }
    if (this.random_scale.get_value() && scaleok !== 1) {
      const s =
        this.seed.param_get_random_number() * (Math.max(scaleok, 1.0) - Math.min(scaleok, 1.0)) +
        Math.min(scaleok, 1.0);
      this.affinebase = this.affinebase.multiply(Scale(s, s));
    }
    if (this.random_gap_x.get_value() && this.gapx_unit) {
      this.affinebase = this.affinebase.multiply(
        Translate(this.seed.param_get_random_number() * this.gapx_unit * -1, 0),
      );
    }
    if (this.random_gap_y.get_value() && this.gapy_unit) {
      this.affinebase = this.affinebase.multiply(
        Translate(0, this.seed.param_get_random_number() * this.gapy_unit * -1),
      );
    }
    if (this.legacy) {
      const prev_display_unit = this.display_unit;
      this.display_unit = doc.getNamedView().getDisplayUnit();
      if (this.display_unit && this.display_unit !== prev_display_unit) {
        this.gapx.param_set_value(convertUnit(this.gapx.get_value(), this.display_unit, prev_display_unit));
        this.gapy.param_set_value(convertUnit(this.gapy.get_value(), this.display_unit, prev_display_unit));
        this.gapx.write_to_SVG();
        this.gapy.write_to_SVG();
      }
      this.gapx_unit = convertUnit(this.gapx.get_value(), unit, this.display_unit);
      this.gapy_unit = convertUnit(this.gapy.get_value(), unit, this.display_unit);
    } else {
      const scale = doc.getDocumentScale().x;
      this.gapx_unit = convertUnit(this.gapx.get_value(), unit, 'px') / scale;
      this.gapy_unit = convertUnit(this.gapy.get_value(), unit, 'px') / scale;
    }
    this.original_bbox(lpeitem, false, true, this.transformoriginal);
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    this.originalbbox = new Rect(X, Y);
    const A = new Point(X.min() - this.gapx_unit / 2.0, Y.min() - this.gapy_unit / 2.0);
    const B = new Point(X.max() + this.gapx_unit / 2.0, Y.max() + this.gapy_unit / 2.0);
    this.gap_bbox = new Rect(A, B);
    const scale_fix = this.end_scale(scaleok, true);
    this.originalbbox = scaledAroundMid(this.originalbbox, scale_fix);
    if (
      !this.interpolate_scalex.get_value() &&
      !this.interpolate_scaley.get_value() &&
      !this.random_scale.get_value()
    ) {
      this.gap_bbox = scaledAroundMid(this.gap_bbox, scaleok);
      this.originalbbox = scaledAroundMid(this.originalbbox, scaleok);
    }
    this.original_width = this.gap_bbox.width();
    this.original_height = this.gap_bbox.height();
  }

  end_scale(scale_fix: number, tomax: boolean): number {
    const num_rows = this.num_rows.get_value();
    const num_cols = this.num_cols.get_value();
    const isx = this.interpolate_scalex.get_value();
    const isy = this.interpolate_scaley.get_value();
    if (isx && isy) {
      scale_fix = 1 + (scale_fix - 1) * (num_rows + num_cols - 1);
    } else if (isx) {
      scale_fix = 1 + (scale_fix - 1) * (num_cols - 1);
    } else if (isy) {
      scale_fix = 1 + (scale_fix - 1) * (num_rows - 1);
    }
    if (tomax && (this.random_scale.get_value() || isx || isy)) {
      scale_fix = Math.max(scale_fix, 1.0);
    }
    return scale_fix;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    let fillrule = FillRule.fill_nonZero;
    const style = this.current_shape?.style;
    if (style?.fill_rule.set && style.fill_rule.computed === SPWindRule.SP_WIND_RULE_EVENODD) {
      fillrule = FillRule.fill_oddEven;
    }
    const path_out = this.doEffect_path_post(path_in, fillrule);
    this._knotholder?.update_knots();
    if (this.split_items.get_value()) return path_out;
    return PV.transformed(path_out, this.transformoriginal.inverse());
  }

  doEffect_path_post(path_in: PathVector, _fillrule: FillRule): PathVector {
    if (!this.gap_bbox) return path_in;
    const gap_bbox = this.gap_bbox;
    const transformoriginal = this.transformoriginal;
    const center = gap_bbox.midpoint().transformed(transformoriginal.inverse());
    const output: PathVector = [];
    let counter = 0;
    let prev_bbox: OptRect = null;
    let gapscalex = 0;
    let maxheight = 0;
    let bbox = PV.boundsFast(path_in);
    if (!bbox) return path_in;
    bbox = rectTransformed(bbox, transformoriginal);

    const num_rows = this.num_rows.get_value();
    const num_cols = this.num_cols.get_value();
    const rotate = this.rotate.get_value();
    const scaleok = this.scaleok;
    const offset = this.offset.get_value();
    const offset_type = this.offset_type.get_value();
    const isx = this.interpolate_scalex.get_value();
    const isy = this.interpolate_scaley.get_value();
    const irx = this.interpolate_rotatex.get_value();
    const iry = this.interpolate_rotatey.get_value();
    const random_scale = this.random_scale.get_value();
    const random_rotate = this.random_rotate.get_value();
    const mirrorrowsx = this.mirrorrowsx.get_value();
    const mirrorrowsy = this.mirrorrowsy.get_value();
    const mirrorcolsx = this.mirrorcolsx.get_value();
    const mirrorcolsy = this.mirrorcolsy.get_value();
    const mirrortrans = this.mirrortrans.get_value();
    const original_width = this.original_width;
    const original_height = this.original_height;

    const posx = (gap_bbox.left() - bbox.left()) / gap_bbox.width();
    const factorx = original_width / bbox.width();
    const factory = original_height / bbox.height();
    const y: number[] = new Array(Math.trunc(num_cols)).fill(0);
    let yset = 0;
    const gap: number[] = new Array(Math.trunc(num_cols)).fill(0);
    for (let i = 0; i < num_rows; ++i) {
      for (let j = 0; j < num_cols; ++j) {
        let x = 0;
        let r = Affine.identity();
        let mirror = Scale(1, 1);
        let reverse_pv = false;
        if (mirrorrowsx || mirrorrowsy || mirrorcolsx || mirrorcolsy) {
          let mx = 1;
          let my = 1;
          if (mirrorrowsx && mirrorcolsx) {
            mx = (j + i) % 2 !== 0 ? -1 : 1;
          } else if (mirrorrowsx) {
            mx = i % 2 !== 0 ? -1 : 1;
          } else if (mirrorcolsx) {
            mx = j % 2 !== 0 ? -1 : 1;
          }
          if (mirrorrowsy && mirrorcolsy) {
            my = (j + i) % 2 !== 0 ? -1 : 1;
          } else if (mirrorrowsy) {
            my = i % 2 !== 0 ? -1 : 1;
          } else if (mirrorcolsy) {
            my = j % 2 !== 0 ? -1 : 1;
          }
          mirror = Scale(mx, my);
          reverse_pv = mx * my === -1;
        }
        let rotatein = rotate;
        if (irx && iry) {
          rotatein = rotatein * (i + j);
        } else if (irx) {
          rotatein = rotatein * j;
        } else if (iry) {
          rotatein = rotatein * i;
        }
        if (mirrortrans && ((irx && i % 2 !== 0) || (iry && j % 2 !== 0) || (irx && iry))) {
          rotatein *= -1;
        }
        let scalein = 1;
        const scalegap = scaleok - scalein;
        if (isx && isy) {
          scalein = scalegap * (i + j) + 1;
        } else if (isx) {
          scalein = scalegap * j + 1;
        } else if (isy) {
          scalein = scalegap * i + 1;
        } else {
          scalein = scaleok;
        }
        if (random_scale && scaleok !== 1.0) {
          if (this.random_s.length === counter) {
            const max = Math.max(1.0, scaleok);
            const min = Math.min(1.0, scaleok);
            this.random_s.push(this.seed.param_get_random_number() * (max - min) + min);
          }
          scalein = this.random_s[counter] as number;
        }
        if (random_rotate && rotate) {
          if (this.random_r.length === counter) {
            this.random_r.push(
              (this.seed.param_get_random_number() - this.seed.param_get_random_number()) * rotate,
            );
          }
          rotatein = this.random_r[counter] as number;
        }
        if (this.random_x.length === counter) {
          if (this.random_gap_x.get_value() && this.gapx_unit && (j || i)) {
            this.random_x.push(this.seed.param_get_random_number() * this.gapx_unit); // avoid overlapping
          } else {
            this.random_x.push(0);
          }
        }
        if (this.random_y.length === counter) {
          if (this.random_gap_y.get_value() && this.gapy_unit && (j || i)) {
            this.random_y.push(this.seed.param_get_random_number() * this.gapy_unit); // avoid overlapping
          } else {
            this.random_y.push(0);
          }
        }
        r = r.multiply(Scale(scalein, scalein));
        r = r.multiply(Rotate.from_degrees(rotatein));

        let output_pv = pathv_to_linear_and_cubic_beziers(path_in);
        if (reverse_pv) output_pv = PV.reversed(output_pv);

        let m = Translate(center.neg()).multiply(r);
        if (!irx && !iry && !random_rotate) m = m.multiply(Rotate.from_degrees(rotate));
        if (!isx && !isy && !random_scale) m = m.multiply(Scale(scaleok, scaleok));
        m = m.multiply(Translate(center));
        if (this.split_items.get_value()) return PV.transformed(output_pv, m);
        const scale_fix = this.end_scale(scaleok, true);
        let heightrows = original_height * scale_fix;
        let widthcols = original_width * scale_fix;
        let fixed_heightrows = heightrows;
        let fixed_widthcols = widthcols;

        if (rotatein && this.shrink_interp.get_value()) {
          this.shrink_interp.param_setValue(false);
          this.shrink_interp.write_to_SVG();
          return path_in;
        }
        if (scaleok !== 1.0 && (isx || isy)) {
          const cbbox = PV.boundsFast(PV.transformed(output_pv, m));
          if (cbbox) {
            maxheight = Math.max(maxheight, cbbox.height());
            widthcols = Math.max(original_width * this.end_scale(scaleok, false), original_width);
            heightrows = Math.max(original_height * this.end_scale(scaleok, false), original_height);
            fixed_widthcols = widthcols;
            fixed_heightrows = heightrows;
            const cx = cbbox.width();
            const cy = cbbox.height();
            if (this.shrink_interp.get_value() && (!isx || !isy)) {
              heightrows = 0;
              widthcols = 0;
              let px = 0;
              if (prev_bbox) px = prev_bbox.width();
              if (isx) {
                if (j) {
                  x = (cx - (cx - px) / 2.0) * factorx;
                  gapscalex += x;
                  x = gapscalex;
                } else {
                  x = 0;
                  gapscalex = 0;
                }
              } else {
                x = (Math.max(original_width * this.end_scale(scaleok, false), original_width) + posx) * j;
              }
              if (isx && i === 1) {
                y[j] = maxheight * factory;
              } else if (i === 0) {
                y[j] = 0;
              }
              if (i === 1 && !isx) {
                gap[j] = (cy * factory - (y[j] as number)) / 2.0;
              } else if (i === 0) {
                gap[j] = 0;
              }
              yset = (y[j] as number) + (gap[j] as number) * i;
              if (isy) {
                y[j] = (y[j] as number) + cy * factory;
              } else {
                y[j] = (y[j] as number) + maxheight * factory;
              }
            }
            prev_bbox = cbbox;
          }
        } else {
          y[j] = 0;
        }
        let xset = x;
        xset += widthcols * j;
        if (heightrows) yset = heightrows * i;
        let offset_x = 0;
        let offset_y = 0;
        if (offset !== 0) {
          if (offset_type && j % 2) offset_y = fixed_heightrows / (100.0 / offset);
          if (!offset_type && i % 2) offset_x = fixed_widthcols / (100.0 / offset);
        }
        m = m
          .multiply(Translate(center.neg()))
          .multiply(mirror)
          .multiply(Translate(center))
          .multiply(transformoriginal)
          .multiply(
            Translate(
              xset + offset_x - (this.random_x[counter] as number),
              yset + offset_y - (this.random_y[counter] as number),
            ),
          );
        output.push(...PV.transformed(output_pv, m));
        counter++;
      }
    }
    return output;
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    if (!this.gap_bbox) return;
    hp_vec.length = 0;
    const mid = this.gap_bbox.midpoint();
    const scale_fix = this.end_scale(this.scaleok, true);
    const hp = Path.fromRect(this.gap_bbox).transformed(
      Translate(mid.neg())
        .multiply(Scale(scale_fix, scale_fix))
        .multiply(Translate(mid))
        .multiply(this.transformoriginal.inverse()),
    );
    hp_vec.push([hp]);
  }

  override resetDefaults(item: SPItem): void {
    super.resetDefaults(item);
    this.original_bbox(item as SPLPEItem, false, true);
  }

  override doOnVisibilityToggled(lpeitem: SPLPEItem): void {
    const transformorigin_str = lpeitem.getAttribute('transform');
    let ontoggle = Affine.identity();
    if (transformorigin_str) ontoggle = sp_svg_transform_read(transformorigin_str) ?? Affine.identity();
    if (this.is_visible.get_value()) {
      if (ontoggle.isIdentity()) {
        this.transformorigin.param_setValue('', true);
      } else {
        ontoggle = ontoggle.multiply(this.hideaffine.inverse()).multiply(this.transformoriginal);
        this.transformorigin.param_setValue(sp_svg_transform_write(ontoggle) ?? '', true);
      }
    } else {
      this.hideaffine = ontoggle;
    }
  }

  protected override addKnotHolderEntities(knotholder: KnotHolder, item: SPItem): void {
    this._knotholder = knotholder;
    const e = new KnotHolderEntityCopyGapX(this);
    e.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:CopiesGapX',
      _('<b>Horizontal gaps between tiles</b>: drag to adjust, <b>Shift+click</b> to reset'),
    );
    knotholder.add(e);
    const f = new KnotHolderEntityCopyGapY(this);
    f.create(
      null,
      item,
      knotholder,
      'CANVAS_ITEM_CTRL_TYPE_LPE',
      'LPE:CopiesGapY',
      _('<b>Vertical gaps between tiles</b>: drag to adjust, <b>Shift+click</b> to reset'),
    );
    knotholder.add(f);
  }

  /** The gap in px (or the display unit for legacy documents) at the knots (knot_get). */
  gapToKnot(gap: number): number {
    const doc = this.getSPDoc();
    if (!doc) return 0;
    if (this.legacy)
      return convertUnit(gap, this.unit.get_abbreviation(), doc.getNamedView().getDisplayUnit());
    return convertUnit(gap, this.unit.get_abbreviation(), 'px') / doc.getDocumentScale().x;
  }

  /** The gap of a knot distance value (knot_set). */
  knotToGap(value: number): number {
    const doc = this.getSPDoc();
    if (!doc) return 0;
    const v = (value / this.end_scale(this.scaleok, false)) * 2;
    if (this.legacy) {
      return convertUnit(v, svgLengthUnitAbbr(doc.getRoot().width.unit), this.unit.get_abbreviation());
    }
    return convertUnit(v, 'px', this.unit.get_abbreviation()) * doc.getDocumentScale().x;
  }
}

// we need a separate namespace to avoid clashes with other LPEs (upstream namespace CoS)
abstract class KnotHolderEntityCopyGap extends LPEKnotHolderEntity<LPETiling> {
  /** 0 for the gap in X (corner 1 of the box), 1 for Y (corner 3). */
  protected abstract readonly dim: 0 | 1;

  override destroy(): void {
    super.destroy();
    this._effect._knotholder = null;
  }

  #param(): ScalarParam {
    return this.dim === 0 ? this._effect.gapx : this._effect.gapy;
  }

  override knot_click(state: KnotState): void {
    if (!state.shiftKey) return;
    this.#param().param_set_value(0);
    if (this.item && 'path_effect_list' in this.item) {
      sp_lpe_item_update_patheffect(this.item as SPLPEItem, false, false);
    }
  }

  knot_set(p: Point, _origin: Point, state: KnotState): void {
    const s = this.snap_knot_position(p, state);
    const box = this._effect.originalbbox;
    if (!box) return;
    const point = box.corner(this.dim === 0 ? 1 : 3).transformed(this._effect.transformoriginal.inverse());
    const value = this.dim === 0 ? s.x - point.x : s.y - point.y;
    const param = this.#param();
    param.param_set_value(this._effect.knotToGap(value));
    param.write_to_SVG();
  }

  knot_get(): Point {
    const box = this._effect.originalbbox;
    if (!box) return NO_POINT();
    const value = this._effect.gapToKnot(this.#param().get_value());
    const d = (value * this._effect.end_scale(this._effect.scaleok, false)) / 2.0;
    const ret = this.dim === 0 ? box.corner(1).add(new Point(d, 0)) : box.corner(3).add(new Point(0, d));
    return ret.transformed(this._effect.transformoriginal.inverse());
  }
}

class KnotHolderEntityCopyGapX extends KnotHolderEntityCopyGap {
  protected readonly dim = 0;
}

class KnotHolderEntityCopyGapY extends KnotHolderEntityCopyGap {
  protected readonly dim = 1;
}
