// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object-snapper.cpp, src/object-snapper.h
/*
 *  Snapping things to objects.
 *
 * Authors:
 *   Carl Hetherington <inkscape@carlh.net>
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2005 - 2012 Authors
 */
import {
  BBoxType,
  Preferences,
  SnapSourceType as S,
  SnapCandidatePath,
  SnapCandidatePoint,
  type SPObject,
  SPPath,
  SPShape,
  SnapTargetType as T,
} from '@inkscape-web/core';
import {
  type Curve,
  curve_nearest_time,
  distance,
  L2,
  LineSegment,
  type OptRect,
  Path,
  Point,
  Rect,
  unit_vector,
} from '@inkscape-web/geom';
import { SnappedCurve } from './snapped-curve.ts';
import { SnappedPoint } from './snapped-point.ts';
import { type IntermSnapResults, lineIntersection, type SnapConstraint, Snapper } from './snapper.ts';

/** The closed outline of rect as an open path of four segments (upstream rect_to_open_path). */
function rect_to_open_path(rect: Rect): Path[] {
  const path = new Path(rect.corner(0));
  for (let i = 1; i <= 4; i++) path.appendCurve(new LineSegment(rect.corner(i - 1), rect.corner(i % 4)));
  return [path];
}

/**
 * Snaps to the nodes, paths and bounding boxes of the items near the point,
 * and to the page border.
 * TODO: text baselines, clipping paths and masks, tangential and perpendicular
 * snapping to paths, constrained snapping to circles, multiple pages.
 */
export class ObjectSnapper extends Snapper {
  #points_to_snap_to: SnapCandidatePoint[] = [];
  #paths_to_snap_to: SnapCandidatePath[] = [];

  getSnapperTolerance(): number {
    return this._snapmanager.getSnapperTolerance(this._snapmanager.snapprefs.getObjectTolerance());
  }

  getSnapperAlwaysSnap(_source: S): boolean {
    return Preferences.get().getBool('/options/snap/object/always', false);
  }

  #bboxType(...targets: T[]): BBoxType {
    // Determine the type of bounding box we should snap to
    if (this._snapmanager.snapprefs.isTargetSnappable(...targets)) {
      return Preferences.get().getBool('/tools/bounding_box')
        ? BBoxType.GEOMETRIC_BBOX
        : BBoxType.VISUAL_BBOX;
    }
    return BBoxType.GEOMETRIC_BBOX;
  }

  /**
   * Collect the points to snap to, for the first point only: with a whole bunch
   * of points to snap (e.g. when translating an item using the selector tool),
   * the collection is stored for later use.
   */
  #collectNodes(t: S, first_point: boolean): void {
    if (!first_point) return;
    this.#points_to_snap_to = [];
    const snapprefs = this._snapmanager.snapprefs;
    const bbox_type = this.#bboxType(
      T.SNAPTARGET_BBOX_CORNER,
      T.SNAPTARGET_BBOX_EDGE_MIDPOINT,
      T.SNAPTARGET_BBOX_MIDPOINT,
    );
    const p_is_a_node = !!(t & S.SNAPSOURCE_NODE_CATEGORY);
    const p_is_a_bbox = !!(t & S.SNAPSOURCE_BBOX_CATEGORY);
    const p_is_other = !!(t & S.SNAPSOURCE_OTHERS_CATEGORY || t & S.SNAPSOURCE_DATUMS_CATEGORY);

    // Consider the page border for snapping to
    const document = this._snapmanager.getDocument();
    for (const page of document?.getPageManager().getPages() ?? []) {
      if (page === this._snapmanager.getPageToIgnore()) continue;
      if (snapprefs.isTargetSnappable(T.SNAPTARGET_PAGE_EDGE_CORNER)) {
        getBBoxPoints(
          page.getDesktopRect(),
          this.#points_to_snap_to,
          S.SNAPSOURCE_PAGE_CORNER,
          T.SNAPTARGET_PAGE_EDGE_CORNER,
          S.SNAPSOURCE_UNDEFINED,
          T.SNAPTARGET_UNDEFINED, // No edges
          S.SNAPSOURCE_PAGE_CENTER,
          T.SNAPTARGET_PAGE_EDGE_CENTER,
        );
      }
    }
    if (document && snapprefs.isTargetSnappable(T.SNAPTARGET_PAGE_EDGE_CORNER)) {
      // Only the corners get added here.
      const page = document.preferredBounds().transformed(this._snapmanager.getDesktop().doc2dt());
      getBBoxPoints(
        page,
        this.#points_to_snap_to,
        S.SNAPSOURCE_UNDEFINED,
        T.SNAPTARGET_PAGE_EDGE_CORNER,
        S.SNAPSOURCE_UNDEFINED,
        T.SNAPTARGET_UNDEFINED,
        S.SNAPSOURCE_PAGE_CENTER,
        T.SNAPTARGET_PAGE_EDGE_CENTER,
      );
    }

    for (const candidate of this._snapmanager._obj_snapper_candidates) {
      const root_item = candidate.item;
      //Collect all nodes so we can snap to them
      if (p_is_a_node || p_is_other || (p_is_a_bbox && !snapprefs.getStrictSnapping())) {
        // We should not snap a transformation center to any of the centers of the items in the
        // current selection (see the comment in SelTrans::centerRequest())
        let prefs = snapprefs;
        if (
          snapprefs.isTargetSnappable(T.SNAPTARGET_ROTATION_CENTER) &&
          this._snapmanager.getRotationCenterSource().includes(root_item)
        ) {
          prefs = snapprefs.clone();
          prefs.setTargetSnappable(T.SNAPTARGET_ROTATION_CENTER, false);
        }
        root_item.getSnappoints(this.#points_to_snap_to, prefs);
      }
      //Collect the bounding box's corners so we can snap to them
      if (p_is_a_bbox || (!snapprefs.getStrictSnapping() && p_is_a_node) || p_is_other) {
        // Discard the bbox of a clipped path / mask, because we don't want to snap to both the bbox
        // of the item AND the bbox of the clipping path at the same time
        if (!candidate.clip_or_mask) {
          getBBoxPointsDefault(
            root_item.desktopBounds(bbox_type),
            this.#points_to_snap_to,
            snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_CORNER),
            snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_EDGE_MIDPOINT),
            snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_MIDPOINT),
          );
        }
      }
    }
  }

  /** Snap to the closest node (on the constraint, if there is one). */
  #snapNodes(
    isr: IntermSnapResults,
    p: SnapCandidatePoint,
    unselected_nodes: readonly SnapCandidatePoint[] | null,
    c: SnapConstraint | null = null,
    p_proj_on_constraint: Point | null = null,
  ): void {
    // Iterate through all nodes, find out which one is the closest to p, and snap to it!
    this.#collectNodes(p.getSourceType(), p.getSourceNum() <= 0);
    const targets = unselected_nodes?.length
      ? [...this.#points_to_snap_to, ...unselected_nodes]
      : this.#points_to_snap_to;
    let s: SnappedPoint | null = null;
    const strict_snapping = this._snapmanager.snapprefs.getStrictSnapping();
    for (const k of targets) {
      if (!allowSourceToSnapToTarget(p.getSourceType(), k.getTargetType(), strict_snapping)) continue;
      const target_pt = k.getPoint();
      let dist = L2(target_pt.sub(p.getPoint())); // Default: free (unconstrained) snapping
      if (c && !c.isUndefined() && p_proj_on_constraint) {
        // We're snapping to nodes along a constraint only, so find out if this node
        // is at the constraint, while allowing for a small margin
        if (L2(target_pt.sub(c.projection(target_pt))) > 1e-9) continue;
        dist = L2(target_pt.sub(p_proj_on_constraint));
      }
      if (dist < this.getSnapperTolerance() && dist < (s?.getSnapDistance() ?? Number.POSITIVE_INFINITY)) {
        s = new SnappedPoint(
          target_pt,
          p.getSourceType(),
          p.getSourceNum(),
          k.getTargetType(),
          dist,
          this.getSnapperTolerance(),
          this.getSnapperAlwaysSnap(p.getSourceType()),
          false,
          true,
          k.getTargetBBox(),
        );
      }
    }
    if (s) isr.points.push(s);
  }

  /** Collect the paths to snap to (document coordinates), for the first point only. */
  #collectPaths(source_type: S, first_point: boolean): void {
    if (!first_point) return;
    this.#paths_to_snap_to = [];
    const snapprefs = this._snapmanager.snapprefs;
    const bbox_type = this.#bboxType(T.SNAPTARGET_BBOX_EDGE);
    const p_is_a_node = !!(source_type & S.SNAPSOURCE_NODE_CATEGORY);
    const p_is_a_bbox = !!(source_type & S.SNAPSOURCE_BBOX_CATEGORY);
    const p_is_other = !!(
      source_type & S.SNAPSOURCE_OTHERS_CATEGORY || source_type & S.SNAPSOURCE_DATUMS_CATEGORY
    );
    const document = this._snapmanager.getDocument();
    const desktop = this._snapmanager.getDesktop();

    // Consider the page borders for snapping (the viewport when there are no pages)
    if (
      document &&
      snapprefs.isTargetSnappable(T.SNAPTARGET_PAGE_EDGE_BORDER) &&
      snapprefs.isAnyCategorySnappable()
    ) {
      const pm = document.getPageManager();
      const rects = pm.hasPages()
        ? pm.getPages().map((p) => p.getDocumentRect())
        : [document.preferredBounds()];
      for (const rect of rects) {
        this.#paths_to_snap_to.push(
          new SnapCandidatePath(rect_to_open_path(rect), T.SNAPTARGET_PAGE_EDGE_BORDER, null),
        );
      }
    }

    for (const candidate of this._snapmanager._obj_snapper_candidates) {
      const root_item = candidate.item;
      //Add the item's path to snap to
      if (
        snapprefs.isTargetSnappable(T.SNAPTARGET_PATH, T.SNAPTARGET_PATH_INTERSECTION) &&
        (p_is_other || p_is_a_node || (!snapprefs.getStrictSnapping() && p_is_a_bbox)) &&
        root_item instanceof SPShape
      ) {
        // Snapping for example to a traced bitmap is very stressing for
        // the CPU, so we'll only snap to paths having no more than 500 nodes
        const curve = root_item.curve();
        const very_complex_path =
          root_item instanceof SPPath && (curve?.reduce((n, p) => n + p.size(), 0) ?? 0) > 500;
        if (curve && !very_complex_path) {
          // All snapping calculations are done in desktop coordinates; the paths are in document coordinates
          const transform = root_item
            .i2dtAffine()
            .multiply(candidate.additional_affine)
            .multiply(desktop.dt2doc());
          this.#paths_to_snap_to.push(
            new SnapCandidatePath(
              curve.map((p) => p.transformed(transform)),
              T.SNAPTARGET_PATH,
              null,
            ),
          );
        }
      }
      //Add the item's bounding box to snap to
      if (
        snapprefs.isTargetSnappable(T.SNAPTARGET_BBOX_EDGE) &&
        (p_is_other || p_is_a_bbox || (!snapprefs.getStrictSnapping() && p_is_a_node)) &&
        !candidate.clip_or_mask
      ) {
        const rect = root_item.bounds(bbox_type, root_item.i2docAffine());
        if (rect) {
          this.#paths_to_snap_to.push(
            new SnapCandidatePath(
              rect_to_open_path(rect),
              T.SNAPTARGET_BBOX_EDGE,
              root_item.desktopBounds(bbox_type),
            ),
          );
        }
      }
    }
  }

  /** Snap to the nearest point of the paths within range. */
  #snapPaths(isr: IntermSnapResults, p: SnapCandidatePoint): void {
    this.#collectPaths(p.getSourceType(), p.getSourceNum() <= 0);
    const dt = this._snapmanager.getDesktop();
    const p_doc = p.getPoint().transformed(dt.dt2doc());
    const strict_snapping = this._snapmanager.snapprefs.getStrictSnapping();
    // num_path counts the paths over all path vectors
    let num_path = 0;
    for (const it_p of this.#paths_to_snap_to) {
      if (!allowSourceToSnapToTarget(p.getSourceType(), it_p.target_type, strict_snapping)) continue;
      for (const it_pv of it_p.path_vector) {
        // Find a nearest point for each curve within this path
        it_pv.curves().forEach((curve, index) => {
          const np = curve_nearest_time(p_doc, curve);
          const sp_doc = curve.pointAt(np);
          const dist = distance(sp_doc, p_doc);
          if (dist >= this.getSnapperTolerance()) return;
          // Add the curve we have snapped to
          let sp_tangent_dt = new Point(0, 0);
          if (p.getSourceType() === S.SNAPSOURCE_GUIDE_ORIGIN) {
            // We currently only use the tangent when snapping guides
            const e = 1e-4;
            const a = curve.pointAt(Math.max(0, np - e));
            const b = curve.pointAt(Math.min(1, np + e));
            sp_tangent_dt = unit_vector(b.sub(a)).transformed(dt.doc2dt().withoutTranslation());
          }
          isr.curves.push(
            new SnappedCurve(
              sp_doc.transformed(dt.doc2dt()),
              sp_tangent_dt,
              num_path,
              index,
              dist,
              this.getSnapperTolerance(),
              this.getSnapperAlwaysSnap(p.getSourceType()),
              false,
              curve,
              p.getSourceType(),
              p.getSourceNum(),
              it_p.target_type,
              it_p.target_bbox,
            ),
          );
        });
        num_path++;
      }
    }
  }

  /** Snap to the intersections of the constraint line with the paths within range. */
  #snapPathsConstrained(
    isr: IntermSnapResults,
    p: SnapCandidatePoint,
    c: SnapConstraint,
    p_proj_on_constraint: Point,
  ): void {
    this.#collectPaths(p.getSourceType(), p.getSourceNum() <= 0);
    // TODO: circular constraints.
    if (c.isCircular()) return;
    const dt = this._snapmanager.getDesktop();
    let direction_vector = c.getDirection();
    if (!direction_vector.isZero()) direction_vector = unit_vector(direction_vector);
    const tolerance = this.getSnapperTolerance();
    // The intersection point of the constraint line with any path, must lie within two points on the
    // SnapConstraint: p_min_on_cl and p_max_on_cl. The distance between those points is twice the snapping tolerance
    const dt2doc = dt.dt2doc();
    const p_min_on_cl = p_proj_on_constraint.sub(direction_vector.mul(tolerance)).transformed(dt2doc);
    const p_max_on_cl = p_proj_on_constraint.add(direction_vector.mul(tolerance)).transformed(dt2doc);
    const strict_snapping = this._snapmanager.snapprefs.getStrictSnapping();
    // Find all intersections of the constrained path with the snap target candidates
    for (const k of this.#paths_to_snap_to) {
      if (!allowSourceToSnapToTarget(p.getSourceType(), k.target_type, strict_snapping)) continue;
      for (const path of k.path_vector) {
        for (const curve of path.curves()) {
          for (const inter of curveSegmentIntersections(curve, p_min_on_cl, p_max_on_cl)) {
            // Convert to desktop coordinates
            const p_inters = inter.transformed(dt.doc2dt());
            const dist = L2(p.getPoint().sub(p_inters));
            // If the intersection is within snapping range, then we might snap to it
            if (dist > tolerance) continue;
            isr.points.push(
              new SnappedPoint(
                p_inters,
                p.getSourceType(),
                p.getSourceNum(),
                k.target_type,
                dist,
                tolerance,
                this.getSnapperAlwaysSnap(p.getSourceType()),
                true,
                false,
                k.target_bbox,
              ),
            );
          }
        }
      }
    }
  }

  override freeSnap(
    isr: IntermSnapResults,
    p: SnapCandidatePoint,
    bbox_to_snap: OptRect,
    it: readonly SPObject[] | null,
    unselected_nodes: readonly SnapCandidatePoint[] | null,
  ): void {
    if (!this._snap_enabled || !this._snapmanager.snapprefs.isSourceSnappable(p.getSourceType())) return;
    // Get a list of all the SPItems that we will try to snap to
    if (p.getSourceNum() <= 0) {
      const local_bbox_to_snap = bbox_to_snap ?? new Rect(p.getPoint(), p.getPoint());
      this._snapmanager._findCandidates(it, local_bbox_to_snap);
    }
    this.#snapNodes(isr, p, unselected_nodes);
    if (this.#snapToPaths()) this.#snapPaths(isr, p);
  }

  override constrainedSnap(
    isr: IntermSnapResults,
    p: SnapCandidatePoint,
    bbox_to_snap: OptRect,
    c: SnapConstraint,
    it: readonly SPObject[] | null,
    unselected_nodes: readonly SnapCandidatePoint[] | null,
  ): void {
    if (!this._snap_enabled || !this._snapmanager.snapprefs.isSourceSnappable(p.getSourceType())) return;
    // project the mouse pointer onto the constraint. Only the projected point will be considered for snapping
    const pp = c.projection(p.getPoint());
    if (p.getSourceNum() <= 0) {
      const local_bbox_to_snap = bbox_to_snap ?? new Rect(pp, pp); // Using the projected point here! Not so in freeSnap()!
      this._snapmanager._findCandidates(it, local_bbox_to_snap);
    }
    // A constrained snap, is a snap in only one degree of freedom (specified by the constraint line).
    this.#snapNodes(isr, p, unselected_nodes, c, pp);
    if (this.#snapToPaths()) this.#snapPathsConstrained(isr, p, c, pp);
  }

  #snapToPaths(): boolean {
    return this._snapmanager.snapprefs.isTargetSnappable(
      T.SNAPTARGET_PATH,
      T.SNAPTARGET_PATH_INTERSECTION,
      T.SNAPTARGET_BBOX_EDGE,
      T.SNAPTARGET_PAGE_EDGE_BORDER,
      T.SNAPTARGET_TEXT_BASELINE,
    );
  }
}

/** Bounding boxes will not snap to nodes/paths and vice versa, with strict snapping. */
function allowSourceToSnapToTarget(source: S, target: T, strict_snapping: boolean): boolean {
  if (!strict_snapping) return true;
  return !(
    (source & S.SNAPSOURCE_BBOX_CATEGORY && target & T.SNAPTARGET_NODE_CATEGORY) ||
    (source & S.SNAPSOURCE_NODE_CATEGORY && target & T.SNAPTARGET_BBOX_CATEGORY)
  );
}

/**
 * The intersections of a curve with the segment a–b: exact for line
 * segments, by subdividing other curves into 64 line segments.
 */
function curveSegmentIntersections(curve: Curve, a: Point, b: Point): Point[] {
  const out: Point[] = [];
  const pieces = curve instanceof LineSegment ? 1 : 64;
  let prev = curve.pointAt(0);
  for (let i = 1; i <= pieces; i++) {
    const next = curve.pointAt(i / pieces);
    const x = lineIntersection(a, b.sub(a), prev, next.sub(prev));
    if (x && onSegment(x, a, b) && onSegment(x, prev, next)) out.push(x);
    prev = next;
  }
  return out;
}

function onSegment(x: Point, a: Point, b: Point): boolean {
  const eps = 1e-9 * Math.max(1, L2(b.sub(a)));
  return (
    x.x >= Math.min(a.x, b.x) - eps &&
    x.x <= Math.max(a.x, b.x) + eps &&
    x.y >= Math.min(a.y, b.y) - eps &&
    x.y <= Math.max(a.y, b.y) + eps
  );
}

/**
 * Add the corners, edge midpoints and midpoint of bbox to points, each with
 * its source and target type; a pair of undefined types leaves those points out.
 */
export function getBBoxPoints(
  bbox: OptRect,
  points: SnapCandidatePoint[],
  corner_src: S,
  corner_tgt: T,
  edge_src: S,
  edge_tgt: T,
  mid_src: S,
  mid_tgt: T,
): void {
  if (!bbox) return;
  // collect the corners of the bounding box
  for (let k = 0; k < 4; k++) {
    if (corner_src || corner_tgt)
      points.push(new SnapCandidatePoint(bbox.corner(k), corner_src, corner_tgt, -1, bbox));
    // optionally, collect the midpoints of the bounding box's edges too
    if (edge_src || edge_tgt) {
      const mid = bbox
        .corner(k)
        .add(bbox.corner((k + 1) % 4))
        .div(2);
      points.push(new SnapCandidatePoint(mid, edge_src, edge_tgt, -1, bbox));
    }
  }
  if (mid_src || mid_tgt) points.push(new SnapCandidatePoint(bbox.midpoint(), mid_src, mid_tgt, -1, bbox));
}

/** getBBoxPoints() with the default bbox source and target types for corners, edge midpoints and the midpoint. */
export function getBBoxPointsDefault(
  bbox: OptRect,
  points: SnapCandidatePoint[],
  corners: boolean,
  edges: boolean,
  midpoint: boolean,
): void {
  getBBoxPoints(
    bbox,
    points,
    corners ? S.SNAPSOURCE_BBOX_CORNER : S.SNAPSOURCE_UNDEFINED,
    corners ? T.SNAPTARGET_BBOX_CORNER : T.SNAPTARGET_UNDEFINED,
    edges ? S.SNAPSOURCE_BBOX_EDGE_MIDPOINT : S.SNAPSOURCE_UNDEFINED,
    edges ? T.SNAPTARGET_BBOX_EDGE_MIDPOINT : T.SNAPTARGET_UNDEFINED,
    midpoint ? S.SNAPSOURCE_BBOX_MIDPOINT : S.SNAPSOURCE_UNDEFINED,
    midpoint ? T.SNAPTARGET_BBOX_MIDPOINT : T.SNAPTARGET_UNDEFINED,
  );
}
