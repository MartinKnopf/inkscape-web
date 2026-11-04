// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/algorithms/unclump.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../../document.ts';
import type { SPItem } from '../sp-item.ts';
import { unclump } from './unclump.ts';

SPDocument.scheduleIdle = () => {};

const rects = (xs: number[]) => {
  const body = xs.map((x, i) => `<rect id="r${i}" x="${x}" y="0" width="10" height="10"/>`).join('');
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return { doc, items: xs.map((_, i) => doc.getObjectById(`r${i}`) as SPItem) };
};
const left = (r: SPItem) => r.desktopVisualBounds()?.left() ?? Number.NaN;

describe('unclump', () => {
  it('leaves an even distribution unchanged', () => {
    const { doc, items } = rects([0, 30, 60]);
    unclump(items);
    doc.ensureUpToDate();
    expect(items.map(left)).toEqual([0, 30, 60]);
  });

  it('moves a clumped item away from its close neighbour and towards its far one', () => {
    // r1 is 5 px from r0 and 35 px from r2.
    const { doc, items } = rects([0, 15, 60]);
    unclump(items);
    doc.ensureUpToDate();
    const [x0, x1, x2] = items.map(left) as [number, number, number];
    // r1 is pushed by 0.3 * (20 - 5) from r0 and pulled by 0.35 * (35 - 20) towards r2.
    expect(x1 - x0).toBeCloseTo(15 + 4.5 + 5.25, 9);
    expect(x2).toBe(60);
  });
});
