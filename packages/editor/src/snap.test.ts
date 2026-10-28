// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/snap.cpp, src/grid-snapper.cpp, src/guide-snapper.cpp, src/object-snapper.cpp
// @vitest-environment happy-dom
import {
  GridType,
  SnapSourceType as S,
  SnapCandidatePoint,
  SPDocument,
  SPGrid,
  SPGuide,
  type SPItem,
  SnapTargetType as T,
} from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { beforeEach, describe, expect, it } from 'vitest';
import { set_snapping_globally } from './actions/actions-canvas-snapping.ts';
import { SPDesktop } from './desktop.ts';
import { PureTranslate } from './pure-transform.ts';
import { Canvas } from './ui/widget/canvas.ts';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <rect id="a" x="10" y="10" width="40" height="40"/>
  <rect id="b" x="200" y="200" width="50" height="30"/>
  <path id="p" d="M 300,300 L 400,350 L 380,450"/>
</svg>`;

/** A desktop at zoom 1 on an 800×600 canvas: desktop and window coordinates are the same. */
function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  const m = dt.getSnapManager();
  return { doc, dt, m, item: (id: string) => doc.getObjectById(id) as SPItem };
}

/** Free snap p with source type s; returns the snapped point and target. */
function snap(dt: SPDesktop, p: Point, s: S, ignore: SPItem | null = null) {
  const m = dt.getSnapManager();
  m.setup(dt, false, ignore);
  const sp = m.freeSnap(new SnapCandidatePoint(p, s));
  m.unSetup();
  return { snapped: sp.getSnapped(), point: sp.getPoint(), target: sp.getTarget() };
}

beforeEach(() => set_snapping_globally(true));

describe('SnapManager', () => {
  it('does not snap when snapping is off globally', () => {
    const { dt } = setup();
    set_snapping_globally(false);
    expect(snap(dt, new Point(52, 51), S.SNAPSOURCE_BBOX_CORNER).snapped).toBe(false);
  });

  it('snaps to the intersection of grid lines (grid snapper)', () => {
    const { dt, doc } = setup();
    const grid = SPGrid.create_new(doc, doc.getNamedView().getRepr(), GridType.RECTANGULAR);
    grid?.setSpacing(new Point(10, 10));
    const r = snap(dt, new Point(503.2, 517.9), S.SNAPSOURCE_NODE_CUSP);
    expect(r.point.equals(new Point(500, 520))).toBe(true);
    expect(r.target).toBe(T.SNAPTARGET_GRID_INTERSECTION);
  });

  it('snaps to a guide, and to the intersection of two guides (guide snapper)', () => {
    const { dt, doc } = setup();
    SPGuide.createSPGuide(doc, new Point(600, 0), new Point(600, 10)); // vertical at x = 600
    const line = snap(dt, new Point(604, 100), S.SNAPSOURCE_NODE_CUSP);
    expect(line.point.equals(new Point(600, 100))).toBe(true);
    expect(line.target).toBe(T.SNAPTARGET_GUIDE);
    SPGuide.createSPGuide(doc, new Point(0, 120), new Point(10, 120)); // horizontal at y = 120
    const cross = snap(dt, new Point(604, 115), S.SNAPSOURCE_NODE_CUSP);
    expect(cross.point.equals(new Point(600, 120))).toBe(true);
    expect(cross.target).toBe(T.SNAPTARGET_GUIDE_INTERSECTION);
  });

  it('snaps a bbox corner to the bbox corner of another item, not to nodes (object snapper)', () => {
    const { dt, item } = setup();
    const r = snap(dt, new Point(253, 197), S.SNAPSOURCE_BBOX_CORNER, item('a'));
    expect(r.target).toBe(T.SNAPTARGET_BBOX_CORNER);
    // the visual bbox: 50 × 30 plus a stroke of 0 (no stroke)
    expect(r.point.equals(new Point(250, 200))).toBe(true);
    // strict snapping: a bbox corner does not snap to path nodes
    expect(snap(dt, new Point(402, 352), S.SNAPSOURCE_BBOX_CORNER).target).not.toBe(T.SNAPTARGET_NODE_CUSP);
  });

  it('snaps a node to a cusp node of a path, and to the path between nodes', () => {
    const { dt } = setup();
    const node = snap(dt, new Point(403, 347), S.SNAPSOURCE_NODE_CUSP);
    expect(node.target).toBe(T.SNAPTARGET_NODE_CUSP);
    expect(node.point.equals(new Point(400, 350))).toBe(true);
    // near the first segment, 3 px off: snaps to the nearest point on the path
    const path = snap(dt, new Point(320, 313), S.SNAPSOURCE_NODE_CUSP);
    expect(path.target).toBe(T.SNAPTARGET_PATH);
    expect(path.point.x).toBeCloseTo(321.2);
    expect(path.point.y).toBeCloseTo(310.6);
  });

  it('snapTransformed() finds the translation that snaps one of the points', () => {
    const { dt, m, item } = setup();
    const corners = item('a')
      .desktopVisualBounds()
      ?.corners()
      .map((c) => new SnapCandidatePoint(c, S.SNAPSOURCE_BBOX_CORNER));
    // Move a (10..50) by (147, 152): its corner (50, 50) comes to (197, 202), near b's corner (200, 200).
    const t = new PureTranslate(new Point(147, 152));
    m.setup(dt, false, [item('a')]);
    m.snapTransformed(corners ?? [], new Point(30, 30), t);
    m.unSetup();
    expect(t.best_snapped_point.getSnapped()).toBe(true);
    expect(t.getTranslationSnapped().equals(new Point(150, 150))).toBe(true);
  });
});
