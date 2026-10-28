// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-shape.cpp, src/object/sp-shape.h
/*
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Abhishek Sharma
 *   Jon A. Cruz <jon@joncruz.org>
 *   Johan Engelen
 *
 * Copyright (C) 1999-2002 Lauris Kaplinski
 * Copyright (C) 2000-2001 Ximian, Inc.
 * Copyright (C) 1999-2012 Authors
 */
import {
  Affine,
  are_near,
  type Curve,
  L2,
  LineSegment,
  middle_point,
  type OptRect,
  type Path,
  PathVector,
  type Point,
} from '@inkscape-web/geom';
import type { Drawing, DrawingItem, DrawingShape } from '../display/drawing.ts';
import { SnapCandidatePoint } from '../snap-candidate.ts';
import { SnapSourceType, SnapTargetType } from '../snap-enums.ts';
import type { SnapPreferences } from '../snap-preferences.ts';
import { SPShapeRendering } from '../style-enums.ts';
import { BBoxType, SPItem } from './sp-item.ts';
import {
  SP_OBJECT_MODIFIED_FLAG,
  SP_OBJECT_PARENT_MODIFIED_FLAG,
  SP_OBJECT_STYLE_MODIFIED_FLAG,
  type SPCtx,
} from './sp-object.ts';

export const SP_SHAPE_WRITE_PATH = 1 << 2;

/**
 * Base class of shapes, including svg:path (upstream SPShape). The geometry is
 * the curve, a PathVector that is never changed in place: setCurve() replaces it.
 *
 * TODO: markers, LPE (curveBeforeLPE, update_patheffect), relative stroke units
 * (em, ex, %) in update(), path intersections as snap points, print, documentExactBounds.
 */
export class SPShape extends SPItem {
  // bbox cache
  bbox_geom_cache_is_valid = false;
  bbox_vis_cache_is_valid = false;
  bbox_geom_cache_transform = Affine.identity();
  bbox_vis_cache_transform = Affine.identity();
  bbox_geom_cache: OptRect = null;
  bbox_vis_cache: OptRect = null;

  protected _curve: PathVector | null = null;

  /** The curve, or null if there is none. Do not change it in place. */
  curve(): PathVector | null {
    return this._curve;
  }

  /** Set the curve and request a display update. */
  setCurve(newCurve: PathVector | null): void {
    this._curve = newCurve;
    if (newCurve && this.document) this.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
  }

  /** Same as setCurve() but without updating the display. */
  setCurveInsync(newCurve: PathVector | null): void {
    this._curve = newCurve;
  }

  /**
   * Set the computed curve of a shape (upstream prepareShapeForLPE). Without update, so that
   * set_shape() can be called from update(). TODO: LPE (curveBeforeLPE, the effects).
   */
  protected prepareShapeForLPE(c: Path | PathVector): void {
    this.setCurveInsync(Array.isArray(c) ? c : [c]);
  }

  /** Compute the curve from the attributes (rect, ellipse, …). Subclasses override it. */
  set_shape(): void {}

  protected override release(): void {
    this._curve = null;
    super.release();
  }

  protected override update(ctx: SPCtx, flags: number): void {
    // Any update can change the bounding box,
    // so the cached version can no longer be used.
    this.bbox_vis_cache_is_valid = false;
    this.bbox_geom_cache_is_valid = false;

    super.update(ctx, flags);

    if (flags & (SP_OBJECT_MODIFIED_FLAG | SP_OBJECT_PARENT_MODIFIED_FLAG)) {
      if (flags & SP_OBJECT_MODIFIED_FLAG) {
        for (const v of this.views) (v.drawingitem as DrawingShape).setPath(this._curve);
      }
    }
  }

  protected override modified(flags: number): void {
    super.modified(flags);
    if (flags & SP_OBJECT_STYLE_MODIFIED_FLAG) {
      for (const v of this.views) {
        if (this.parent) {
          this.context_style = this.parent.context_style;
          v.drawingitem.setStyle(this.style, this.context_style);
        }
      }
    }
    // TODO: update the filter regions.
  }

  override bbox(transform: Affine, bboxtype: BBoxType): OptRect {
    // If the object is clipped, the update function that invalidates
    // the cache doesn't get called if the object is moved, so we need
    // to compare the transformations as well.
    if (bboxtype === BBoxType.VISUAL_BBOX) {
      this.bbox_vis_cache = this.either_bbox(
        transform,
        bboxtype,
        this.bbox_vis_cache_is_valid,
        this.bbox_vis_cache,
        this.bbox_vis_cache_transform,
      );
      if (this.bbox_vis_cache) {
        this.bbox_vis_cache_transform = transform;
        this.bbox_vis_cache_is_valid = true;
      }
      return this.bbox_vis_cache;
    }
    this.bbox_geom_cache = this.either_bbox(
      transform,
      bboxtype,
      this.bbox_geom_cache_is_valid,
      this.bbox_geom_cache,
      this.bbox_geom_cache_transform,
    );
    if (this.bbox_geom_cache) {
      this.bbox_geom_cache_transform = transform;
      this.bbox_geom_cache_is_valid = true;
    }
    return this.bbox_geom_cache;
  }

  either_bbox(
    transform: Affine,
    bboxtype: BBoxType,
    cacheIsValid: boolean,
    bboxCache: OptRect,
    transformCache: Affine,
  ): OptRect {
    // Return the cache if possible.
    if (cacheIsValid && bboxCache) {
      const delta = transformCache.inverse().multiply(transform);
      if (delta.isTranslation()) {
        // Don't re-adjust the cache if we haven't moved
        if (!delta.isNonzeroTranslation()) return bboxCache;
        // delta is pure translation so it's safe to use it as is
        return bboxCache.transformed(delta);
      }
    }

    if (!this._curve || this._curve.length === 0) return null;

    let bbox = PathVector.boundsExact(PathVector.transformed(this._curve, transform));
    if (!bbox) return null;

    if (bboxtype === BBoxType.VISUAL_BBOX) {
      if (!this.style.stroke.isNone() && !this.style.stroke_extensions.hairline) {
        // TODO: upstream takes the bbox of the stroke outline (item_to_outline, livarot).
        // Until that is ported, expand by half the stroke width, scaled like the transform.
        const scale = transform.descrim();
        bbox = bbox.expandBy(0.5 * this.style.stroke_width.computed * scale);
      }
      // TODO: markers.
    }
    return bbox;
  }

  protected override show(drawing: Drawing, _key: number, _flags: number): DrawingItem {
    const s = drawing.createShape();
    s.setPath(this._curve);
    // TODO: markers (with them, context_style is the own style).
    if (this.parent) {
      this.context_style = this.parent.context_style;
      s.setStyle(this.style, this.context_style);
    }
    // apply 'shape-rendering' presentation attribute
    s.setAntialiasing(
      this.style.shape_rendering.computed !== SPShapeRendering.SP_CSS_SHAPE_RENDERING_CRISPEDGES,
    );
    return s;
  }

  // hide(): upstream hides the marker views. TODO: markers.

  /**
   * The nodes of the curve as snap points (cusp or smooth), line midpoints
   * and the object midpoint, as the snap preferences ask.
   * TODO: the self-intersections of each path (SNAPTARGET_PATH_INTERSECTION).
   */
  override snappoints(p: SnapCandidatePoint[], snapprefs: SnapPreferences): void {
    const pathv = this._curve;
    if (!pathv?.length) return;
    const i2dt = this.i2dtAffine();
    const add = (pt: Point, s: SnapSourceType, t: SnapTargetType) =>
      p.push(new SnapCandidatePoint(pt.transformed(i2dt), s, t));
    if (snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_OBJECT_MIDPOINT)) {
      const bbox = this.desktopVisualBounds();
      if (bbox) {
        p.push(
          new SnapCandidatePoint(
            bbox.midpoint(),
            SnapSourceType.SNAPSOURCE_OBJECT_MIDPOINT,
            SnapTargetType.SNAPTARGET_OBJECT_MIDPOINT,
          ),
        );
      }
    }
    const cusp = snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_NODE_CUSP);
    const smooth = snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_NODE_SMOOTH);
    const midpoints = snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_LINE_MIDPOINT);
    for (const path_it of pathv) {
      // Add the first point of the path
      if (cusp)
        add(path_it.initialPoint(), SnapSourceType.SNAPSOURCE_NODE_CUSP, SnapTargetType.SNAPTARGET_NODE_CUSP);
      // Only the stroked part (end_default): the closing segment is included if it is not degenerate.
      const curves = path_it.closed() ? path_it.curves() : path_it.openCurves();
      curves.forEach((curve_it1, i) => {
        // For each path: consider midpoints of line segments for snapping
        if (midpoints && curve_it1 instanceof LineSegment) {
          add(
            middle_point(curve_it1.initialPoint(), curve_it1.finalPoint()),
            SnapSourceType.SNAPSOURCE_LINE_MIDPOINT,
            SnapTargetType.SNAPTARGET_LINE_MIDPOINT,
          );
        }
        const curve_it2 = curves[i + 1];
        if (!curve_it2) {
          // Add the last point of the path, but only for open paths
          // (for closed paths the first and last point will coincide)
          if (cusp && !path_it.closed())
            add(
              curve_it1.finalPoint(),
              SnapSourceType.SNAPSOURCE_NODE_CUSP,
              SnapTargetType.SNAPTARGET_NODE_CUSP,
            );
          return;
        }
        const nodetype = get_nodetype(curve_it1, curve_it2);
        if (nodetype === GeomNodeType.NODE_SMOOTH) {
          if (smooth)
            add(
              curve_it1.finalPoint(),
              SnapSourceType.SNAPSOURCE_NODE_SMOOTH,
              SnapTargetType.SNAPTARGET_NODE_SMOOTH,
            );
        } else if (nodetype === GeomNodeType.NODE_CUSP) {
          if (cusp)
            add(
              curve_it1.finalPoint(),
              SnapSourceType.SNAPSOURCE_NODE_CUSP,
              SnapTargetType.SNAPTARGET_NODE_CUSP,
            );
        }
      });
    }
  }
}

/** The type of the node between two curves (upstream Geom::NodeType without NODE_SYMM; renamed: xml NodeType exists). */
export enum GeomNodeType {
  NODE_NONE,
  NODE_CUSP,
  NODE_SMOOTH,
}

/** Unit tangent of c at t = 0 (forward) or t = 1 (backward); numeric, for any curve type. */
function unitTangentAt(c: Curve, t: 0 | 1): Point {
  for (const eps of [1e-6, 1e-3, 0.1]) {
    const d = t === 0 ? c.pointAt(eps).sub(c.pointAt(0)) : c.pointAt(1).sub(c.pointAt(1 - eps));
    if (L2(d) > 1e-12) return d.normalized();
  }
  return c.finalPoint().sub(c.initialPoint());
}

/** Whether the node between c_incoming and c_outgoing is smooth or a cusp (upstream Geom::get_nodetype). */
export function get_nodetype(c_incoming: Curve, c_outgoing: Curve): GeomNodeType {
  if (!are_near(c_incoming.pointAt(1), c_outgoing.pointAt(0))) return GeomNodeType.NODE_NONE;
  const deriv_1 = unitTangentAt(c_incoming, 1);
  const deriv_2 = unitTangentAt(c_outgoing, 0);
  const this_angle_L2 = L2(deriv_1);
  const next_angle_L2 = L2(deriv_2);
  const both_angles_L2 = L2(deriv_1.add(deriv_2));
  if (this_angle_L2 > 1e-6 && next_angle_L2 > 1e-6 && this_angle_L2 + next_angle_L2 - both_angles_L2 < 1e-3) {
    return GeomNodeType.NODE_SMOOTH;
  }
  return GeomNodeType.NODE_CUSP;
}
