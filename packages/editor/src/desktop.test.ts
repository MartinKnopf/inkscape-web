// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment happy-dom
import { SPDocument } from '@inkscape-web/core';
import { Point } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SP_DESKTOP_ZOOM_MAX, SPDesktop } from './desktop.ts';
import { Canvas } from './ui/widget/canvas.ts';

const A4 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"><path id="p" d="M 10,10 H 20 V 30"/></svg>';

function setup(svg = A4) {
  const doc = SPDocument.createNewDocFromMem(svg);
  if (!doc) throw new Error('parse failed');
  const host = document.createElement('div');
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const canvas = new Canvas(host);
  const dt = new SPDesktop(canvas, doc);
  return { doc, canvas, dt };
}

/** The fill rects of the page backgrounds (in world coordinates, so in screen px at zoom 1). */
const pageFills = (canvas: Canvas) =>
  [...canvas.svg.querySelectorAll('[class="CanvasItemRect:background"]')]
    .filter((g) => g.getAttribute('visibility') !== 'hidden')
    .map((g) => g.lastElementChild);

/** Window position of desktop point p. */
const toWindow = (dt: SPDesktop, p: Point) => dt.d2w(p).sub(dt.getCanvas().get_pos());

describe('SPDesktop', () => {
  it('shows the document root with its viewBox transform, and the page', () => {
    const { dt, canvas } = setup();
    const drawing = canvas.desktopLayer.querySelector('[class="CanvasItemGroup:Drawing"]');
    const root = drawing?.firstElementChild?.firstElementChild;
    expect(root?.getAttribute('transform')).toMatch(/^matrix\(3\.77952/);
    expect(root?.querySelector('path')?.getAttribute('d')).toBe('M 10 10 H 20 V 30');
    const [page] = pageFills(canvas);
    expect(Math.abs(Number(page?.getAttribute('width')) - 793.7)).toBeLessThan(1);
    expect(Math.abs(Number(page?.getAttribute('height')) - 1122.5)).toBeLessThan(1);
    expect(dt.current_zoom()).toBe(1);
  });

  it('zoom_absolute keeps the center point fixed in the window', () => {
    const { dt } = setup();
    dt.scroll_relative(new Point(-35, 12));
    const c = new Point(123, 456);
    const before = toWindow(dt, c);
    dt.zoom_absolute(c, 3.5);
    expect(dt.current_zoom()).toBeCloseTo(3.5);
    const after = toWindow(dt, c);
    // The canvas position is rounded to whole pixels.
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
  });

  it('zoom_absolute clamps to the zoom limits', () => {
    const { dt } = setup();
    dt.zoom_absolute(new Point(0, 0), 1000);
    expect(dt.current_zoom()).toBe(SP_DESKTOP_ZOOM_MAX);
  });

  it('zoom_page fits the page with a 10 px border and centers it', () => {
    const { dt, doc } = setup();
    dt.zoom_page();
    const page = doc.preferredBounds();
    expect(dt.current_zoom()).toBeCloseTo((600 - 20) / page.height());
    const mid = toWindow(dt, page.midpoint());
    expect(Math.abs(mid.x - 400)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(mid.y - 300)).toBeLessThanOrEqual(0.5);
  });

  it('setDocument replaces the shown document', () => {
    const { dt, canvas } = setup();
    const other = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><path d="M 0,0 H 5"/></svg>',
    );
    if (!other) throw new Error('parse failed');
    dt.setDocument(other);
    const paths = canvas.desktopLayer.querySelectorAll('path');
    expect([...paths].map((p) => p.getAttribute('d'))).toEqual(['M 0 0 H 5']);
    expect(pageFills(canvas).map((r) => r?.getAttribute('width'))).toEqual(['100']);
  });

  it('draws each page of a multipage document with its label', () => {
    const { dt, canvas } = setup(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="50"><defs><view viewBox="0 0 100 50"/><view viewBox="110 0 30 20" inkscape:label="Back"/></defs></svg>',
    );
    dt.zoom_absolute(new Point(0, 0), 1);
    expect(pageFills(canvas).map((r) => [r?.getAttribute('width'), r?.getAttribute('height')])).toEqual([
      ['100', '50'],
      ['30', '20'],
    ]);
    const labels = [...canvas.svg.querySelectorAll('.CanvasItemText')]
      .filter((g) => g.getAttribute('visibility') !== 'hidden')
      .map((g) => g.textContent);
    expect(labels).toEqual(['Back']);
  });
});
