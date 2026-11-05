// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/widget/canvas-grid.cpp
// @vitest-environment happy-dom
import { SPDocument } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { describe, expect, it, vi } from 'vitest';
import { SPDesktop } from '../../desktop.ts';
import { CanvasGrid } from './canvas-grid.ts';
import { RULER_SIZE } from './ink-ruler.ts';

function setup() {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="10" height="10"/></svg>',
  );
  if (!doc) throw new Error('parse failed');
  const grid = new CanvasGrid(document.createElement('div'));
  vi.spyOn(grid.canvas, 'get_dimensions').mockReturnValue(new Point(800, 600));
  const dt = new SPDesktop(grid.canvas, doc);
  grid.set_desktop(dt);
  const bar = (name: string) =>
    grid.element.querySelector<HTMLElement>(`.canvas-scrollbar-${name}`) as HTMLElement;
  return { grid, dt, hbar: bar('horz'), vbar: bar('vert') };
}

describe('CanvasGrid scroll bars', () => {
  it('cover the document area and the visible area', () => {
    const { hbar } = setup();
    const spacer = hbar.firstElementChild as HTMLElement;
    // The 800 px wide view is always scrollable; the document adds its area with a margin.
    expect(Number.parseInt(spacer.style.width, 10)).toBeGreaterThanOrEqual(800);
  });

  it('scroll the canvas when the bar moves and follow other scrolling', () => {
    const { grid, dt, hbar } = setup();
    dt.scroll_absolute(new Point(0, 0));
    // The bar shows the value x0 at its scroll offset; the lower end of its range is x0 - offset.
    const lower = grid.canvas.get_pos().x - hbar.scrollLeft;
    hbar.scrollLeft = 50;
    hbar.dispatchEvent(new Event('scroll'));
    expect(grid.canvas.get_pos().x).toBe(lower + 50);
    expect(grid.canvas.get_pos().y).toBe(0);
    dt.scroll_absolute(new Point(lower + 20, 30));
    expect(hbar.scrollLeft).toBe(20);
    expect(grid.canvas.get_pos().y).toBe(30);
  });

  it('are hidden and shown by ShowScrollbars', () => {
    const { grid, hbar, vbar } = setup();
    grid.ShowScrollbars(false);
    expect(hbar.style.display).toBe('none');
    expect(vbar.style.display).toBe('none');
    expect(grid.element.style.gridTemplateColumns).toBe(`${RULER_SIZE}px 1fr 0px`);
    grid.ShowScrollbars(true);
    expect(hbar.style.display).toBe('');
    expect(grid.element.style.gridTemplateRows).toBe(`${RULER_SIZE}px 1fr 15px`);
  });
});
