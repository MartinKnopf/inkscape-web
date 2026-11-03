// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/knot/knot-holder.cpp (add_pattern_knotholder), src/ui/knot/knot-holder-entity.cpp
// @vitest-environment happy-dom
import type { SPPattern } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { createKnotHolder } from './shape-editor.ts';
import { setupDesktop } from './tools/tool-test-utils.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs>' +
  '<pattern id="p" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="5" height="5"/></pattern></defs>' +
  '<rect id="a" x="0" y="0" width="100" height="100" style="fill:url(#p)"/><rect id="b" width="10" height="10"/></svg>';

const NONE = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };

describe('pattern knots', () => {
  it('are only made for items with a pattern', () => {
    const { item, dt } = setupDesktop(SVG, 'Node');
    expect(createKnotHolder(item('b'), dt)).toBeNull();
    const holder = createKnotHolder(item('a'), dt)!;
    expect(holder.entity.length).toBe(3);
    // The knots sit on the cell in the middle of the item: origin, angle, scale.
    expect(holder.entity.map((e) => e.knot_get())).toEqual([
      new Point(50, 50),
      new Point(60, 50),
      new Point(60, 60),
    ]);
  });

  it('move, scale and rotate the pattern of the item (on its own linked pattern)', () => {
    const { item, dt, doc } = setupDesktop(SVG, 'Node');
    const a = item('a');
    const holder = createKnotHolder(a, dt)!;
    const [xy, angle, scale] = holder.entity;
    xy!.knot_set(new Point(53, 54), new Point(50, 50), NONE);
    const pattern = () => a.style.getFillPaintServer() as SPPattern;
    expect(pattern().getId()).not.toBe('p');
    expect(pattern().getTransform().translation().equals(new Point(3, 4))).toBe(true);

    scale!.knot_grabbed(new Point(63, 64), NONE);
    scale!.knot_set(new Point(73, 74), new Point(63, 64), NONE);
    doc.ensureUpToDate();
    // twice the size, the origin stays
    expect(pattern().getTransform().c0).toBeCloseTo(2, 9);
    expect(xy!.knot_get().x).toBeCloseTo(53, 9);

    angle!.knot_set(new Point(53, 74), new Point(73, 54), NONE);
    expect(pattern().getTransform().c1).toBeCloseTo(2, 9); // rotated by 90 degrees
    expect(doc.getObjectById('p')?.getAttribute('patternTransform')).toBeNull();
  });
});
