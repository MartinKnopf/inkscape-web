// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment happy-dom
import { Affine, Point, Scale } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { Canvas } from './canvas.ts';

describe('Canvas', () => {
  it('builds svg > world group > desktop and controls layers', () => {
    const host = document.createElement('div');
    const canvas = new Canvas(host);
    expect(host.firstElementChild).toBe(canvas.svg);
    const world = canvas.svg.firstElementChild;
    expect(world?.tagName.toLowerCase()).toBe('g');
    expect([...(world?.children ?? [])]).toEqual([canvas.desktopLayer, canvas.controlsLayer]);
  });

  it('maps desktop to world by the affine and world to window by the position', () => {
    const host = document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const canvas = new Canvas(host);
    canvas.set_affine(Scale(2, 2));
    canvas.set_pos(new Point(10.4, -20.6)); // rounded like upstream
    expect(canvas.svg.firstElementChild?.getAttribute('transform')).toBe('matrix(1,0,0,1,-10,21)');
    expect(canvas.desktopLayer.getAttribute('transform')).toBe('matrix(2,0,0,2,0,0)');
    expect(canvas.controlsLayer.hasAttribute('transform')).toBe(false);
    const area = canvas.get_area_world();
    expect([area.left(), area.top(), area.width(), area.height()]).toEqual([10, -21, 800, 600]);
    canvas.set_affine(Affine.identity());
    expect(canvas.desktopLayer.hasAttribute('transform')).toBe(false);
  });
});
