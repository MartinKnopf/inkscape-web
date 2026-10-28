// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snap.cpp, src/snap.h
/*
 * SnapManager class.
 *
 * Authors:
 *   Lauris Kaplinski <lauris@kaplinski.com>
 *   Frank Felfe <innerspace@iname.com>
 *   Nathan Hurst <njh@njhurst.com>
 *   Carl Hetherington <inkscape@carlh.net>
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 2006-2007 Johan Engelen <johan@shouraizou.nl>
 * Copyright (C) 2004      Nathan Hurst
 * Copyright (C) 1999-2012 Authors
 */
import {
  BBoxType,
  Preferences,
  SnapCandidateItem,
  SnapCandidatePoint,
  type SnapPreferences,
  SnapSourceType,
  SnapTargetType,
  type SPDocument,
  type SPGrid,
  SPGroup,
  SPGuide,
  SPItem,
  type SPNamedView,
  type SPObject,
} from '@inkscape-web/core';
import { angle_between, L2, type OptRect, Point, type Rect, rot90 } from '@inkscape-web/geom';
import type { SPDesktop } from './desktop.ts';
import { GridSnapper, round_to_lower_multiple_plus, round_to_upper_multiple_plus } from './grid-snapper.ts';
import { GuideSnapper } from './guide-snapper.ts';
import { ObjectSnapper } from './object-snapper.ts';
import type { PureTransform } from './pure-transform.ts';
import { getClosestCurve } from './snapped-curve.ts';
import { getClosestIntersectionSL, getClosestSL } from './snapped-line.ts';
import { getClosestSP, SnappedPoint } from './snapped-point.ts';
import { type IntermSnapResults, newIntermSnapResults, SnapConstraint, type Snapper } from './snapper.ts';

/**
 * Class to coordinate snapping operations (upstream SnapManager). Call
 * setup() before snapping and unSetup() after: setup() gives the desktop
 * and the objects to ignore (e.g. the items being dragged).
 *
 * The snap targets: guides (GuideSnapper), the grids of the namedview
 * (one GridSnapper per grid) and objects and the page (ObjectSnapper).
 * Upstream the namedview owns the snap manager; here the desktop does (see
 * SPDesktop.getSnapManager()).
 * TODO: alignment and distribution snapping, snap delay, path intersections.
 */
export class SnapManager {
  /** The (global) snapping preferences: toggles and tolerances. */
  readonly snapprefs: SnapPreferences;
  readonly guide: GuideSnapper;
  readonly object: ObjectSnapper;
  /** The items near the snapped point, collected by _findCandidates(). */
  _obj_snapper_candidates: SnapCandidateItem[] = [];

  readonly #grid_snappers = new WeakMap<SPGrid, GridSnapper>();
  #objects_to_ignore: SPObject[] = [];
  #rotation_center_source_items: SPItem[] = [];
  #desktop: SPDesktop | null = null;
  #snapindicator = true;
  #unselected_nodes: readonly SnapCandidatePoint[] | null = null;
  #findCandidates_already_called = false;

  constructor(preferences: SnapPreferences) {
    this.snapprefs = preferences;
    this.guide = new GuideSnapper(this);
    this.object = new ObjectSnapper(this);
  }

  /** All snappers: the grid snappers first, then guides and objects. */
  getSnappers(): Snapper[] {
    return [...this.getGridSnappers(), this.guide, this.object];
  }

  /** The snappers of the enabled and visible grids. */
  getGridSnappers(): Snapper[] {
    const nv = this.getNamedView();
    if (!nv || !this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_GRID)) return [];
    return nv.grids
      .filter((grid) => grid.isEnabled() && grid.isVisible())
      .map((grid) => this.#gridSnapper(grid));
  }

  /** The snapper of a grid (upstream SPGrid::snapper()), created lazily. */
  #gridSnapper(grid: SPGrid): GridSnapper {
    let snapper = this.#grid_snappers.get(grid);
    if (!snapper) {
      snapper = new GridSnapper(grid, this);
      this.#grid_snappers.set(grid, snapper);
    }
    snapper.setEnabled(grid.isEnabled());
    snapper.setSnapVisibleOnly(grid.getSnapToVisibleOnly());
    return snapper;
  }

  /**
   * Whether any snapper might snap. immediately: also false while snapping is
   * postponed (the mouse is moving fast).
   */
  someSnapperMightSnap(immediately = true): boolean {
    if (!this.snapprefs.getSnapEnabledGlobally()) return false;
    // If we're asking if some snapper might snap RIGHT NOW (without the snap being postponed)...
    if (immediately && this.snapprefs.getSnapPostponedGlobally()) return false;
    return this.getSnappers().some((s) => s.ThisSnapperMightSnap());
  }

  gridSnapperMightSnap(): boolean {
    if (!this.snapprefs.getSnapEnabledGlobally() || this.snapprefs.getSnapPostponedGlobally()) return false;
    return this.getGridSnappers().some((s) => s.ThisSnapperMightSnap());
  }

  /** Snap p freely; returns the snapped point, or p if it did not snap (upstream freeSnapReturnByRef). */
  freeSnapReturnByRef(p: Point, source_type: SnapSourceType, bbox_to_snap: OptRect = null): Point {
    const s = this.freeSnap(
      new SnapCandidatePoint(p, source_type, SnapTargetType.SNAPTARGET_PATH),
      bbox_to_snap,
    );
    return s.getPointIfSnapped(p);
  }

  /**
   * Try to snap a point to grids, guides or objects, in two degrees of freedom.
   * bbox_to_snap: the bounding box of all points that are snapped together
   * (for finding candidates). to_paths_only: only snap to points on paths.
   */
  freeSnap(p: SnapCandidatePoint, bbox_to_snap: OptRect = null, to_paths_only = false): SnappedPoint {
    if (!this.someSnapperMightSnap()) {
      return SnappedPoint.fromCandidate(
        p,
        SnapTargetType.SNAPTARGET_UNDEFINED,
        Number.POSITIVE_INFINITY,
        0,
        false,
        false,
        false,
      );
    }
    const isr = newIntermSnapResults();
    for (const snapper of this.getSnappers()) {
      snapper.freeSnap(isr, p, bbox_to_snap, this.#objects_to_ignore, this.#unselected_nodes);
    }
    return this.findBestSnap(p, isr, false, false, to_paths_only);
  }

  /** Remove the snap indicator if it shows a pre-snap. */
  hideSnapIndicator(): void {
    this.#desktop?.getSnapIndicator().remove_snaptarget(true);
  }

  /** Show where p would snap to, while hovering (setup() must have been called). */
  preSnap(p: SnapCandidatePoint, to_paths_only = false): void {
    if (!this.#snapindicator || !this.#desktop) return;
    this.#snapindicator = false; // prevent other methods from drawing a snap indicator; we want to control this here
    const s = this.freeSnap(p, null, to_paths_only);
    if (s.getSnapped()) this.#desktop.getSnapIndicator().set_new_snaptarget(s, true);
    else this.#desktop.getSnapIndicator().remove_snaptarget(true);
    this.#snapindicator = true; // restore the original value
  }

  /**
   * The multiple of the grid pitch nearest to the translation t, or t if
   * there is no grid to snap to (e.g. for Alt+drag in the selector tool).
   */
  multipleOfGridPitch(t: Point, origin: Point): Point {
    if (!this.snapprefs.getSnapEnabledGlobally() || this.snapprefs.getSnapPostponedGlobally()) return t;
    let nearest_multiple: Point | null = null;
    let nearest_distance = Number.POSITIVE_INFINITY;
    let bestSnappedPoint = new SnappedPoint(t);
    // It will snap to the grid for which we find the closest snap. This might be a different
    // grid than to which the objects were initially aligned.
    for (const grid of this.getNamedView()?.grids ?? []) {
      if (!grid.isEnabled() || !grid.isVisible()) continue;
      const snapper = this.#gridSnapper(grid);
      if (!snapper.ThisSnapperMightSnap()) continue;
      // To find the nearest multiple of the grid pitch for a given translation t, we
      // will use the grid snapper. Simply snapping the value t to the grid will do, but
      // only if the origin of the grid is at (0,0). If it's not then compensate for this
      // in the translation t
      const grid_origin = grid.getEffectiveOriginAndSpacing().origin;
      const t_offset = t.add(grid_origin);
      const isr = newIntermSnapResults();
      const candidate = new SnapCandidatePoint(t_offset, SnapSourceType.SNAPSOURCE_GRID_PITCH);
      snapper.freeSnap(isr, candidate, null);
      // Find the best snap for this grid, including intersections of the grid-lines
      const old_val = this.#snapindicator;
      this.#snapindicator = false;
      const s = this.findBestSnap(candidate, isr, false, true);
      this.#snapindicator = old_val;
      if (s.getSnapped() && s.getSnapDistance() < nearest_distance) {
        nearest_multiple = s.getPoint().sub(grid_origin);
        nearest_distance = s.getSnapDistance();
        bestSnappedPoint = s;
      }
    }
    if (nearest_multiple) {
      bestSnappedPoint.setPoint(origin.add(nearest_multiple));
      this.#desktop?.getSnapIndicator().set_new_snaptarget(bestSnappedPoint);
      return nearest_multiple;
    }
    return t;
  }

  /** Snap p along constraint; returns the snapped point or p projected onto the constraint. */
  constrainedSnapReturnByRef(
    p: Point,
    source_type: SnapSourceType,
    constraint: SnapConstraint,
    bbox_to_snap: OptRect = null,
  ): Point {
    // If we didn't snap, then we will return the point projected onto the constraint
    return this.constrainedSnap(new SnapCandidatePoint(p, source_type), constraint, bbox_to_snap).getPoint();
  }

  /**
   * Try to snap a point along a constraint line (one degree of freedom). If
   * it does not snap, the result is the projection on the constraint.
   */
  constrainedSnap(
    p: SnapCandidatePoint,
    constraint: SnapConstraint,
    bbox_to_snap: OptRect = null,
  ): SnappedPoint {
    // First project the mouse pointer onto the constraint
    const pp = constraint.projection(p.getPoint());
    const no_snap = new SnappedPoint(
      pp,
      p.getSourceType(),
      p.getSourceNum(),
      SnapTargetType.SNAPTARGET_CONSTRAINT,
      Number.POSITIVE_INFINITY,
      0,
      false,
      true,
      false,
    );
    // Always return point on constraint
    if (!this.someSnapperMightSnap()) return no_snap;

    if (Preferences.get().getBool('/options/snapmousepointer/value', false) && p.isSingleHandle()) {
      // Snapping the mouse pointer instead of the constrained position of the knot allows
      // to snap to things which don't intersect with the constraint line; this is basically
      // then just a freesnap with the constraint applied afterwards
      const result = this.freeSnap(p, bbox_to_snap);
      if (result.getSnapped()) {
        // only change the snap indicator if we really snapped to something
        if (this.#snapindicator) this.#desktop?.getSnapIndicator().set_new_snaptarget(result);
        // Apply the constraint
        result.setPoint(constraint.projection(result.getPoint()));
        return result;
      }
      return no_snap;
    }

    const isr = newIntermSnapResults();
    for (const snapper of this.getSnappers()) {
      snapper.constrainedSnap(
        isr,
        p,
        bbox_to_snap,
        constraint,
        this.#objects_to_ignore,
        this.#unselected_nodes,
      );
    }
    const result = this.findBestSnap(p, isr, true);
    if (result.getSnapped()) {
      // only change the snap indicator if we really snapped to something
      if (this.#snapindicator) this.#desktop?.getSnapIndicator().set_new_snaptarget(result);
      return result;
    }
    return no_snap;
  }

  /**
   * Like constrainedSnap(), but with several constraints: snaps along the
   * constraint closest to p. dont_snap: only apply the constraint.
   */
  multipleConstrainedSnaps(
    p: SnapCandidatePoint,
    constraints: readonly SnapConstraint[],
    dont_snap = false,
    bbox_to_snap: OptRect = null,
  ): SnappedPoint {
    const no_snap = new SnappedPoint(
      p.getPoint(),
      p.getSourceType(),
      p.getSourceNum(),
      SnapTargetType.SNAPTARGET_CONSTRAINT,
      Number.POSITIVE_INFINITY,
      0,
      false,
      true,
      false,
    );
    const [first] = constraints;
    if (!first) return no_snap;
    // Project the mouse pointer on each of the constraints and select the closest constraint
    let cc = first;
    let best = first.projection(p.getPoint());
    for (const c of constraints) {
      const pp = c.projection(p.getPoint());
      if (L2(pp.sub(p.getPoint())) < L2(best.sub(p.getPoint()))) {
        best = pp; // Remember the projection onto the closest constraint
        cc = c; // Remember the closest constraint itself
      }
    }
    no_snap.setPoint(best);
    if (!this.someSnapperMightSnap() || dont_snap) return no_snap;

    let result: SnappedPoint;
    if (Preferences.get().getBool('/options/snapmousepointer/value', false) && p.isSingleHandle()) {
      // Snapping the mouse pointer instead of the constrained position of the knot; apply the constraint afterwards
      result = this.freeSnap(p, bbox_to_snap);
      result.setPoint(cc.projection(result.getPoint()));
    } else {
      // Try to snap along the closest constraint
      const isr = newIntermSnapResults();
      for (const snapper of this.getSnappers()) {
        snapper.constrainedSnap(isr, p, bbox_to_snap, cc, this.#objects_to_ignore, this.#unselected_nodes);
      }
      result = this.findBestSnap(p, isr, true);
    }
    return result.getSnapped() ? result : no_snap;
  }

  /**
   * Snap p to angles in steps of pi / snaps around o, relative to the
   * direction to p_ref (if given), and to objects along these directions.
   * snaps = 0 means a free snap.
   */
  constrainedAngularSnap(p: SnapCandidatePoint, p_ref: Point | null, o: Point, snaps: number): SnappedPoint {
    if (snaps <= 0) return this.freeSnap(p); // 0 means no angular snapping
    // p is at an arbitrary angle. Now we should snap this angle to specific increments.
    // For this we'll calculate the closest two angles, one at each side of the current angle
    const y_axis = new Point(0, 1);
    const angle = angle_between(y_axis, p.getPoint().sub(o));
    const angle_incr = Math.PI / snaps;
    const angle_offset = p_ref ? angle_between(y_axis, p_ref.sub(o)) : 0;
    const angle_ceil = round_to_upper_multiple_plus(angle, angle_incr, angle_offset);
    const angle_floor = round_to_lower_multiple_plus(angle, angle_incr, angle_offset);
    // We have two angles now. The constrained snapper will try each of them and return the closest
    const constraints = [angle_ceil, angle_floor].map((a) =>
      SnapConstraint.line(o, Point.polar(a - Math.PI / 2)),
    );
    // Constraints will always be applied, even if we didn't snap
    const sp = this.multipleConstrainedSnaps(p, constraints);
    // If we haven't snapped then we only had the constraint applied;
    if (!sp.getSnapped()) sp.setTarget(SnapTargetType.SNAPTARGET_CONSTRAINED_ANGLE);
    return sp;
  }

  /**
   * Snap a guide that is being dragged. origin true: origin_or_vector is the
   * origin of the guide, else its normal. Returns the snapped point, the new
   * origin or normal (the tangent of a curve snapped to, unless freeze_angle)
   * and whether that changed.
   */
  guideFreeSnap(
    p: Point,
    origin_or_vector: Point,
    origin: boolean,
    freeze_angle: boolean,
  ): { p: Point; origin_or_vector: Point; changed: boolean } {
    const none = { p, origin_or_vector, changed: false };
    if (
      !this.snapprefs.getSnapEnabledGlobally() ||
      this.snapprefs.getSnapPostponedGlobally() ||
      !this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_GUIDE)
    ) {
      return none;
    }
    let candidate: SnapCandidatePoint;
    if (origin) {
      candidate = new SnapCandidatePoint(p, SnapSourceType.SNAPSOURCE_GUIDE);
      candidate.addOrigin(origin_or_vector);
    } else {
      candidate = new SnapCandidatePoint(p, SnapSourceType.SNAPSOURCE_GUIDE_ORIGIN);
      candidate.addVector(rot90(origin_or_vector));
    }
    const isr = newIntermSnapResults();
    for (const snapper of this.getSnappers()) snapper.freeSnap(isr, candidate, null, null, null);
    const s = this.findBestSnap(candidate, isr, false);
    const snapped = s.getPointIfSnapped(p);
    // If the tangent has been set (it might not have been set if we snapped for example to a node),
    // then use it to update the normal of the guide
    if (!freeze_angle && s.getSnapped() && L2(s.getTangent()) > 1e-6) {
      return { p: snapped, origin_or_vector: rot90(s.getTangent()), changed: true };
    }
    return { p: snapped, origin_or_vector, changed: false };
  }

  /** Snap the origin p of a guide along the guide line. */
  guideConstrainedSnap(p: Point, guideline: SPGuide): Point {
    if (
      !this.snapprefs.getSnapEnabledGlobally() ||
      this.snapprefs.getSnapPostponedGlobally() ||
      !this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_GUIDE)
    ) {
      return p;
    }
    const candidate = new SnapCandidatePoint(p, SnapSourceType.SNAPSOURCE_GUIDE_ORIGIN);
    const cl = SnapConstraint.line(guideline.getPoint(), rot90(guideline.getNormal()));
    const isr = newIntermSnapResults();
    for (const snapper of this.getSnappers()) snapper.constrainedSnap(isr, candidate, null, cl, null, null);
    return this.findBestSnap(candidate, isr, false).getPointIfSnapped(p);
  }

  /**
   * Snap a set of points that are transformed by transform (e.g. the bbox
   * corners of the selection while it is moved); the snapped transform is
   * stored in transform. Shows one snap indicator for the best snap.
   */
  snapTransformed(points: readonly SnapCandidatePoint[], pointer: Point, transform: PureTransform): void {
    if (points.length === 0) {
      transform.best_snapped_point = new SnappedPoint(pointer);
      return;
    }
    // We will try to snap a set of points, but we don't want to have a snap indicator displayed
    // for each of them. That's why it's temporarily disabled here
    const orig_snapindicator_status = this.#snapindicator;
    this.#snapindicator = false;
    transform.snap(this, points, pointer);
    this.#snapindicator = orig_snapindicator_status;
    if (this.#snapindicator && this.#desktop) {
      if (transform.best_snapped_point.getSnapped()) {
        this.#desktop.getSnapIndicator().set_new_snaptarget(transform.best_snapped_point);
      } else {
        this.#desktop.getSnapIndicator().remove_snaptarget();
      }
    }
  }

  /**
   * Find the best snap of the intermediate results: the closest point, curve,
   * grid line or guide line, or (for free snaps) an intersection of grid or
   * guide lines. Only on-screen points within snapping range count.
   */
  findBestSnap(
    p: SnapCandidatePoint,
    isr: IntermSnapResults,
    constrained: boolean,
    allowOffScreen = false,
    to_path_only = false,
  ): SnappedPoint {
    // Store all snappoints
    const sp_list: SnappedPoint[] = [];
    // search for the closest snapped point
    const closestPoint = getClosestSP(isr.points);
    if (closestPoint) sp_list.push(closestPoint);
    // search for the closest snapped curve
    // We might have collected the paths only to snap to their intersection, without the intention to snap to the paths themselves
    const exclude_paths = !this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_PATH);
    const closestCurve = getClosestCurve(isr.curves, exclude_paths, to_path_only);
    if (closestCurve) sp_list.push(closestCurve);
    // search for the closest snapped grid line
    if (this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_GRID_LINE)) {
      const closestGridLine = getClosestSL(isr.grid_lines);
      if (closestGridLine) {
        closestGridLine.setSource(p.getSourceType());
        closestGridLine.setTarget(SnapTargetType.SNAPTARGET_GRID_LINE);
        sp_list.push(closestGridLine);
      }
    }
    // search for the closest snapped guide line
    const closestGuideLine = getClosestSL(isr.guide_lines);
    if (closestGuideLine) sp_list.push(closestGuideLine);

    // When freely snapping to a grid/guide/path, only one degree of freedom is eliminated
    // Therefore we will try get fully constrained by finding an intersection with another grid/guide/path
    // When doing a constrained snap however, we're already at an intersection of the constrained line and
    // the grid/guide/path we're snapping to.
    if (!constrained) {
      // TODO: intersections of curves (SNAPTARGET_PATH_INTERSECTION) and of guides with curves
      // (SNAPTARGET_PATH_GUIDE_INTERSECTION).
      const intersection = (sp: SnappedPoint | null, target: SnapTargetType) => {
        if (!sp) return;
        sp.setSource(p.getSourceType());
        sp.setTarget(target);
        sp_list.push(sp);
      };
      // search for the closest snapped intersection of grid lines
      intersection(getClosestIntersectionSL(isr.grid_lines), SnapTargetType.SNAPTARGET_GRID_INTERSECTION);
      // search for the closest snapped intersection of guide lines
      intersection(getClosestIntersectionSL(isr.guide_lines), SnapTargetType.SNAPTARGET_GUIDE_INTERSECTION);
      // search for the closest snapped intersection of grid with guide lines
      if (this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_GRID_GUIDE_INTERSECTION)) {
        intersection(
          getClosestIntersectionSL(isr.grid_lines, isr.guide_lines),
          SnapTargetType.SNAPTARGET_GRID_GUIDE_INTERSECTION,
        );
      }
    }

    // Filter out all snap targets that do NOT include a path; this is useful when we try to insert
    // a node in a path (on doubleclick in the node tool).
    const candidates = to_path_only ? sp_list.filter((sp) => sp.getOnPath()) : sp_list;

    // now let's see which snapped point gets a thumbs up
    let bestSnappedPoint = new SnappedPoint(p.getPoint());
    const display_area = this.#desktop?.get_display_area() ?? null;
    candidates.forEach((i, n) => {
      // Only snap to points which are not off the screen
      const onScreen = !display_area || display_area.contains(i.getPoint());
      if (!(onScreen || allowOffScreen)) return;
      // Only snap to points within snapping range
      if (!(i.getAlwaysSnap() || i.getSnapDistance() <= i.getTolerance())) return;
      // if it's the first point, or if it is closer than the best snapped point so far
      if (n === 0 || bestSnappedPoint.isOtherSnapBetter(i, false)) bestSnappedPoint = i;
    });

    // Update the snap indicator, if requested
    if (this.#snapindicator && this.#desktop) {
      if (bestSnappedPoint.getSnapped())
        this.#desktop.getSnapIndicator().set_new_snaptarget(bestSnappedPoint);
      else this.#desktop.getSnapIndicator().remove_snaptarget();
    }
    return bestSnappedPoint;
  }

  /**
   * Prepare for snapping: the desktop, whether to show the snap indicator, the
   * items not to snap to, and (node tool) the nodes that do not move.
   */
  setup(
    desktop: SPDesktop,
    snapindicator = true,
    objects_to_ignore: SPObject | readonly SPObject[] | null = null,
    unselected_nodes: readonly SnapCandidatePoint[] | null = null,
  ): void {
    if (this.#desktop) {
      console.warn(
        "The snapmanager has been set up before, but unSetup() hasn't been called afterwards. It possibly held invalid pointers",
      );
    }
    this.#objects_to_ignore = objects_to_ignore
      ? Array.isArray(objects_to_ignore)
        ? [...objects_to_ignore]
        : [objects_to_ignore as SPObject]
      : [];
    this.#desktop = desktop;
    this.#snapindicator = snapindicator;
    this.#unselected_nodes = unselected_nodes;
    this.#rotation_center_source_items = [];
    this.#findCandidates_already_called = false;
    this.#readTolerances();
  }

  /** setup(), taking the list of items to ignore from the desktop's selection. */
  setupIgnoreSelection(
    desktop: SPDesktop,
    snapindicator = true,
    unselected_nodes: readonly SnapCandidatePoint[] | null = null,
  ): void {
    this.setup(desktop, snapindicator, desktop.getSelection().items(), unselected_nodes);
  }

  /** Forget the setup. */
  unSetup(): void {
    this.#rotation_center_source_items = [];
    this.#desktop = null;
    this.#unselected_nodes = null;
    this.#objects_to_ignore = [];
  }

  /** Upstream SPNamedView::set() writes the tolerances to the snap preferences; here they are read at setup. */
  #readTolerances(): void {
    const nv = this.getNamedView();
    if (!nv) return;
    this.snapprefs.setGridTolerance(nv.grid_tolerance);
    this.snapprefs.setGuideTolerance(nv.guide_tolerance);
    this.snapprefs.setObjectTolerance(nv.object_tolerance);
    this.snapprefs.setAlignementTolerance(nv.alignment_tolerance);
    this.snapprefs.setDistributionTolerance(nv.distribution_tolerance);
  }

  /** The items whose rotation centers are being snapped (not to be snapped to). */
  setRotationCenterSource(items: readonly SPItem[]): void {
    this.#rotation_center_source_items = [...items];
  }
  getRotationCenterSource(): readonly SPItem[] {
    return this.#rotation_center_source_items;
  }

  getDesktop(): SPDesktop {
    if (!this.#desktop) throw new Error('SnapManager: setup() has not been called');
    return this.#desktop;
  }
  getNamedView(): SPNamedView | null {
    return this.#desktop?.getDocument().getNamedView() ?? null;
  }
  getDocument(): SPDocument | null {
    return this.#desktop?.getDocument() ?? null;
  }
  getUnselectedNodes(): readonly SnapCandidatePoint[] | null {
    return this.#unselected_nodes;
  }

  /** A tolerance in screen px as a distance in desktop coordinates. */
  getSnapperTolerance(tolerance: number): number {
    const zoom = this.#desktop ? this.#desktop.current_zoom() : 1;
    return tolerance / zoom;
  }

  /** Mark the location of the snap source, with /options/snapclosestonly/value. */
  displaySnapsource(p: SnapCandidatePoint): void {
    if (!Preferences.get().getBool('/options/snapclosestonly/value') || !this.#desktop) return;
    const t = p.getSourceType();
    const p_is_a_node = t & SnapSourceType.SNAPSOURCE_NODE_CATEGORY;
    const p_is_a_bbox = t & SnapSourceType.SNAPSOURCE_BBOX_CATEGORY;
    const p_is_other =
      t & SnapSourceType.SNAPSOURCE_OTHERS_CATEGORY || t & SnapSourceType.SNAPSOURCE_DATUMS_CATEGORY;
    const indicator = this.#desktop.getSnapIndicator();
    if (
      this.snapprefs.getSnapEnabledGlobally() &&
      (p_is_other ||
        (p_is_a_node && this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_NODE_CATEGORY)) ||
        (p_is_a_bbox && this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_BBOX_CATEGORY)))
    ) {
      indicator.set_new_snapsource(p);
    } else {
      indicator.remove_snapsource();
    }
  }

  getGuideToIgnore(): SPGuide | null {
    return (this.#objects_to_ignore.find((o) => o instanceof SPGuide) as SPGuide | undefined) ?? null;
  }

  /**
   * Collect the items within snapping range of bbox_to_snap (and on screen)
   * into _obj_snapper_candidates, skipping the items in it. Called once per setup().
   * TODO: clipping paths and masks, the 200 candidates limit, LPE boolops.
   */
  _findCandidates(it: readonly SPObject[] | null, bbox_to_snap: Rect): void {
    if (this.#findCandidates_already_called) return; // In case we have already been called by another snapper
    this.#findCandidates_already_called = true;
    this._obj_snapper_candidates = [];
    const doc = this.getDocument();
    if (!doc) return;
    const bbox_to_snap_incl = bbox_to_snap.expandBy(this.object.getSnapperTolerance()); // _incl means: will include the snapper tolerance
    const display_area = this.getDesktop().get_display_area();
    const prefs_bbox = Preferences.get().getBool('/tools/bounding_box', false);
    // We'll only need to obtain the visual bounding box if the user preferences tell
    // us to, AND if we are snapping to the bounding box itself.
    const bbox_type =
      !prefs_bbox && this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_BBOX_CATEGORY)
        ? BBoxType.VISUAL_BBOX
        : BBoxType.GEOMETRIC_BBOX;
    const visit = (parent: SPObject) => {
      for (const o of parent.children) {
        // Snapping to items in a locked layer is allowed
        // Don't snap to hidden objects
        if (!(o instanceof SPItem) || o.isHidden()) continue;
        /* See if this item is on the ignore list */
        if (it?.includes(o)) continue;
        if (o instanceof SPGroup) {
          visit(o);
          continue;
        }
        const bbox_of_item = o.desktopBounds(bbox_type);
        // See if the item is within range
        if (!bbox_of_item || !display_area.intersects(bbox_of_item)) continue;
        if (
          bbox_to_snap_incl.intersects(bbox_of_item) ||
          (this.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_ROTATION_CENTER) &&
            bbox_to_snap_incl.contains(o.getCenter()))
        ) {
          // This item is within snapping range, so record it as a candidate
          this._obj_snapper_candidates.push(new SnapCandidateItem(o, false));
        }
      }
    };
    visit(doc.getRoot());
  }
}
