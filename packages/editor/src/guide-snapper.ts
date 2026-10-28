// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/guide-snapper.cpp, src/guide-snapper.h
/*
 * Snapping things to guides.
 *
 * Authors:
 *   Carl Hetherington <inkscape@carlh.net>
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 1999-2008 Authors
 */
import { Preferences, SnapSourceType, SnapTargetType } from '@inkscape-web/core';
import type { Point } from '@inkscape-web/geom';
import { LineSnapper, type SnapLine } from './line-snapper.ts';
import { SnappedLine } from './snapped-line.ts';
import { SnappedPoint } from './snapped-point.ts';
import type { IntermSnapResults } from './snapper.ts';

/** Snaps to the guides of the namedview (and to their origins). */
export class GuideSnapper extends LineSnapper {
  /** Snap tolerance (desktop coordinates); depends on current zoom so that it's always the same in screen pixels. */
  getSnapperTolerance(): number {
    return this._snapmanager.getSnapperTolerance(this._snapmanager.snapprefs.getGuideTolerance());
  }

  getSnapperAlwaysSnap(source: SnapSourceType): boolean {
    if (source === SnapSourceType.SNAPSOURCE_GUIDE || source === SnapSourceType.SNAPSOURCE_GUIDE_ORIGIN) {
      return false; // Don't always snap to other guides
    }
    return Preferences.get().getBool('/options/snap/guide/always', false);
  }

  protected _getSnapLines(_p: Point): SnapLine[] {
    const nv = this._snapmanager.getNamedView();
    if (!nv || !this.ThisSnapperMightSnap()) return [];
    const guide_to_ignore = this._snapmanager.getGuideToIgnore();
    return nv.guides.filter((g) => g !== guide_to_ignore).map((g) => [g.getNormal(), g.getPoint()] as const);
  }

  override ThisSnapperMightSnap(): boolean {
    const nv = this._snapmanager.getNamedView();
    if (!nv) return false;
    return (
      this._snap_enabled &&
      this._snapmanager.snapprefs.isTargetSnappable(SnapTargetType.SNAPTARGET_GUIDE) &&
      nv.showguides.value
    );
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
    isr.guide_lines.push(
      new SnappedLine(
        snapped_point,
        snapped_distance,
        source,
        source_num,
        SnapTargetType.SNAPTARGET_GUIDE,
        this.getSnapperTolerance(),
        this.getSnapperAlwaysSnap(source),
        normal_to_line,
        point_on_line,
      ),
    );
  }

  protected override _addSnappedLinesOrigin(
    isr: IntermSnapResults,
    origin: Point,
    snapped_distance: number,
    source: SnapSourceType,
    source_num: number,
    constrained_snap: boolean,
  ): void {
    this.#addPoint(
      isr,
      origin,
      snapped_distance,
      source,
      source_num,
      constrained_snap,
      SnapTargetType.SNAPTARGET_GUIDE_ORIGIN,
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
      SnapTargetType.SNAPTARGET_GUIDE_PERPENDICULAR,
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
      SnapTargetType.SNAPTARGET_GUIDE,
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
