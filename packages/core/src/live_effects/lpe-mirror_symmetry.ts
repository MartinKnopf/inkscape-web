// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-mirror_symmetry.cpp, src/live_effects/lpe-mirror_symmetry.h
/** \file
 * LPE <mirror_symmetry> implementation: mirrors a path with respect to a given line.
 */
/*
 * Authors:
 *   Maximilian Albert
 *   Johan Engelen
 *   Abhishek Sharma
 *   Jabiertxof
 *
 * Copyright (C) Johan Engelen 2007 <j.b.c.engelen@utwente.nl>
 * Copyright (C) Maximilin Albert 2008 <maximilian.albert@gmail.com>
 */
import {
  are_near,
  cross,
  distance,
  EPSILON,
  LineSegment,
  middle_point,
  Path,
  type PathVector,
  Point,
  Rect,
  rad_from_deg,
  reflection,
} from '@inkscape-web/geom';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _, C_, N_ } from '../i18n.ts';
import { i2anc_affine } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import { sp_lpe_item_update_patheffect } from '../object/sp-lpe-item.ts';
import { FillRule, flatten, pathBoolopBackend } from '../path/path-boolop.ts';
import { sp_svg_write_path } from '../svg/svg-path.ts';
import { EnumDataConverter } from '../util/enums.ts';
import { GroupBBoxEffect } from './lpegroupbbox.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { EnumParam } from './parameter/enum.ts';
import type { Parameter, ParamWidget } from './parameter/parameter.ts';
import { PointParam } from './parameter/point.ts';

export enum ModeType {
  MT_V,
  MT_H,
  MT_FREE,
  MT_X,
  MT_Y,
  MT_END,
}

const ModeTypeData = [
  { id: ModeType.MT_V, label: N_('Vertical page center'), key: 'vertical' },
  { id: ModeType.MT_H, label: N_('Horizontal page center'), key: 'horizontal' },
  { id: ModeType.MT_FREE, label: N_('Freely defined mirror line'), key: 'free' },
  { id: ModeType.MT_X, label: N_('X coordinate of mirror line midpoint'), key: 'X' },
  { id: ModeType.MT_Y, label: N_('Y coordinate of mirror line midpoint'), key: 'Y' },
];
const MTConverter = new EnumDataConverter<ModeType>(ModeTypeData, ModeType.MT_END);

/** The sign of x: -1, 0 or 1 (upstream Geom::sgn). */
const sgn = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/**
 * Times along `original` where it crosses `divider` (upstream Geom::crossings(original, divider),
 * the ta of each crossing; computed by lib2geom in WASM).
 */
function crossingTimes(original: Path, divider: Path): number[] {
  const flat = pathBoolopBackend().pathCrossings(sp_svg_write_path(original), sp_svg_write_path(divider));
  const out: number[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(flat[i] as number);
  return out;
}

/**
 * Mirror symmetry (upstream LPEMirrorSymmetry): adds the mirror image of the path, or fuses
 * the path with it, along a mirror line given by two points.
 * TODO: split elements (the mirror as a separate satellite object, lpesatellites).
 */
export class LPEMirrorSymmetry extends GroupBBoxEffect {
  readonly mode: EnumParam<ModeType>;
  readonly discard_orig_path: BoolParam;
  readonly fuse_paths: BoolParam;
  readonly oposite_fuse: BoolParam;
  readonly split_items: BoolParam;
  readonly split_open: BoolParam;
  readonly start_point: PointParam;
  readonly end_point: PointParam;
  readonly center_point: PointParam;
  readonly link_styles: BoolParam;
  readonly reverse_mirror: BoolParam;
  previous_center = new Point(0, 0);
  center_vert = false;
  center_horiz = false;

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.mode = new EnumParam(
      _('Mode'),
      _(
        'Set mode of transformation. Either freely defined by mirror line or constrained to certain symmetry points.',
      ),
      'mode',
      MTConverter,
      this,
      ModeType.MT_FREE,
    );
    this.discard_orig_path = new BoolParam(
      _('Discard original path'),
      _('Only keep mirrored part of the path, remove the original.'),
      'discard_orig_path',
      this,
      false,
    );
    this.fuse_paths = new BoolParam(
      _('Fuse paths'),
      _('Fuse original path and mirror image into a single path'),
      'fuse_paths',
      this,
      false,
    );
    this.oposite_fuse = new BoolParam(
      _('Fuse opposite sides'),
      _('Picks the part on the other side of the mirror line as the original.'),
      'oposite_fuse',
      this,
      false,
    );
    this.split_items = new BoolParam(
      _('Split elements'),
      _('Split original and mirror image into separate paths, so each can have its own style.'),
      'split_items',
      this,
      false,
    );
    this.split_open = new BoolParam(
      _('Keep open paths on split'),
      _('Do not automatically close paths along the split line.'),
      'split_open',
      this,
      false,
    );
    this.start_point = new PointParam(
      _('Mirror line start'),
      _('Start point of mirror line'),
      'start_point',
      this,
      _('Adjust start point of mirror line'),
    );
    this.end_point = new PointParam(
      _('Mirror line end'),
      _('End point of mirror line'),
      'end_point',
      this,
      _('Adjust end point of mirror line'),
    );
    this.center_point = new PointParam(
      _('Mirror line mid'),
      _('Center point of mirror line'),
      'center_point',
      this,
      _('Adjust center point of mirror line'),
    );
    this.link_styles = new BoolParam(
      _('Link styles'),
      _('Link styles on split mode'),
      'link_styles',
      this,
      false,
    );
    this.reverse_mirror = new BoolParam(
      _('Reverse mirrored path'),
      _('Reverse the direction of the mirrored path.'),
      'reverse_mirror',
      this,
      false,
    );
    this.registerParameter(this.mode);
    this.registerParameter(this.discard_orig_path);
    this.registerParameter(this.fuse_paths);
    this.registerParameter(this.oposite_fuse);
    this.registerParameter(this.split_items);
    this.registerParameter(this.split_open);
    this.registerParameter(this.link_styles);
    this.registerParameter(this.reverse_mirror);
    this.registerParameter(this.start_point);
    this.registerParameter(this.end_point);
    this.registerParameter(this.center_point);
    this.show_orig_path = true;
    this.apply_to_clippath_and_mask = true;
    this.center_point.param_widget_is_visible(false);
    // TODO: split mode is not ported (satellites), so its widgets are hidden.
    this.split_items.param_widget_is_visible(false);
    this.link_styles.param_widget_is_visible(false);
    this.satellitestoclipboard = true;
  }

  override newWidget(): { param: Parameter | null; widget: ParamWidget }[] {
    const widgets = super.newWidget().filter((w) => w.param?.param_key !== 'split_open');
    widgets.push({
      param: null,
      widget: {
        kind: 'buttons',
        buttons: [
          { label: _('Vertical center'), onClick: () => this.centerVert() },
          { label: _('Horizontal center'), onClick: () => this.centerHoriz() },
        ],
      },
    });
    return widgets;
  }

  centerVert(): void {
    if (!this.sp_lpe_item) return;
    this.center_vert = true;
    sp_lpe_item_update_patheffect(this.sp_lpe_item, false, false, true);
    this.makeUndoDone(C_('Undo', 'Center Vertical'));
  }

  centerHoriz(): void {
    if (!this.sp_lpe_item) return;
    this.center_horiz = true;
    sp_lpe_item_update_patheffect(this.sp_lpe_item, false, false, true);
    this.makeUndoDone(C_('Undo', 'Center Horizontal'));
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    const X = this.boundingbox_X;
    const Y = this.boundingbox_Y;
    let point_a = new Point(X.max(), Y.min());
    let point_b = new Point(X.max(), Y.max());
    const point_c = new Point(X.middle(), Y.middle());
    const start = () => this.start_point.value;
    const end = () => this.end_point.value;
    const center = this.center_point.value;
    if (this.center_vert) {
      this.center_point.param_setValue(point_c, true);
      this.end_point.param_setValue(new Point(X.middle(), Y.min()), true);
      //force update
      this.start_point.param_setValue(new Point(X.middle(), Y.max()), true);
      this.center_vert = false;
    } else if (this.center_horiz) {
      this.center_point.param_setValue(point_c, true);
      this.end_point.param_setValue(new Point(X.max(), Y.middle()), true);
      this.start_point.param_setValue(new Point(X.min(), Y.middle()), true);
      //force update
      this.center_horiz = false;
    } else {
      const mode = this.mode.get_value();
      if (mode === ModeType.MT_Y) {
        point_a = new Point(X.min(), center.y);
        point_b = new Point(X.max(), center.y);
        this.center_point.param_setValue(middle_point(point_a, point_b), true);
      }
      if (mode === ModeType.MT_X) {
        point_a = new Point(center.x, Y.min());
        point_b = new Point(center.x, Y.max());
        this.center_point.param_setValue(middle_point(point_a, point_b), true);
      }
      if (start().equals(end())) {
        this.start_point.param_setValue(point_a, true);
        this.end_point.param_setValue(point_b, true);
        this.previous_center = middle_point(start(), end());
        this.center_point.param_setValue(this.previous_center, true);
        return;
      }
      if (mode === ModeType.MT_X || mode === ModeType.MT_Y) {
        if (!are_near(this.previous_center, this.center_point.value, 0.01)) {
          this.center_point.param_setValue(middle_point(point_a, point_b), true);
          this.end_point.param_setValue(point_b, true);
          this.start_point.param_setValue(point_a, true);
        } else if (mode === ModeType.MT_X) {
          if (!are_near(start().x, point_a.x, 0.01)) this.start_point.param_setValue(point_a, true);
          if (!are_near(end().x, point_b.x, 0.01)) this.end_point.param_setValue(point_b, true);
        } else {
          //MT_Y
          if (!are_near(start().y, point_a.y, 0.01)) this.start_point.param_setValue(point_a, true);
          if (!are_near(end().y, point_b.y, 0.01)) this.end_point.param_setValue(point_b, true);
        }
      } else if (mode === ModeType.MT_FREE) {
        if (!are_near(this.previous_center, this.center_point.value, 0.001)) {
          const trans = this.center_point.value.sub(middle_point(start(), end()));
          this.start_point.param_setValue(start().add(trans), true);
          this.end_point.param_setValue(end().add(trans), true);
        }
        this.center_point.param_setValue(middle_point(start(), end()), true);
        this.previous_center = middle_point(start(), end());
      } else {
        // MT_V or MT_H (horizontal or vertical page center)
        const document = this.getSPDoc();
        if (document) {
          // TODO: the page of the item (page manager); the document bounds for now.
          const pageRect = document.pageBounds();
          let sp: Point;
          let ep: Point;
          if (mode === ModeType.MT_V) {
            // The mirror line is the vertical page center.
            sp = new Point(pageRect.midpoint().x, pageRect.top());
            ep = new Point(sp.x, pageRect.bottom());
          } else {
            // The mirror line is the horizontal page center.
            sp = new Point(pageRect.left(), pageRect.midpoint().y);
            ep = new Point(pageRect.right(), sp.y);
          }
          const transform = i2anc_affine(lpeitem, null).inverse();
          this.start_point.param_setValue(sp.transformed(transform), true);
          this.end_point.param_setValue(ep.transformed(transform), true);
          this.center_point.param_setValue(middle_point(start(), end()), true);
        }
      }
    }
    this.previous_center = this.center_point.value;
  }

  protected override doOnApply(lpeitem: SPLPEItem): void {
    this.original_bbox(lpeitem, false, true);
    const point_a = new Point(this.boundingbox_X.max(), this.boundingbox_Y.min());
    const point_b = new Point(this.boundingbox_X.max(), this.boundingbox_Y.max());
    const point_c = new Point(this.boundingbox_X.max(), this.boundingbox_Y.middle());
    this.start_point.param_setValue(point_a, true);
    this.start_point.param_update_default(point_a);
    this.end_point.param_setValue(point_b, true);
    this.end_point.param_update_default(point_b);
    this.center_point.param_setValue(point_c, true);
    this.previous_center = this.center_point.value;
    //we bump to 1.1 because previous 1.0.2 take no effect because a bug on 1.0.2
    this.lpeversion.param_setValue('1.2', true);
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    if (this.split_items.get_value() && !this.fuse_paths.get_value()) return path_in;
    const discard_orig_path = this.discard_orig_path.get_value();
    const fuse_paths = this.fuse_paths.get_value();
    const split_items = this.split_items.get_value();
    const oposite_fuse = this.oposite_fuse.get_value();
    const reverse_mirror = this.reverse_mirror.get_value();
    const original_pathv = pathv_to_linear_and_cubic_beziers(path_in);
    let path_out: PathVector = [];
    if (!discard_orig_path && !fuse_paths) path_out = pathv_to_linear_and_cubic_beziers(path_in);
    const start_point = this.start_point.value;
    const end_point = this.end_point.value;
    const center_point = this.center_point.value;
    const line_vector = end_point.sub(start_point);
    const m = reflection(line_vector, start_point);
    const version = this.lpeversion.param_getSVGValue();
    if (fuse_paths && !discard_orig_path) {
      for (const path_it of original_pathv) {
        if (path_it.empty()) continue;
        let tmp_pathvector: PathVector = [];
        let time_start = 0.0;
        let position = 0;
        let end_open = false;
        if (path_it.closed()) {
          const closingline = path_it.closingSegment();
          if (!are_near(closingline.initialPoint(), closingline.finalPoint())) end_open = true;
        }
        const original = path_it.clone();
        if (end_open && path_it.closed()) {
          original.close(false);
          original.appendCurve(new LineSegment(original.finalPoint(), original.initialPoint()));
          original.close(true);
        }
        const dir = Math.atan2(line_vector.y, line_vector.x);
        const X = this.boundingbox_X;
        const Y = this.boundingbox_Y;
        const diagonal = distance(new Point(X.min(), Y.min()), new Point(X.max(), Y.max()));
        const bbox = new Rect(new Point(X.min(), Y.min()), new Point(X.max(), Y.max()));
        const size_divider = Math.sqrt(bbox.distanceSq(center_point)) + diagonal;
        const s = Point.polar(dir, size_divider).add(center_point);
        const e = Point.polar(dir + rad_from_deg(180), size_divider).add(center_point);
        const divider = new Path(s);
        divider.appendCurve(new LineSegment(s, e));
        const crossed = crossingTimes(original, divider).sort((a, b) => a - b);
        const cs_size = crossed.length;
        for (let i = 0; i < crossed.length; i++) {
          const time_end = crossed[i] as number;
          if (time_start !== time_end && time_end - time_start > EPSILON) {
            const portion = original.portion(time_start, time_end);
            if (!portion.empty()) {
              const middle = portion.pointAt(portion.size() / 2.0);
              position = sgn(cross(e.sub(s), middle.sub(s)));
              if (!oposite_fuse) position *= -1;
              if (position === 1) {
                if (!split_items) {
                  let mirror = portion.reversed().transformed(m);
                  if (reverse_mirror) mirror = mirror.reversed();
                  mirror.setInitial(portion.finalPoint());
                  portion.append(mirror);
                  if (i !== 0) {
                    portion.setFinal(portion.initialPoint());
                    portion.close();
                  }
                }
                tmp_pathvector.push(portion);
              }
            }
          }
          time_start = time_end;
        }
        position = sgn(cross(e.sub(s), original.finalPoint().sub(s)));
        if (!oposite_fuse) position *= -1;
        if (cs_size !== 0 && position === 1) {
          if (time_start !== original.size() && original.size() - time_start > EPSILON) {
            let portion = original.portion(time_start, original.size());
            if (!portion.empty()) {
              portion = portion.reversed();
              if (!split_items) {
                let mirror = portion.reversed().transformed(m);
                if (reverse_mirror) mirror = mirror.reversed();
                mirror.setInitial(portion.finalPoint());
                portion.append(mirror);
              }
              portion = portion.reversed();
              if (!original.closed()) {
                tmp_pathvector.push(portion);
              } else {
                const first = tmp_pathvector[0];
                if (cs_size > 1 && first && first.size() > 0) {
                  if (!split_items) {
                    portion.setFinal(first.initialPoint());
                    portion.setInitial(first.finalPoint());
                    first.append(portion);
                  } else {
                    const reversed_first = first.reversed();
                    tmp_pathvector[0] = reversed_first;
                    portion = portion.reversed();
                    portion.setInitial(reversed_first.finalPoint());
                    reversed_first.append(portion);
                  }
                } else {
                  tmp_pathvector.push(portion);
                }
                if (version < '1.1') tmp_pathvector[0]?.close();
              }
            }
          }
        }
        if (!this.split_open.get_value() && version >= '1.1' && original.closed()) {
          for (const path of tmp_pathvector) if (!path.closed()) path.close();
          tmp_pathvector = flatten(tmp_pathvector, FillRule.fill_oddEven);
        }
        if (cs_size === 0 && position === 1) {
          tmp_pathvector.push(original);
          if (!split_items) {
            let mirrored = original.transformed(m);
            if (reverse_mirror) mirrored = mirrored.reversed();
            tmp_pathvector.push(mirrored);
          }
        }
        path_out.push(...tmp_pathvector);
      }
    } else if (!fuse_paths || discard_orig_path) {
      for (const i of original_pathv) {
        let mirrored = i.transformed(m);
        if (reverse_mirror) mirrored = mirrored.reversed();
        path_out.push(mirrored);
      }
    }
    return path_out;
  }

  protected override addCanvasIndicators(_lpeitem: SPLPEItem, hp_vec: PathVector[]): void {
    hp_vec.length = 0;
    const path = new Path(this.start_point.value);
    path.appendCurve(new LineSegment(this.start_point.value, this.end_point.value));
    hp_vec.push([path]);
  }
}
