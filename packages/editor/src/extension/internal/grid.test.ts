// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/grid.cpp, src/extension/internal/bluredge.cpp
// @vitest-environment happy-dom
import { Point, Rect } from '@inkscape-web/geom';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupDesktop, useWasmBackend } from '../../ui/tools/tool-test-utils.ts';
import { db } from '../db.ts';
import type { Effect } from '../effect.ts';
import { BlurEdge } from './bluredge.ts';
import { build_lines, Grid } from './grid.ts';

await useWasmBackend();

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="50">' +
  '<rect id="r" x="20" y="10" width="40" height="20" style="fill:#ff0000;stroke:none"/></svg>';

beforeAll(() => {
  Grid.init();
  BlurEdge.init();
});

describe('Grid', () => {
  it('draws vertical and horizontal lines at the spacing, shifted by the offset', () => {
    const d = build_lines(new Rect(new Point(0, 0), new Point(20, 10)), new Point(1, 2), new Point(10, 5));
    // Upstream compares start + offset with the end: x = 0, 10 (not 20) and y = 0, 5 (not 10).
    // The x offset moves the vertical lines, both offsets move the horizontal lines.
    expect(d).toBe('M 1,0 1,10 M 11,0 11,10 M 1,2 21,2 M 1,7 21,7');
  });

  it('adds one path with the grid to the current layer', async () => {
    const { doc, dt } = setupDesktop(SVG, 'Select');
    const effect = db.get('org.inkscape.effect.grid') as Effect;
    effect.set_param_float('xspacing', 25);
    effect.set_param_float('yspacing', 25);
    effect.set_param_float('lineWidth', 2);
    await effect.effect(dt);
    const path = [...doc.getReprRoot().children()].find((c) => c.name() === 'svg:path')!;
    expect(path.attribute('style')).toBe('fill:none;stroke:#000000;stroke-width:2px');
    // The page is 100 x 50: 5 vertical and 3 horizontal lines
    expect(path.attribute('d')?.match(/[Mm]/g)).toHaveLength(8);
  });
});

describe('BlurEdge', () => {
  it('replaces the selected object by a group of copies with a share of its opacity', async () => {
    const { doc, dt } = setupDesktop(SVG, 'Select');
    dt.getSelection().add(doc.getObjectById('r')!);
    const effect = db.get('org.inkscape.effect.bluredge') as Effect;
    effect.set_param_int('num-steps', 5);
    effect.set_param_float('blur-width', 4);
    await effect.effect(dt);
    const group = [...doc.getReprRoot().children()].find((c) => c.name() === 'svg:g')!;
    const copies = [...group.children()];
    expect(copies).toHaveLength(5);
    expect(copies.every((c) => c.name() === 'svg:path')).toBe(true);
    expect(copies[0]!.attribute('style')).toContain('opacity:0.2');
    // The outermost copy is wider than the original rectangle, the innermost narrower.
    const width = (i: number) => {
      const o = doc.getObjectByRepr(copies[i]!) as unknown as { desktopGeometricBounds(): Rect };
      return o.desktopGeometricBounds().width();
    };
    expect(width(0)).toBeLessThan(40);
    expect(width(4)).toBeGreaterThan(40);
  });
});
