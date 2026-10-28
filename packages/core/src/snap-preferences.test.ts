// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snap-preferences.cpp
import { describe, expect, it } from 'vitest';
import { SnapSourceType as S, SnapTargetType as T } from './snap-enums.ts';
import { SnapPreferences } from './snap-preferences.ts';

/** Preferences with the given primary targets on and the others off. */
function prefs(on: T[]): SnapPreferences {
  const p = new SnapPreferences();
  for (const t of [
    T.SNAPTARGET_BBOX_CATEGORY,
    T.SNAPTARGET_BBOX_CORNER,
    T.SNAPTARGET_NODE_CATEGORY,
    T.SNAPTARGET_NODE_CUSP,
    T.SNAPTARGET_OTHERS_CATEGORY,
    T.SNAPTARGET_GRID,
    T.SNAPTARGET_GUIDE,
  ]) {
    p.setTargetSnappable(t, on.includes(t));
  }
  return p;
}

describe('SnapPreferences', () => {
  it('needs the category for the targets of a category', () => {
    const p = prefs([T.SNAPTARGET_BBOX_CORNER]);
    expect(p.isTargetSnappable(T.SNAPTARGET_BBOX_CORNER)).toBe(false);
    p.setTargetSnappable(T.SNAPTARGET_BBOX_CATEGORY, true);
    expect(p.isTargetSnappable(T.SNAPTARGET_BBOX_CORNER)).toBe(true);
    expect(p.isSnapButtonEnabled(T.SNAPTARGET_BBOX_CORNER)).toBe(true);
  });

  it('maps secondary targets to their primary target', () => {
    const p = prefs([T.SNAPTARGET_NODE_CATEGORY, T.SNAPTARGET_NODE_CUSP, T.SNAPTARGET_GRID]);
    // a rect corner is a cusp node, a grid intersection belongs to the grid toggle
    expect(p.isTargetSnappable(T.SNAPTARGET_RECT_CORNER)).toBe(true);
    expect(p.isTargetSnappable(T.SNAPTARGET_GRID_INTERSECTION)).toBe(true);
    expect(p.isTargetSnappable(T.SNAPTARGET_GUIDE_ORIGIN)).toBe(false);
    // datums do not depend on a category, and the grid-guide intersection is always on
    expect(p.isTargetSnappable(T.SNAPTARGET_GRID_GUIDE_INTERSECTION)).toBe(true);
  });

  it('lets a mask override the toggles until it is cleared', () => {
    const p = prefs([T.SNAPTARGET_GRID]);
    p.clearTargetMask(0);
    p.setTargetMask(T.SNAPTARGET_GUIDE, 1);
    expect(p.isTargetSnappable(T.SNAPTARGET_GRID)).toBe(false);
    expect(p.isTargetSnappable(T.SNAPTARGET_GUIDE)).toBe(true);
    p.clearTargetMask();
    expect(p.isTargetSnappable(T.SNAPTARGET_GRID)).toBe(true);
    expect(p.isTargetSnappable(T.SNAPTARGET_GUIDE)).toBe(false);
  });

  it('snaps a source if its corresponding target is snappable', () => {
    const p = prefs([T.SNAPTARGET_BBOX_CATEGORY, T.SNAPTARGET_BBOX_CORNER]);
    expect(p.source2target(S.SNAPSOURCE_BBOX_CORNER)).toBe(T.SNAPTARGET_BBOX_CORNER);
    expect(p.isSourceSnappable(S.SNAPSOURCE_BBOX_CORNER)).toBe(true);
    expect(p.isSourceSnappable(S.SNAPSOURCE_NODE_CUSP)).toBe(false);
    // handles map to the node category
    expect(p.source2target(S.SNAPSOURCE_NODE_HANDLE)).toBe(T.SNAPTARGET_NODE_CATEGORY);
  });

  it('clone() is independent of the original', () => {
    const p = prefs([T.SNAPTARGET_GRID]);
    const c = p.clone();
    c.setTargetSnappable(T.SNAPTARGET_GRID, false);
    expect(p.isTargetSnappable(T.SNAPTARGET_GRID)).toBe(true);
    expect(c.isTargetSnappable(T.SNAPTARGET_GRID)).toBe(false);
  });
});
