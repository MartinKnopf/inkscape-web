// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snap-preferences.cpp, src/snap-preferences.h
/*
 * Storing of snapping preferences.
 *
 * Authors:
 *   Diederik van Lierop <mail@diedenrezi.nl>
 *
 * Copyright (C) 2008 - 2011 Authors
 */
import { SnapSourceType as S, SimpleSnap, SnapTargetType as T } from './snap-enums.ts';

/**
 * The snap toggles (one per primary snap target), the global toggle and the
 * snap tolerances in screen px. Secondary targets without own toggle (e.g.
 * SNAPTARGET_GRID_INTERSECTION) follow their primary target, and the targets
 * of a category are only snappable if the category is on.
 */
export class SnapPreferences {
  /** -1: not set, else 0 or 1 (indexed by primary snap target). */
  readonly #active_snap_targets = new Array<number>(T.SNAPTARGET_MAX_ENUM_VALUE).fill(-1);
  /** Masks the toggles for specific tools: -1 off, 0 masked disabled, 1 masked enabled. */
  readonly #active_mask_targets = new Array<number>(T.SNAPTARGET_MAX_ENUM_VALUE).fill(-1);
  /** Toggles ALL snapping. */
  #snap_enabled_globally = true;
  /** Hold all snapping temporarily when the mouse is moving fast. */
  #snap_postponed_globally = false;
  /**
   * If enabled, then bbox corners will only snap to bboxes, and nodes will only snap to nodes and paths.
   * (snapping to grids and guides is not affected by this)
   */
  readonly #strict_snapping = true;
  readonly #simple_snapping = new Array<boolean>(SimpleSnap._MaxEnumValue).fill(false);
  #grid_tolerance = 10;
  #guide_tolerance = 20;
  #object_tolerance = 20;
  #alignment_tolerance = 5;
  #distribution_tolerance = 5;

  /** A copy (upstream copy construction), e.g. to disable targets locally. */
  clone(): SnapPreferences {
    const c = new SnapPreferences();
    c.#active_snap_targets.splice(0, Infinity, ...this.#active_snap_targets);
    c.#active_mask_targets.splice(0, Infinity, ...this.#active_mask_targets);
    c.#simple_snapping.splice(0, Infinity, ...this.#simple_snapping);
    c.#snap_enabled_globally = this.#snap_enabled_globally;
    c.#snap_postponed_globally = this.#snap_postponed_globally;
    c.#grid_tolerance = this.#grid_tolerance;
    c.#guide_tolerance = this.#guide_tolerance;
    c.#object_tolerance = this.#object_tolerance;
    c.#alignment_tolerance = this.#alignment_tolerance;
    c.#distribution_tolerance = this.#distribution_tolerance;
    return c;
  }

  get_simple_snap(option: SimpleSnap): boolean {
    return this.#simple_snapping[option] ?? false;
  }
  set_simple_snap(option: SimpleSnap, enable: boolean): void {
    this.#simple_snapping[option] = enable;
  }

  /** Needed because we cannot toggle the datum snap targets as a group. */
  isAnyDatumSnappable(): boolean {
    return this.isTargetSnappable(
      T.SNAPTARGET_GUIDE,
      T.SNAPTARGET_GRID,
      T.SNAPTARGET_PAGE_EDGE_BORDER,
      T.SNAPTARGET_PAGE_MARGIN_BORDER,
      T.SNAPTARGET_PAGE_BLEED_BORDER,
    );
  }

  isAnyCategorySnappable(): boolean {
    return (
      this.isTargetSnappable(
        T.SNAPTARGET_NODE_CATEGORY,
        T.SNAPTARGET_BBOX_CATEGORY,
        T.SNAPTARGET_OTHERS_CATEGORY,
      ) || this.isAnyDatumSnappable()
    );
  }

  setSnapEnabledGlobally(enabled: boolean): void {
    this.#snap_enabled_globally = enabled;
  }
  getSnapEnabledGlobally(): boolean {
    return this.#snap_enabled_globally;
  }
  setSnapPostponedGlobally(postponed: boolean): void {
    this.#snap_postponed_globally = postponed;
  }
  getSnapPostponedGlobally(): boolean {
    return this.#snap_postponed_globally;
  }
  getStrictSnapping(): boolean {
    return this.#strict_snapping;
  }

  getGridTolerance(): number {
    return this.#grid_tolerance;
  }
  getGuideTolerance(): number {
    return this.#guide_tolerance;
  }
  getObjectTolerance(): number {
    return this.#object_tolerance;
  }
  getAlignmentTolerance(): number {
    return this.#alignment_tolerance;
  }
  getDistributionTolerance(): number {
    return this.#distribution_tolerance;
  }
  setGridTolerance(val: number): void {
    this.#grid_tolerance = val;
  }
  setGuideTolerance(val: number): void {
    this.#guide_tolerance = val;
  }
  setObjectTolerance(val: number): void {
    this.#object_tolerance = val;
  }
  setAlignementTolerance(val: number): void {
    this.#alignment_tolerance = val;
  }
  setDistributionTolerance(val: number): void {
    this.#distribution_tolerance = val;
  }

  /**
   * Map a snap target to the index of its toggle (upstream _mapTargetToArrayIndex).
   * Secondary targets map to their primary target; always_on targets cannot be
   * toggled; group_on tells whether the category of the target is enabled.
   */
  #mapTargetToArrayIndex(target: T): { index: T; always_on: boolean; group_on: boolean } {
    if (
      target === T.SNAPTARGET_BBOX_CATEGORY ||
      target === T.SNAPTARGET_NODE_CATEGORY ||
      target === T.SNAPTARGET_OTHERS_CATEGORY ||
      target === T.SNAPTARGET_DATUMS_CATEGORY ||
      target === T.SNAPTARGET_ALIGNMENT_CATEGORY ||
      target === T.SNAPTARGET_DISTRIBUTION_CATEGORY
    ) {
      // These main targets should be handled separately, because otherwise we might call isTargetSnappable()
      // for them (to check whether the corresponding group is on) which would lead to an infinite recursive loop
      return { index: target, always_on: target === T.SNAPTARGET_DATUMS_CATEGORY, group_on: true };
    }
    if (target & T.SNAPTARGET_BBOX_CATEGORY) {
      // Only if the group with bbox sources/targets has been enabled, then we might snap to any of the bbox targets
      return {
        index: target,
        always_on: false,
        group_on: this.isTargetSnappable(T.SNAPTARGET_BBOX_CATEGORY),
      };
    }
    if (target & T.SNAPTARGET_NODE_CATEGORY) {
      // Only if the group with path/node sources/targets has been enabled, then we might snap to any of the nodes/paths
      const group_on = this.isTargetSnappable(T.SNAPTARGET_NODE_CATEGORY);
      const index =
        target === T.SNAPTARGET_RECT_CORNER
          ? T.SNAPTARGET_NODE_CUSP
          : target === T.SNAPTARGET_ELLIPSE_QUADRANT_POINT
            ? T.SNAPTARGET_NODE_SMOOTH
            : target === T.SNAPTARGET_PATH_GUIDE_INTERSECTION
              ? T.SNAPTARGET_PATH_INTERSECTION
              : target;
      return { index, always_on: false, group_on };
    }
    if (target & T.SNAPTARGET_DATUMS_CATEGORY) {
      // These snap targets cannot be disabled as part of a disabled group;
      // secondary targets ("without own toggle") are re-mapped to their primary target
      switch (target) {
        case T.SNAPTARGET_GRID_INTERSECTION:
        case T.SNAPTARGET_GRID_PERPENDICULAR:
          return { index: T.SNAPTARGET_GRID, always_on: false, group_on: true };
        case T.SNAPTARGET_GUIDE_INTERSECTION:
        case T.SNAPTARGET_GUIDE_ORIGIN:
        case T.SNAPTARGET_GUIDE_PERPENDICULAR:
          return { index: T.SNAPTARGET_GUIDE, always_on: false, group_on: true };
        case T.SNAPTARGET_PAGE_EDGE_CORNER:
        case T.SNAPTARGET_PAGE_EDGE_CENTER:
          return { index: T.SNAPTARGET_PAGE_EDGE_BORDER, always_on: false, group_on: true };
        case T.SNAPTARGET_PAGE_MARGIN_CORNER:
        case T.SNAPTARGET_PAGE_MARGIN_CENTER:
          return { index: T.SNAPTARGET_PAGE_MARGIN_BORDER, always_on: false, group_on: true };
        case T.SNAPTARGET_PAGE_BLEED_CORNER:
          return { index: T.SNAPTARGET_PAGE_BLEED_BORDER, always_on: false, group_on: true };
        case T.SNAPTARGET_GRID_GUIDE_INTERSECTION:
          return { index: target, always_on: true, group_on: true }; // Doesn't have it's own button
        default:
          return { index: target, always_on: false, group_on: true };
      }
    }
    if (target & T.SNAPTARGET_ALIGNMENT_CATEGORY) {
      return {
        index: target,
        always_on: false,
        group_on: this.isTargetSnappable(T.SNAPTARGET_ALIGNMENT_CATEGORY),
      };
    }
    if (target & T.SNAPTARGET_DISTRIBUTION_CATEGORY) {
      return {
        index: target,
        always_on: false,
        group_on: this.isTargetSnappable(T.SNAPTARGET_DISTRIBUTION_CATEGORY),
      };
    }
    if (target & T.SNAPTARGET_OTHERS_CATEGORY) {
      // Only if the group with "other" snap sources/targets has been enabled, then we might snap to any of those targets
      const group_on = this.isTargetSnappable(T.SNAPTARGET_OTHERS_CATEGORY);
      switch (target) {
        case T.SNAPTARGET_TEXT_ANCHOR:
          return { index: T.SNAPTARGET_TEXT_BASELINE, always_on: false, group_on };
        case T.SNAPTARGET_IMG_CORNER: // Doesn't have its own button, on if the group is on
          return { index: T.SNAPTARGET_OTHERS_CATEGORY, always_on: false, group_on };
        case T.SNAPTARGET_CONSTRAINED_ANGLE:
        case T.SNAPTARGET_CONSTRAINT:
          return { index: target, always_on: true, group_on }; // Doesn't have it's own button
        default:
          return { index: target, always_on: false, group_on };
      }
    }
    console.warn(`Snap-preferences warning: Snaptarget not handled (#${target})`);
    return { index: target, always_on: false, group_on: false };
  }

  /** Turn a primary snap target (one with its own toggle) on or off. */
  setTargetSnappable(target: T, enabled: boolean): void {
    const { index, always_on } = this.#mapTargetToArrayIndex(target);
    if (always_on) {
      // If true, then this snap target is always active and cannot be toggled
      console.warn(
        `Snap-preferences warning: Trying to enable/disable a snap target (#${index}) that's always on by definition`,
      );
    } else if (index === target) {
      // I.e. if it has not been re-mapped, then we have a primary target at hand
      this.#active_snap_targets[index] = enabled ? 1 : 0;
    } else {
      console.warn(
        `Snap-preferences warning: Trying to enable/disable a secondary snap target (#${index}); only primary targets can be set`,
      );
    }
  }

  /**
   * Set a target mask, which overrides the toggle of target: -1 means use user
   * settings (turn off mask), 0 means mask with disabled, 1 means mask with enabled.
   */
  setTargetMask(target: T, enabled = 1): void {
    this.#active_mask_targets[this.#mapTargetToArrayIndex(target).index] = enabled;
  }

  /** Set the mask of all targets (-1 turns off masking). */
  clearTargetMask(enabled = -1): void {
    this.#active_mask_targets.fill(enabled);
  }

  /** Whether any of the targets is snappable (its category is on and its toggle or mask is on). */
  isTargetSnappable(...targets: T[]): boolean {
    return targets.some((t) => this.#isTargetSnappable(t));
  }

  #isTargetSnappable(target: T): boolean {
    const { index, always_on, group_on } = this.#mapTargetToArrayIndex(target);
    // Check masking first, it over-rides even group_on
    const mask = this.#active_mask_targets[index] ?? -1;
    if (mask !== -1) return mask === 1;
    if (!group_on) return false;
    // If true, then this snap target is always active and cannot be toggled
    if (always_on) return true;
    const active = this.#active_snap_targets[index] ?? -1;
    if (active === -1) {
      // This happens if setTargetSnappable() has not been called for this parameter
      console.warn(`Snap-preferences warning: Using an uninitialized snap target setting (#${index})`);
    }
    return active === 1;
  }

  /** The state of the toggle button of a primary target. */
  isSnapButtonEnabled(target: T): boolean {
    const { index } = this.#mapTargetToArrayIndex(target);
    const active = this.#active_snap_targets[index] ?? -1;
    if (active === -1) {
      console.warn(`Snap-preferences warning: Using an uninitialized snap target setting (#${index})`);
    } else if (index === target) {
      return active === 1;
    } else {
      console.warn(
        `Snap-preferences warning: Trying to determine the button status of a secondary snap target (#${index}); However, only primary targets have a button`,
      );
    }
    return false;
  }

  /** The snap target that corresponds to a snap source. */
  source2target(source: S): T {
    switch (source) {
      case S.SNAPSOURCE_UNDEFINED:
        return T.SNAPTARGET_UNDEFINED;
      case S.SNAPSOURCE_BBOX_CATEGORY:
        return T.SNAPTARGET_BBOX_CATEGORY;
      case S.SNAPSOURCE_BBOX_CORNER:
        return T.SNAPTARGET_BBOX_CORNER;
      case S.SNAPSOURCE_BBOX_MIDPOINT:
        return T.SNAPTARGET_BBOX_MIDPOINT;
      case S.SNAPSOURCE_BBOX_EDGE_MIDPOINT:
        return T.SNAPTARGET_BBOX_EDGE_MIDPOINT;
      case S.SNAPSOURCE_NODE_CATEGORY:
        return T.SNAPTARGET_NODE_CATEGORY;
      case S.SNAPSOURCE_NODE_SMOOTH:
        return T.SNAPTARGET_NODE_SMOOTH;
      case S.SNAPSOURCE_NODE_CUSP:
        return T.SNAPTARGET_NODE_CUSP;
      case S.SNAPSOURCE_LINE_MIDPOINT:
        return T.SNAPTARGET_LINE_MIDPOINT;
      case S.SNAPSOURCE_PATH_INTERSECTION:
        return T.SNAPTARGET_PATH_INTERSECTION;
      case S.SNAPSOURCE_RECT_CORNER:
        return T.SNAPTARGET_RECT_CORNER;
      case S.SNAPSOURCE_ELLIPSE_QUADRANT_POINT:
        return T.SNAPTARGET_ELLIPSE_QUADRANT_POINT;
      case S.SNAPSOURCE_DATUMS_CATEGORY:
        return T.SNAPTARGET_DATUMS_CATEGORY;
      case S.SNAPSOURCE_GUIDE:
        return T.SNAPTARGET_GUIDE;
      case S.SNAPSOURCE_GUIDE_ORIGIN:
        return T.SNAPTARGET_GUIDE_ORIGIN;
      case S.SNAPSOURCE_OTHERS_CATEGORY:
        return T.SNAPTARGET_OTHERS_CATEGORY;
      case S.SNAPSOURCE_ROTATION_CENTER:
        return T.SNAPTARGET_ROTATION_CENTER;
      case S.SNAPSOURCE_OBJECT_MIDPOINT:
        return T.SNAPTARGET_OBJECT_MIDPOINT;
      case S.SNAPSOURCE_IMG_CORNER:
        return T.SNAPTARGET_IMG_CORNER;
      case S.SNAPSOURCE_TEXT_ANCHOR:
        return T.SNAPTARGET_TEXT_ANCHOR;
      case S.SNAPSOURCE_NODE_HANDLE:
      case S.SNAPSOURCE_OTHER_HANDLE:
      case S.SNAPSOURCE_CONVEX_HULL_CORNER:
        // For these snapsources there doesn't exist an equivalent snap target
        return T.SNAPTARGET_NODE_CATEGORY;
      case S.SNAPSOURCE_GRID_PITCH:
        return T.SNAPTARGET_GRID;
      case S.SNAPSOURCE_PAGE_CORNER:
        return T.SNAPTARGET_PAGE_EDGE_CORNER;
      case S.SNAPSOURCE_PAGE_CENTER:
        return T.SNAPTARGET_PAGE_EDGE_CENTER;
      case S.SNAPSOURCE_ALIGNMENT_CATEGORY:
        return T.SNAPTARGET_ALIGNMENT_CATEGORY;
      case S.SNAPSOURCE_ALIGNMENT_BBOX_CORNER:
        return T.SNAPTARGET_ALIGNMENT_BBOX_CORNER;
      case S.SNAPSOURCE_ALIGNMENT_BBOX_MIDPOINT:
        return T.SNAPTARGET_ALIGNMENT_BBOX_EDGE_MIDPOINT;
      case S.SNAPSOURCE_ALIGNMENT_BBOX_EDGE_MIDPOINT:
        return T.SNAPTARGET_ALIGNMENT_BBOX_EDGE_MIDPOINT;
      case S.SNAPSOURCE_ALIGNMENT_PAGE_CENTER:
        return T.SNAPTARGET_ALIGNMENT_PAGE_EDGE_CENTER;
      case S.SNAPSOURCE_ALIGNMENT_PAGE_CORNER:
        return T.SNAPTARGET_ALIGNMENT_PAGE_EDGE_CORNER;
      case S.SNAPSOURCE_ALIGNMENT_HANDLE:
        return T.SNAPTARGET_ALIGNMENT_HANDLE;
      default:
        console.warn(`Mapping of snap source to snap target undefined (#${source})`);
        return T.SNAPTARGET_UNDEFINED;
    }
  }

  isSourceSnappable(source: S): boolean {
    return this.isTargetSnappable(this.source2target(source));
  }
}
