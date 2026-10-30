// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/conn-avoid-ref.cpp, src/conn-avoid-ref.h
/*
 * A class for handling shape interaction with libavoid.
 *
 * Authors:
 *   Michael Wybrow <mjwybrow@users.sourceforge.net>
 *   Abhishek Sharma
 *
 * Copyright (C) 2005 Michael Wybrow
 */
import { type Affine, type Path, Point } from '@inkscape-web/geom';
import type { SPDocument } from './document.ts';
import { SPItem } from './object/sp-item.ts';
import { lpeItemClasses } from './object/sp-lpe-item.ts';
import type { SPObject } from './object/sp-object.ts';
import { pathBoolopBackendOrNull } from './path/path-boolop.ts';

/** The spacing around shapes that connectors avoid, in px (inkscape:connector-spacing default). */
export const defaultConnSpacing = 3.0;
export const defaultConnCurvature = 3.0;

/**
 * The libavoid router of a document (upstream Avoid::Router). Shapes and connectors are
 * named by integer ids. @inkscape-web/wasm implements it with upstream libavoid; the
 * path boolop backend creates it (see PathBoolopBackend.newAvoidRouter).
 */
export interface AvoidRouter {
  addShape(id: number, polygon: readonly number[]): void;
  moveShape(id: number, polygon: readonly number[]): void;
  deleteShape(id: number): void;
  addConnector(id: number, orthogonal: boolean): void;
  setRoutingType(id: number, orthogonal: boolean): void;
  setEndpoints(id: number, x0: number, y0: number, x1: number, y1: number): void;
  makePathInvalid(id: number): void;
  isInitialised(id: number): boolean;
  deleteConnector(id: number): void;
  processTransaction(): boolean;
  /** The connectors whose route changed in the transactions since the last call. */
  takeChanged(): number[];
  /** displayRoute(), curved with curvedPolyline(curvature) if curvature > 0. */
  route(id: number, curvature: number): { points: number[]; types: string };
  free(): void;
}

/** The router of a document, the next free id and the reroute callbacks of the connectors. */
interface RouterState {
  router: AvoidRouter;
  next_id: number;
  callbacks: Map<number, () => void>;
}
const routers = new WeakMap<SPDocument, RouterState | null>();

function routerState(doc: SPDocument): RouterState | null {
  let state = routers.get(doc);
  if (state === undefined) {
    const router = pathBoolopBackendOrNull()?.newAvoidRouter?.() ?? null;
    state = router ? { router, next_id: 1, callbacks: new Map() } : null;
    routers.set(doc, state);
  }
  return state;
}

/** The libavoid router of doc (upstream SPDocument::getRouter), or null without the WASM backend. */
export function getRouter(doc: SPDocument): AvoidRouter | null {
  return routerState(doc)?.router ?? null;
}

/** A new id for a shape or connector in the router of doc (upstream: the GQuark of the item id). */
export function new_avoid_id(doc: SPDocument): number {
  const state = routerState(doc);
  return state ? state.next_id++ : 0;
}

/** Set the callback that redraws connector id after a reroute (upstream ConnRef::setCallback). */
export function set_conn_callback(doc: SPDocument, id: number, callback: (() => void) | null): void {
  const state = routerState(doc);
  if (!state) return;
  if (callback) state.callbacks.set(id, callback);
  else state.callbacks.delete(id);
}

/**
 * Process the queued shape and connector changes (upstream Router::processTransaction) and run
 * the callbacks of the rerouted connectors. Returns whether any connector was rerouted.
 */
export function process_router_transaction(doc: SPDocument): boolean {
  const state = routers.get(doc);
  if (!state) return false;
  state.router.processTransaction();
  const changed = state.router.takeChanged();
  for (const id of changed) state.callbacks.get(id)?.();
  return changed.length > 0;
}

/** Free the router of doc (upstream: the router is deleted with the document). */
export function release_router(doc: SPDocument): void {
  routers.get(doc)?.router.free();
  routers.delete(doc);
}

/** Points along a path: the ends of straight segments, and 4 samples of each curve. */
function approxCurveWithPoints(paths: readonly Path[]): Point[] {
  // The number of segments to use for not straight curves approximation
  const NUM_SEGS = 4;
  const poly_points: Point[] = [];
  for (const path of paths) {
    const curves = path.curves();
    if (curves.length) poly_points.push(path.initialPoint());
    for (const c of curves) {
      if (c.isLineSegment()) poly_points.push(c.finalPoint());
      else for (let i = 1; i <= NUM_SEGS; i++) poly_points.push(c.pointAt(i / NUM_SEGS));
    }
  }
  return poly_points;
}

/** The points that outline item, in the coordinates of item_transform. */
function approxItemWithPoints(item: SPItem, item_transform: Affine): Point[] {
  const { SPGroup, SPShape } = lpeItemClasses;
  if (SPGroup && item instanceof SPGroup) {
    // consider all first-order children
    return item
      .item_list()
      .flatMap((child) => approxItemWithPoints(child, child.transform.multiply(item_transform)));
  }
  if (SPShape && item instanceof SPShape) {
    const curve = item.curve();
    // apply transformations (up to common ancestor)
    if (!curve) return [];
    return approxCurveWithPoints(curve.map((p) => p.transformed(item_transform)));
  }
  const bbox = item.documentPreferredBounds();
  return bbox ? [0, 1, 2, 3].map((i) => bbox.corner(i)) : [];
}

/** Upstream Geom::ConvexHull: the hull of the points, counterclockwise in y-up coordinates. */
function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The polygon that connectors avoid: the convex hull of the item in document coordinates,
 * enlarged by spacing (upstream avoid_item_poly). Flat list [x, y, x, y, ...].
 */
export function avoid_item_poly(item: SPItem): number[] {
  const spacing = item.document.getNamedView().connector_spacing;
  const hull = convexHull(approxItemWithPoints(item, item.i2docAffine()));
  if (hull.length < 3) return [];
  // Each edge moved outwards by spacing; the polygon corners are the crossings of neighbours.
  const n = hull.length;
  const offset = (i: number): [Point, Point] => {
    const a = hull[i]!;
    const b = hull[(i + 1) % n]!;
    const d = b.sub(a).normalized();
    // The hull runs counterclockwise (x right, y up), so the outside is on the right.
    const out = new Point(d.y, -d.x).mul(spacing);
    return [a.add(out), d];
  };
  const poly: number[] = [];
  for (let i = 0; i < n; i++) {
    const [p0, d0] = offset((i + n - 1) % n);
    const [p1, d1] = offset(i);
    const det = d0.x * d1.y - d0.y * d1.x;
    if (Math.abs(det) < 1e-12) {
      poly.push(p1.x, p1.y);
      continue;
    }
    const t = ((p1.x - p0.x) * d1.y - (p1.y - p0.y) * d1.x) / det;
    poly.push(p0.x + d0.x * t, p0.y + d0.y * t);
  }
  return poly;
}

/** Upstream avoid_item_move: tell libavoid the new geometry of a moved shape. */
export function avoid_item_move(_mp: Affine, moved_item: SPItem): void {
  const ref = moved_item.avoidRef as SPAvoidRef | null;
  const router = getRouter(moved_item.document);
  if (!ref?.shapeRef || !router) return;
  const poly = avoid_item_poly(moved_item);
  if (poly.length) router.moveShape(ref.shapeRef, poly);
}

/**
 * The items under from (entering layers) that are not locked or hidden; with initialised
 * only those that connectors avoid (upstream get_avoided_items). isLayer tells layers apart.
 */
export function get_avoided_items(
  from: SPObject,
  isLayer: (item: SPItem) => boolean,
  initialised = true,
): SPItem[] {
  const list: SPItem[] = [];
  const rec = (obj: SPObject) => {
    for (const child of obj.children) {
      if (!(child instanceof SPItem)) continue;
      const layer = isLayer(child);
      if (
        !layer &&
        !child.isLocked() &&
        !child.isHidden() &&
        (!initialised || (child.avoidRef as SPAvoidRef | null)?.shapeRef)
      ) {
        list.push(child);
      }
      if (layer) rec(child);
    }
  };
  rec(from);
  return list;
}

/**
 * The obstacle of an item for the connectors (upstream SPAvoidRef): with
 * inkscape:connector-avoid="true" the item is a libavoid shape that follows the item's
 * transforms.
 */
export class SPAvoidRef {
  /** libavoid's id of the item's shape, or null. */
  shapeRef: number | null = null;
  readonly item: SPItem;
  // true if avoiding, false if not.
  setting = false;
  new_setting = false;
  #disconnect_transformed: (() => void) | null = null;

  constructor(item: SPItem) {
    this.item = item;
  }

  release(): void {
    this.#disconnect_transformed?.();
    this.#disconnect_transformed = null;
    if (this.shapeRef) getRouter(this.item.document)?.deleteShape(this.shapeRef);
    this.shapeRef = null;
  }

  setAvoid(value: string | null): void {
    // Don't keep avoidance information for cloned objects.
    if (!this.item.cloned) this.new_setting = value === 'true';
  }

  handleSettingChange(): void {
    if (this.new_setting === this.setting) return; // Don't need to make any changes
    this.setting = this.new_setting;
    const router = getRouter(this.item.document);
    if (!router) return;
    this.#disconnect_transformed?.();
    this.#disconnect_transformed = null;
    if (this.new_setting) {
      const poly = avoid_item_poly(this.item);
      if (poly.length > 0) {
        this.#disconnect_transformed = this.item.transformedSignal.connect(avoid_item_move);
        this.shapeRef = new_avoid_id(this.item.document);
        router.addShape(this.shapeRef, poly);
      }
    } else if (this.shapeRef) {
      router.deleteShape(this.shapeRef);
      this.shapeRef = null;
    }
  }

  /** The point connectors attach to: the center of the visual bounds, in document coordinates. */
  getConnectionPointPos(): Point {
    // the center is all we are interested in now; we used to care
    // about non-center points, but that's moot.
    return this.item.documentVisualBounds()?.midpoint() ?? new Point(0, 0);
  }
}

SPItem.avoidRefFactory = (item) => new SPAvoidRef(item);
