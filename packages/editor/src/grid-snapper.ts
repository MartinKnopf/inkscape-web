// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/grid-snapper.cpp, src/grid-snapper.h, src/helper/mathfns.h
/*
 * Grid Snapper for Rectangular and Axonometric Grids
 *
 * Authors: see git history
 *
 * Copyright (C) 2022 Authors
 * Copyright (C) Johan Engelen 2006-2007 <johan@shouraizou.nl>
 * Copyright (C) Lauris Kaplinski 2000
 */
import { GridType, Preferences, type SnapSourceType, SnapTargetType, type SPGrid } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { LineSnapper, type SnapLine } from './line-snapper.ts';
import type { SnapManager } from './snap.ts';
import { SnappedLine } from './snapped-line.ts';
import { SnappedPoint } from './snapped-point.ts';
import type { IntermSnapResults } from './snapper.ts';

/** x rounded to the lower multiple of c1 plus c0. */
export function round_to_lower_multiple_plus(x: number, c1: number, c0 = 0): number {
  return Math.floor((x - c0) / c1) * c1 + c0;
}

/** x rounded to the upper multiple of c1 plus c0. */
export function round_to_upper_multiple_plus(x: number, c1: number, c0 = 0): number {
  return Math.ceil((x - c0) / c1) * c1 + c0;
}

/**
 * The factor for the grid spacing so that the shown lines are at least 8 px
 * apart: first the major line interval, then factors of two.
 */
export function calculate_scaling_factor(length: number, major: number): number {
  let multiply = 1;
  let step = Math.max(major, 1);
  let watchdog = 0;
  while (length * multiply < 8.0 && watchdog < 100) {
    multiply *= step;
    // First pass, go up to the major line spacing, then keep increasing by two.
    step = 2;
    watchdog++;
  }
  return multiply;
}

/** The unit vector along the given axis. */
const basis = (dim: 0 | 1) => (dim === 0 ? new Point(1, 0) : new Point(0, 1));

/**
 * Snaps to the lines of a grid. With "snap to visible lines only", the
 * spacing grows like the shown grid when zoomed out.
 * TODO: axonometric grids (getSnapLinesAxonom).
 */
export class GridSnapper extends LineSnapper {
  readonly #grid: SPGrid;

  constructor(grid: SPGrid, sm: SnapManager) {
    super(sm);
    this.#grid = grid;
  }

  /** Snap tolerance (desktop coordinates); depends on current zoom so that it's always the same in screen pixels. */
  getSnapperTolerance(): number {
    return this._snapmanager.getSnapperTolerance(this._snapmanager.snapprefs.getGridTolerance());
  }

  getSnapperAlwaysSnap(_source: SnapSourceType): boolean {
    return Preferences.get().getBool('/options/snap/grid/always', false);
  }

  protected _getSnapLines(p: Point): SnapLine[] {
    if (!this._snapmanager.getNamedView() || !this.ThisSnapperMightSnap()) return [];
    switch (this.#grid.getType()) {
      case GridType.RECTANGULAR:
        return this.get_snap_lines(p, 0);
      case GridType.MODULAR:
        return this.get_snap_lines(p, 4);
      default:
        return []; // TODO: axonometric grids
    }
  }

  /** True if this Snapper will snap at least one kind of point. */
  override ThisSnapperMightSnap(): boolean {
    return (
      this._snap_enabled && this._snapmanager.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_GRID)
    );
  }

  /** The grid lines on both sides of p, in x and y; limit > 0: the rectangular grids of a modular grid. */
  get_snap_lines(p: Point, limit: number): SnapLine[] {
    const s: SnapLine[] = [];
    const desktop = this._snapmanager.getDesktop();
    const start = limit > 0 ? 0 : -1;
    for (let index = start; index < limit; ++index) {
      const { origin, spacing } = this.#grid.getEffectiveOriginAndSpacing(index);
      // empty spacing - skip this element
      if (spacing.isZero()) continue;
      for (const i of [0, 1] as const) {
        let scaled_spacing = spacing.at(i);
        if (this.getSnapVisibleOnly() && desktop) {
          // Only snap to visible grid lines.
          const sw = (i === 0 ? new Point(spacing.x, 0) : new Point(0, spacing.y)).transformed(
            desktop.d2w().withoutTranslation(),
          );
          scaled_spacing *= calculate_scaling_factor(sw.length(), this.#grid.getMajorLineInterval());
        }
        const b = basis(i);
        s.push([b, b.mul(round_to_upper_multiple_plus(p.at(i), scaled_spacing, origin.at(i)))]);
        s.push([b, b.mul(round_to_lower_multiple_plus(p.at(i), scaled_spacing, origin.at(i)))]);
      }
    }
    return s;
  }

  protected _addSnappedLine(
    isr: IntermSnapResults,
    snapped_point: Point,
    snapped_distance: number,
    source: SnapSourceType,
    source_num: number,
    normal_to_line: Point,
    point_on_line: Point,
  ): void {
    isr.grid_lines.push(
      new SnappedLine(
        snapped_point,
        snapped_distance,
        source,
        source_num,
        SnapTargetType.SNAPTARGET_GRID,
        this.getSnapperTolerance(),
        this.getSnapperAlwaysSnap(source),
        normal_to_line,
        point_on_line,
      ),
    );
  }

  protected _addSnappedPoint(
    isr: IntermSnapResults,
    snapped_point: Point,
    snapped_distance: number,
    source: SnapSourceType,
    source_num: number,
    constrained_snap: boolean,
  ): void {
    this.#addPoint(
      isr,
      snapped_point,
      snapped_distance,
      source,
      source_num,
      constrained_snap,
      SnapTargetType.SNAPTARGET_GRID,
    );
  }

  protected _addSnappedLinePerpendicularly(
    isr: IntermSnapResults,
    snapped_point: Point,
    snapped_distance: number,
    source: SnapSourceType,
    source_num: number,
    constrained_snap: boolean,
  ): void {
    this.#addPoint(
      isr,
      snapped_point,
      snapped_distance,
      source,
      source_num,
      constrained_snap,
      SnapTargetType.SNAPTARGET_GRID_PERPENDICULAR,
    );
  }

  #addPoint(
    isr: IntermSnapResults,
    p: Point,
    d: number,
    source: SnapSourceType,
    source_num: number,
    constrained_snap: boolean,
    target: SnapTargetType,
  ): void {
    isr.points.push(
      new SnappedPoint(
        p,
        source,
        source_num,
        target,
        d,
        this.getSnapperTolerance(),
        this.getSnapperAlwaysSnap(source),
        constrained_snap,
        true,
      ),
    );
  }
}
