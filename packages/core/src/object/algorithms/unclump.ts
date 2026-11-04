// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/algorithms/unclump.cpp, src/object/algorithms/unclump.h
/*
 * Unclumping objects.
 *
 * Authors:
 *   bulia byak
 *   Jon A. Cruz <jon@joncruz.org>
 *   Abhishek Sharma
 *
 * Copyright (C) 2005 Authors
 * Released under GNU GPL v2+, read the file 'COPYING' for more information.
 */
import { L2, Point, Translate } from '@inkscape-web/geom';
import type { SPItem } from '../sp-item.ts';

class Unclump {
  // Taking bbox of an item is an expensive operation, and we need to do it many times, so here we
  // cache the centers, widths, and heights of items.
  readonly #c_cache = new Map<SPItem, Point>();
  readonly #wh_cache = new Map<SPItem, Point>();

  /** Center of bbox of item. */
  #unclump_center(item: SPItem): Point {
    const cached = this.#c_cache.get(item);
    if (cached) return cached;
    const r = item.desktopVisualBounds();
    if (!r) return new Point(0, 0); // FIXME
    const c = r.midpoint();
    this.#c_cache.set(item, c);
    return c;
  }

  #unclump_wh(item: SPItem): Point {
    const cached = this.#wh_cache.get(item);
    if (cached) return cached;
    const r = item.desktopVisualBounds();
    if (!r) return new Point(0, 0);
    const wh = r.dimensions();
    this.#wh_cache.set(item, wh);
    return wh;
  }

  /**
   * Distance between "edges" of item1 and item2. An item is considered to be an ellipse inscribed
   * into its w/h, so its radius (distance from center to edge) depends on the w/h and the angle
   * towards the other item. May be negative if the edge of item1 is between the center and the
   * edge of item2.
   */
  dist(item1: SPItem, item2: SPItem): number {
    const c1 = this.#unclump_center(item1);
    const c2 = this.#unclump_center(item2);
    const wh1 = this.#unclump_wh(item1);
    const wh2 = this.#unclump_wh(item2);

    // angle from each item's center to the other's, unsqueezed by its w/h, normalized to 0..pi/2
    let a1 = Math.abs(Math.atan2(c2.y - c1.y, ((c2.x - c1.x) * wh1.y) / wh1.x));
    if (a1 > Math.PI / 2) a1 = Math.PI - a1;
    let a2 = Math.abs(Math.atan2(c1.y - c2.y, ((c1.x - c2.x) * wh2.y) / wh2.x));
    if (a2 > Math.PI / 2) a2 = Math.PI - a2;

    // get the radius of each item for the given angle
    const r1 = 0.5 * (wh1.x + (wh1.y - wh1.x) * (a1 / (Math.PI / 2)));
    const r2 = 0.5 * (wh2.x + (wh2.y - wh2.x) * (a2 / (Math.PI / 2)));

    // dist between centers minus angle-adjusted radii
    const dist_r = L2(c2.sub(c1)) - r1 - r2;

    const stretch1 = wh1.y / wh1.x;
    const stretch2 = wh2.y / wh2.x;

    if ((stretch1 > 1.5 || stretch1 < 0.66) && (stretch2 > 1.5 || stretch2 < 0.66)) {
      // If both objects are not circle-like, find dists between four corners
      const closest_points = (ca: Point, wha: Point, cb: Point): [Point, Point] => {
        let y_closest: number;
        if (cb.y > ca.y + wha.y / 2) y_closest = ca.y + wha.y / 2;
        else if (cb.y < ca.y - wha.y / 2) y_closest = ca.y - wha.y / 2;
        else y_closest = cb.y;
        let x_closest: number;
        if (cb.x > ca.x + wha.x / 2) x_closest = ca.x + wha.x / 2;
        else if (cb.x < ca.x - wha.x / 2) x_closest = ca.x - wha.x / 2;
        else x_closest = cb.x;
        return [new Point(ca.x, y_closest), new Point(x_closest, ca.y)];
      };
      const c1_points = closest_points(c1, wh1, c2);
      const c2_points = closest_points(c2, wh2, c1);
      const dists = [dist_r];
      for (const p1 of c1_points) for (const p2 of c2_points) dists.push(L2(p1.sub(p2)));
      // return the minimum of all dists
      return Math.min(...dists);
    }
    return dist_r;
  }

  /** Average dist from item to others. */
  average(item: SPItem, others: SPItem[]): number {
    let n = 0;
    let sum = 0;
    for (const other of others) {
      if (other === item) continue;
      n++;
      sum += this.dist(item, other);
    }
    return n !== 0 ? sum / n : 0;
  }

  /** Closest to item among others. */
  closest(item: SPItem, others: SPItem[]): SPItem | null {
    let min = Number.POSITIVE_INFINITY;
    let closest: SPItem | null = null;
    for (const other of others) {
      if (other === item) continue;
      const dist = this.dist(item, other);
      if (dist < min && Math.abs(dist) < 1e6) {
        min = dist;
        closest = other;
      }
    }
    return closest;
  }

  /** Most distant from item among others. */
  farthest(item: SPItem, others: SPItem[]): SPItem | null {
    let max = Number.NEGATIVE_INFINITY;
    let farthest: SPItem | null = null;
    for (const other of others) {
      if (other === item) continue;
      const dist = this.dist(item, other);
      if (dist > max && Math.abs(dist) < 1e6) {
        max = dist;
        farthest = other;
      }
    }
    return farthest;
  }

  /**
   * The items of rest that are not "behind" closest as seen from item, i.e. not on the other side
   * of the line through closest perpendicular to the direction from item to closest.
   */
  unclump_remove_behind(item: SPItem, closest: SPItem, rest: SPItem[]): SPItem[] {
    const it = this.#unclump_center(item);
    const p1 = this.#unclump_center(closest);

    // perpendicular through closest to the direction to item:
    const perp = it.sub(p1).rot90();
    const p2 = p1.add(perp);

    // get the standard Ax + By + C = 0 form for p1-p2:
    const A = p1.y - p2.y;
    const B = p2.x - p1.x;
    const C = p2.y * p1.x - p1.y * p2.x;

    // substitute the item into it:
    const val_item = A * it.x + B * it.y + C;

    const out: SPItem[] = [];
    for (const other of rest) {
      if (other === item) continue;
      const o = this.#unclump_center(other);
      const val_other = A * o.x + B * o.y + C;
      // different signs mean that item and other are on the different sides of p1-p2 line; skip
      if (val_item * val_other > 1e-6) out.push(other);
    }
    return out;
  }

  /** Moves what away from from by dist. */
  push(from: SPItem, what: SPItem, dist: number): void {
    const it = this.#unclump_center(what);
    const p = this.#unclump_center(from);
    this.#move(what, it.sub(p).normalized().mul(dist));
  }

  /** Moves what towards to by dist. */
  pull(to: SPItem, what: SPItem, dist: number): void {
    const it = this.#unclump_center(what);
    const p = this.#unclump_center(to);
    this.#move(what, p.sub(it).normalized().mul(dist));
  }

  #move(what: SPItem, by: Point): void {
    const move = Translate(by);
    const c = this.#c_cache.get(what);
    if (c) this.#c_cache.set(what, c.transformed(move));
    what.setI2dAffine(what.i2dtAffine().multiply(move));
    what.doWriteTransform(what.transform);
  }
}

/**
 * Unclumps the items in items, reducing local unevenness in their distribution. Produces an
 * effect similar to "engraver dots". The only distribution which is unchanged by unclumping is a
 * hexagonal grid. May be called repeatedly for stronger effect.
 */
export function unclump(items: readonly SPItem[]): void {
  const unclump = new Unclump();

  for (const item of items) {
    // for each original/clone x:
    const nei: SPItem[] = [];
    let rest = items.filter((i) => i !== item);

    while (rest.length > 0) {
      const closest = unclump.closest(item, rest);
      if (!closest) break;
      nei.unshift(closest);
      rest = unclump.unclump_remove_behind(
        item,
        closest,
        rest.filter((i) => i !== closest),
      );
    }

    if (nei.length >= 2) {
      const ave = unclump.average(item, nei);
      const closest = unclump.closest(item, nei);
      const farthest = unclump.farthest(item, nei);
      if (!closest || !farthest) continue;
      const dist_closest = unclump.dist(closest, item);
      const dist_farthest = unclump.dist(farthest, item);

      // otherwise the items are bogus
      if (Math.abs(ave) < 1e6 && Math.abs(dist_closest) < 1e6 && Math.abs(dist_farthest) < 1e6) {
        // increase these coefficients to make unclumping more aggressive and less stable
        // the pull coefficient is a bit bigger to counteract the long-term expansion trend
        unclump.push(closest, item, 0.3 * (ave - dist_closest));
        unclump.pull(farthest, item, 0.35 * (dist_farthest - ave));
      }
    }
  }
}
