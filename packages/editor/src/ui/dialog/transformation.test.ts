// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/transformation.cpp, src/util/transform-objects.cpp
// @vitest-environment happy-dom
import { SPDocument, type SPItem } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { SPDesktop } from '../../desktop.ts';
import { Canvas } from '../widget/canvas.ts';
import { PageType, Transformation } from './transformation.ts';

SPDocument.scheduleIdle = () => {};

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect id="a" x="10" y="10" width="20" height="20"/><rect id="b" x="100" y="10" width="40" height="20"/>' +
  '<g id="g"><rect x="0" y="100" width="10" height="10"/></g></svg>';

function setup(...ids: string[]) {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const desktop = new SPDesktop(new Canvas(host), doc);
  doc.ensureUpToDate();
  const item = (id: string) => doc.getObjectById(id) as SPItem;
  desktop.getSelection().setList(ids.map(item));
  const t = new Transformation(desktop);
  const bounds = (id: string) => item(id).desktopGeometricBounds();
  return { doc, desktop, t, item, bounds };
}

describe('Transformation', () => {
  it('moves relative in the unit of the field, as one undo step "Move"', () => {
    const { doc, t, bounds } = setup('a');
    t.unitsMove.setUnit('mm');
    t.moveHorizontal.value = 10; // mm
    t.moveVertical.value = 5;
    t.apply(false);
    expect(bounds('a')?.left()).toBeCloseTo(10 + (10 * 96) / 25.4);
    expect(bounds('a')?.top()).toBeCloseTo(10 + (5 * 96) / 25.4);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Move');
  });

  it('shows the absolute position and moves to it', () => {
    const { t, bounds } = setup('a');
    t.moveRelative = false;
    t.onMoveRelativeToggled();
    // The fields show the position of the bounding box.
    expect([t.moveHorizontal.getValue('px'), t.moveVertical.getValue('px')]).toEqual([10, 10]);
    t.moveHorizontal.setValue(50, 'px');
    t.moveVertical.setValue(60, 'px');
    t.apply(false);
    expect([bounds('a')?.left(), bounds('a')?.top()]).toEqual([50, 60]);
  });

  it('moves objects by growing steps when applied separately', () => {
    const { desktop, t, bounds } = setup('a', 'b');
    t.applySeparately = true;
    t.moveHorizontal.setValue(10, 'px');
    t.apply(false);
    expect(desktop.getSelection().size()).toBe(2);
    expect(bounds('a')?.left()).toBe(20); // first step: 10
    expect(bounds('b')?.left()).toBe(120); // second step: 20
    t.applySeparately = false;
  });

  it('scales to a percentage and keeps the proportion', () => {
    const { doc, t, bounds } = setup('a');
    t.setPage(PageType.PAGE_SCALE);
    t.scaleProportional = true;
    t.scaleHorizontal.value = 200;
    t.onScaleXValueChanged();
    expect(t.scaleVertical.value).toBe(200);
    t.apply(false);
    expect(bounds('a')?.width()).toBeCloseTo(40);
    expect(bounds('a')?.height()).toBeCloseTo(40);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Scale');
  });

  it('converts a size in percent to px and back with the selection size', () => {
    const { t } = setup('b');
    t.setPage(PageType.PAGE_SCALE);
    t.scaleHorizontal.value = 50;
    t.unitsScale.setUnit('px');
    expect(t.scaleHorizontal.value).toBeCloseTo(20); // 50% of 40 px
    expect(t.scaleVertical.value).toBeCloseTo(20); // 100% of 20 px
    t.unitsScale.setUnit('%');
    expect(t.scaleHorizontal.value).toBeCloseTo(50);
  });

  it('rotates and skews the selection', () => {
    const { doc, t, bounds } = setup('a');
    t.setPage(PageType.PAGE_ROTATE);
    t.rotate.value = 90;
    t.apply(false);
    expect(bounds('a')?.width()).toBeCloseTo(20);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Rotate');

    t.setPage(PageType.PAGE_SKEW);
    t.skewHorizontal.value = 45;
    t.apply(false);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Skew');
    expect(bounds('a')?.width()).toBeGreaterThan(20.5);
  });

  it('applies a matrix by post-multiplying, or replaces the transform', () => {
    const { doc, t, item } = setup('g');
    t.setPage(PageType.PAGE_TRANSFORM);
    t.matrix.splice(0, 6, 2, 0, 0, 2, 0, 0);
    t.apply(false);
    expect(item('g').transform.c0).toBeCloseTo(2);
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Edit transformation matrix');

    // "Edit current matrix" shows the transform of the item; applying replaces it.
    t.replaceMatrix = true;
    t.onReplaceMatrixToggled();
    expect(t.matrix[0]).toBeCloseTo(2);
    t.matrix[0] = 3;
    t.apply(false);
    expect(item('g').transform.c0).toBeCloseTo(3);
  });

  it('refuses a singular matrix with a message and no undo step', () => {
    const { doc, t } = setup('a');
    t.setPage(PageType.PAGE_TRANSFORM);
    t.matrix.splice(0, 6, 0, 0, 0, 0, 0, 0);
    const steps = doc.undoStack.undo.length;
    t.apply(false);
    expect(t.message).toContain('singular');
    expect(doc.undoStack.undo.length).toBe(steps);
  });

  it('duplicates first when asked', () => {
    const { desktop, t, bounds } = setup('a');
    t.moveHorizontal.setValue(100, 'px');
    t.apply(true);
    expect(bounds('a')?.left()).toBe(10); // the original stays
    expect(desktop.getSelection().items()[0]?.desktopGeometricBounds()?.left()).toBe(110);
  });
});
