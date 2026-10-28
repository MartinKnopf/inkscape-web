// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/seltrans.cpp
// @vitest-environment happy-dom
import { DocumentUndo, SPDocument, type SPItem } from '@inkscape-web/core';
import { L2, Point, Rect, Rotate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDesktop } from './desktop.ts';
import { calcRotate, calcSkew, mod360symm } from './seltrans.ts';
import type { SelectTool } from './ui/tools/select-tool.ts';
import { Canvas } from './ui/widget/canvas.ts';

const NO_SNAP = { snap: false, snaps: 12 };
const SNAP = { snap: true, snaps: 12 };
const deg = (rad = 0) => rad * (180 / Math.PI);

describe('calcRotate', () => {
  const origin = new Point(20, 20);

  it('rotates the handle around the origin to the pointer direction', () => {
    const r = calcRotate(new Point(30, 20), new Point(20, 40), origin, NO_SNAP);
    expect(r?.radians).toBeCloseTo(Math.PI / 2);
    expect(r?.affine.equals(Rotate.from_degrees(90))).toBe(true);
    // The handle keeps its radius: it moves to (20, 30), not to the pointer.
    expect(r?.pt.x).toBeCloseTo(20);
    expect(r?.pt.y).toBeCloseTo(30);
  });

  it('snaps to multiples of pi / snaps', () => {
    // 25 degrees snaps to 30 degrees with 12 steps per half turn
    const pt = Point.polar((25 * Math.PI) / 180, 10).add(origin);
    expect(deg(calcRotate(new Point(30, 20), pt, origin, SNAP)?.radians)).toBeCloseTo(30);
    expect(deg(calcRotate(new Point(30, 20), pt, origin, NO_SNAP)?.radians)).toBeCloseTo(25);
  });

  it('rejects a handle or pointer on the origin', () => {
    expect(calcRotate(origin, new Point(30, 30), origin, NO_SNAP)).toBeNull();
    expect(calcRotate(new Point(30, 20), origin, origin, NO_SNAP)).toBeNull();
  });

  it('mod360symm maps to -180..180', () => {
    expect([mod360symm(270), mod360symm(-190), mod360symm(45)]).toEqual([-90, 170, 45]);
  });
});

describe('calcSkew', () => {
  // A bottom side handle at (20, 30) with the origin at the center (20, 20): horizontal skew.
  const origin = new Point(20, 20);

  it('shears along the side and keeps the other axis', () => {
    const r = calcSkew(new Point(20, 30), new Point(30, 30), origin, false, NO_SNAP);
    // x' = x + 1 * (y - 20): c2 = 1
    expect([r?.affine.c0, r?.affine.c1, r?.affine.c2, r?.affine.c3]).toEqual([1, 0, 1, 1]);
    expect(r?.radians).toBeCloseTo(Math.PI / 4);
    expect(r?.pt.x).toBeCloseTo(30);
  });

  it('snaps the angle', () => {
    // atan(0.5) = 26.6 degrees snaps to 30 degrees
    const r = calcSkew(new Point(20, 30), new Point(25, 30), origin, false, SNAP);
    expect(deg(r?.radians)).toBeCloseTo(30);
    expect(r?.affine.c2).toBeCloseTo(Math.tan(Math.PI / 6));
  });

  it('skews vertically on a side handle', () => {
    const r = calcSkew(new Point(30, 20), new Point(30, 25), origin, true, NO_SNAP);
    // y' = y + 0.5 * (x - 20): c1 = 0.5
    expect([r?.affine.c0, r?.affine.c1, r?.affine.c2, r?.affine.c3]).toEqual([1, 0.5, 0, 1]);
  });

  it('rejects a handle too close to the origin line', () => {
    const near = new Point(20, 20.0001);
    expect(calcSkew(near, new Point(30, 30), origin, false, { ...NO_SNAP, bbox_size: 10 })).toBeNull();
  });
});

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="a" x="10" y="10" width="20" height="20"/></svg>';

type Mods = { shiftKey?: boolean; altKey?: boolean };

function setup() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const dt = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  const a = doc.getObjectById('a') as SPItem;
  dt.getSelection().set(a);
  (dt.getTool() as SelectTool)._seltrans.increaseState();
  const controls = dt.getCanvas().controlsLayer;
  const knots = [...controls.querySelectorAll('.CanvasItemCtrl:not([visibility])')];
  return { doc, dt, a, knots };
}

/** The translation of a handle's path (its drawn position). */
function position(k: Element): Point {
  const m = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(
    k.querySelector('path')?.getAttribute('transform') ?? '',
  );
  return m ? new Point(Number(m[1]), Number(m[2])) : new Point(0, 0);
}

function pointer(target: Element, type: string, x: number, y: number, mods: Mods = {}) {
  const buttons = type === 'pointerup' ? 0 : 1;
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y, ...mods }),
  );
}

function drag(k: Element, dx: number, dy: number, mods: Mods = {}) {
  pointer(k, 'pointerdown', 100, 100, mods);
  pointer(k, 'pointermove', 100 + dx / 2, 100 + dy / 2, mods);
  pointer(k, 'pointermove', 100 + dx, 100 + dy, mods);
  pointer(k, 'pointerup', 100 + dx, 100 + dy, mods);
}

describe('SelTrans rotate state', () => {
  it('shows 4 rotate, 4 skew and the center handle', () => {
    expect(setup().knots).toHaveLength(9);
  });

  it('rotates around the center with Alt snapping and one undo step "Rotate"', () => {
    const { doc, a, knots } = setup();
    // The bottom right corner handle lies beyond (30, 30).
    const corner = knots.find((k) => position(k).x > 30 && position(k).y > 30);
    if (!corner) throw new Error('no corner handle');
    // From (30, 30) to (10, 30): 90 degrees around (20, 20).
    drag(corner, -20, 0, { altKey: true });
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Rotate']);
    doc.ensureUpToDate();
    // The rect keeps the rotation in its transform and the translation in x and y.
    expect(a.getAttribute('transform')).toBe('rotate(90)');
    expect(a.desktopGeometricBounds()?.equals(new Rect(10, 10, 30, 30))).toBe(true);
    DocumentUndo.undo(doc);
    expect(a.getAttribute('transform')).toBeNull();
  });

  it('skews with a side handle: undo step "Skew"', () => {
    const { doc, a, knots } = setup();
    // The bottom side handle lies below (20, 30).
    const side = knots.find((k) => position(k).y > 30 && Math.abs(position(k).x - 20) < 8);
    if (!side) throw new Error('no side handle');
    drag(side, 10, 0);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Skew']);
    doc.ensureUpToDate();
    // x' = x + (y - 20): the bounds grow from 10..30 to 0..40 in x.
    const b = a.desktopGeometricBounds();
    expect([b?.min().x, b?.min().y, b?.max().x, b?.max().y].map((v) => Math.round(v ?? 0) + 0)).toEqual([
      0, 10, 40, 30,
    ]);
  });

  it('moves the center (undo "Set center") and resets it with Shift+click ("Reset center")', () => {
    const { doc, a, knots } = setup();
    const c = new Point(20, 20);
    const center = knots.reduce((best, k) => (L2(position(k).sub(c)) < L2(position(best).sub(c)) ? k : best));
    drag(center, 10, 5);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Set center']);
    expect(a.getAttribute('inkscape:transform-center-x')).toBe('10');
    expect(a.getAttribute('inkscape:transform-center-y')).toBe('-5');
    expect(a.getCenter().equals(new Point(30, 25))).toBe(true);

    pointer(center, 'pointerdown', 100, 100, { shiftKey: true });
    pointer(center, 'pointerup', 100, 100, { shiftKey: true });
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Set center', 'Reset center']);
    expect(a.getAttribute('inkscape:transform-center-x')).toBeNull();
    expect(a.isCenterSet()).toBe(false);
  });
});
