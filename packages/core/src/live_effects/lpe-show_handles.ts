// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/live_effects/lpe-show_handles.cpp, src/live_effects/lpe-show_handles.h
/*
 * Authors:
 *   Jabier Arraiza Cenoz <jabier.arraiza@marker.es>
 *
 * Copyright (C) Jabier Arraiza Cenoz 2014
 */
import {
  are_near,
  CubicBezier,
  type Curve,
  distance,
  LineSegment,
  Path,
  type PathVector,
  Point,
  Rotate,
  Scale,
  Translate,
} from '@inkscape-web/geom';
import { pathv_to_linear_and_cubic_beziers } from '../helper/geom.ts';
import { _ } from '../i18n.ts';
import { SPItem } from '../object/sp-item.ts';
import type { SPLPEItem } from '../object/sp-lpe-item.ts';
import type { SPObject } from '../object/sp-object.ts';
import { GeomNodeType, get_nodetype } from '../object/sp-shape.ts';
import { spCssAttrScale } from '../style.ts';
import { sp_svg_read_pathv } from '../svg/svg-path.ts';
import {
  type SPCSSAttr,
  spReprCssAttrNew,
  spReprCssChange,
  spReprCssMerge,
  spReprCssSetProperty,
} from '../xml/repr-css.ts';
import { Effect } from './effect.ts';
import type { LivePathEffectObject } from './lpeobject.ts';
import { BoolParam } from './parameter/bool.ts';
import { ScalarParam } from './parameter/parameter.ts';

/**
 * Set css on o and its child items (the part of the editor's sp_desktop_apply_css_recursive that
 * applies to shapes and groups).
 */
function apply_css_recursive(o: SPObject, css: SPCSSAttr): void {
  if (!(o instanceof SPItem)) return;
  const css_set = spReprCssAttrNew();
  spReprCssMerge(css_set, css);
  // Scale the style by the inverse of the accumulated parent transform.
  const ex = o.i2docAffine().descrim();
  if (ex !== 0 && ex !== 1) spCssAttrScale(css_set, 1 / ex);
  spReprCssChange(o.getRepr(), css_set, 'style');
  if (o.getRepr().name() === 'svg:use') return;
  for (const child of o.children) apply_css_recursive(child, css);
}

/** Show handles (upstream LPEShowHandles): draws the nodes and handles of the path as paths. */
export class LPEShowHandles extends Effect {
  readonly nodes: BoolParam;
  readonly handles: BoolParam;
  readonly original_path: BoolParam;
  readonly show_center_node: BoolParam;
  readonly original_d: BoolParam;
  readonly scale_nodes_and_handles: ScalarParam;
  stroke_width = 1.0;
  outline_path: Path[] = [];

  constructor(lpeobject: LivePathEffectObject) {
    super(lpeobject);
    this.nodes = new BoolParam(_('Show nodes'), _('Show nodes'), 'nodes', this, true);
    this.handles = new BoolParam(_('Show handles'), _('Show handles'), 'handles', this, true);
    this.original_path = new BoolParam(_('Show path'), _('Show path'), 'original_path', this, true);
    this.show_center_node = new BoolParam(
      _('Show center of node'),
      _('Show center of node'),
      'show_center_node',
      this,
      false,
    );
    this.original_d = new BoolParam(_('Show original'), _('Show original'), 'original_d', this, false);
    this.scale_nodes_and_handles = new ScalarParam(
      _('Scale nodes and handles'),
      _('Scale nodes and handles'),
      'scale_nodes_and_handles',
      this,
      10,
    );
    this.registerParameter(this.nodes);
    this.registerParameter(this.handles);
    this.registerParameter(this.original_path);
    this.registerParameter(this.show_center_node);
    this.registerParameter(this.original_d);
    this.registerParameter(this.scale_nodes_and_handles);
    this.scale_nodes_and_handles.param_set_range(0, 500);
    this.scale_nodes_and_handles.param_set_increments(1, 1);
    this.scale_nodes_and_handles.param_set_digits(2);
  }

  /**
   * Sets default styles to element
   * this permanently remove.some styles of the element
   */
  protected override doOnApply(lpeitem: SPLPEItem): void {
    const css = spReprCssAttrNew();
    spReprCssSetProperty(css, 'stroke', 'black');
    spReprCssSetProperty(css, 'stroke-width', '1');
    spReprCssSetProperty(css, 'stroke-linecap', 'butt');
    spReprCssSetProperty(css, 'fill', 'none');
    apply_css_recursive(lpeitem, css);
  }

  protected override doBeforeEffect(lpeitem: SPLPEItem): void {
    this.stroke_width = lpeitem.style.stroke_width.computed;
  }

  protected override doEffect_path(path_in: PathVector): PathVector {
    const path_out: Path[] = [];
    const original_pathv: Path[] = [...pathv_to_linear_and_cubic_beziers(path_in)];
    if (this.original_path.get_value()) path_out.push(...path_in);
    this.outline_path = [];
    if (this.original_d.get_value()) {
      const shape_curve = this.getCurrentShape()?.curveForEdit();
      if (shape_curve) {
        if (this.original_path.get_value()) path_out.push(...shape_curve);
        original_pathv.push(...shape_curve);
      }
    }
    this.generateHelperPath(original_pathv);
    path_out.push(...this.outline_path);
    return path_out;
  }

  generateHelperPath(result: PathVector): void {
    if (!this.handles.get_value() && !this.nodes.get_value()) return;
    for (const path_it of result) {
      if (path_it.empty()) continue;
      let curves: readonly Curve[] = path_it.curves();
      if (path_it.closed()) {
        // if the path is closed, maybe we have to stop a bit earlier because the
        // closing line segment has zerolength.
        const closingline = curves[curves.length - 1] as Curve;
        if (are_near(closingline.initialPoint(), closingline.finalPoint())) curves = path_it.openCurves();
      }
      const first = curves[0] as Curve;
      if (this.nodes.get_value()) {
        let nodetype = GeomNodeType.NODE_CUSP;
        if (path_it.closed()) {
          // finalCurve: the closing segment, or the last curve when it is degenerate
          const all = path_it.curves();
          nodetype = get_nodetype(all[all.length - 1] as Curve, first);
        }
        this.drawNode(first.initialPoint(), nodetype);
      }
      for (let i = 0; i < curves.length; i++) {
        const c1 = curves[i] as Curve;
        const c2 = curves[i + 1];
        if (c1 instanceof CubicBezier && this.handles.get_value()) {
          const [p0, p1, p2, p3] = c1.controlPoints() as [Point, Point, Point, Point];
          if (!are_near(p0, p1)) {
            this.drawHandle(p1);
            this.drawHandleLine(p0, p1);
          }
          if (!are_near(p3, p2)) {
            this.drawHandle(p2);
            this.drawHandleLine(p3, p2);
          }
        }
        if (this.nodes.get_value() && (c2 || !path_it.closed())) {
          // at the end of an open path, upstream's curve_it2 is end_open(): the closing segment
          const out = c2 ?? path_it.closingSegment();
          this.drawNode(c1.finalPoint(), get_nodetype(c1, out));
        }
      }
    }
  }

  drawNode(p: Point, nodetype: GeomNodeType): void {
    const diameter = this.stroke_width * this.scale_nodes_and_handles.get_value();
    if (diameter <= 0.0) return;
    const rotate = nodetype === GeomNodeType.NODE_CUSP ? Rotate.from_degrees(45) : Rotate(0);
    const svgd = this.show_center_node.get_value()
      ? 'M 0.05,0 A 0.05,0.05 0 0 1 0,0.05 0.05,0.05 0 0 1 -0.05,0 0.05,0.05 0 0 1 0,-0.05 0.05,0.05 0 0 1 0.05,0 Z M -0.5,-0.5 0.5,-0.5 0.5,0.5 -0.5,0.5 Z'
      : 'M -0.5,-0.5 0.5,-0.5 0.5,0.5 -0.5,0.5 Z';
    const m = rotate.multiply(Scale(diameter)).multiply(Translate(p));
    const pathv = sp_svg_read_pathv(svgd).map((path) => path.transformed(m));
    this.outline_path.push(pathv[0] as Path);
    if (this.show_center_node.get_value()) this.outline_path.push(pathv[1] as Path);
  }

  drawHandle(p: Point): void {
    const diameter = this.stroke_width * this.scale_nodes_and_handles.get_value();
    if (diameter <= 0.0) return;
    const svgd =
      'M 0.7,0.35 A 0.35,0.35 0 0 1 0.35,0.7 0.35,0.35 0 0 1 0,0.35 0.35,0.35 0 0 1 0.35,0 0.35,0.35 0 0 1 0.7,0.35 Z';
    const m = Scale(diameter).multiply(Translate(p.sub(new Point(diameter * 0.35, diameter * 0.35))));
    this.outline_path.push((sp_svg_read_pathv(svgd)[0] as Path).transformed(m));
  }

  drawHandleLine(p: Point, p2_in: Point): void {
    let p2 = p2_in;
    const diameter = this.stroke_width * this.scale_nodes_and_handles.get_value();
    if (diameter > 0.0 && distance(p, p2) > diameter * 0.35) {
      const angle = Math.atan2(p2.y - p.y, p2.x - p.x);
      p2 = p2.sub(Point.polar(angle, diameter * 0.35));
    }
    const path = new Path(p);
    path.appendCurve(new LineSegment(p, p2));
    this.outline_path.push(path);
  }
}
