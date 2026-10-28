// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/export-single.cpp, src/ui/dialog/export.cpp
// @vitest-environment happy-dom
import { DocumentUndo, SPDocument } from '@inkscape-web/core';
import { Point, Rect } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDesktop } from '../../desktop.ts';
import { render_svg_source } from '../../helper/png-write.ts';
import { Canvas } from '../widget/canvas.ts';
import {
  area_x_change,
  area_y_change,
  dpi_change,
  type ExportGeometry,
  export_area_bounds,
  export_bitmap_size,
  export_filename,
  get_export_bg_color,
  get_export_hints,
  save_export_hints,
  with_extension,
} from './export.ts';

const g = (over: Partial<ExportGeometry> = {}): ExportGeometry => ({
  x0: 0,
  y0: 0,
  x1: 100,
  y1: 50,
  dpi: 96,
  ...over,
});

describe('export size and dpi', () => {
  it('has one bitmap pixel per px at 96 dpi and rounds the size', () => {
    expect(export_bitmap_size(g())).toEqual({ width: 100, height: 50 });
    expect(export_bitmap_size(g({ dpi: 192 }))).toEqual({ width: 200, height: 100 });
    expect(export_bitmap_size(g({ x1: 10.2, dpi: 96 }))).toEqual({ width: 10, height: 50 });
    expect(export_bitmap_size(g({ x1: 10.5 }))).toEqual({ width: 11, height: 50 });
  });

  it('derives the dpi from a bitmap width or height, like the spin buttons', () => {
    expect(dpi_change(g(), 'bmwidth', 200).dpi).toBe(192);
    expect(dpi_change(g(), 'bmheight', 25).dpi).toBe(48);
    // at least one pixel
    expect(dpi_change(g(), 'bmwidth', 0).dpi).toBeCloseTo(0.96, 12);
    // the other bitmap side follows from the dpi
    expect(export_bitmap_size(dpi_change(g(), 'bmwidth', 300))).toEqual({ width: 300, height: 150 });
    expect(dpi_change(g(), 'dpi', 72).dpi).toBe(72);
  });

  it('keeps the area at least one bitmap pixel wide when a side is edited', () => {
    // 1 px at 96 dpi: moving x0 beyond x1 - 1 stops at x1 - 1
    expect(area_x_change(g(), 'x0', 100).x0).toBe(99);
    expect(area_x_change(g(), 'x1', 0).x1).toBe(1);
    expect(area_y_change(g(), 'y0', 49.5).y0).toBe(49);
    // at 192 dpi the minimum is half a px
    expect(area_x_change(g({ dpi: 192 }), 'x1', 0).x1).toBe(0.5);
    // the width sets x1
    expect(area_x_change(g({ x0: 10 }), 'width', 40)).toMatchObject({ x0: 10, x1: 50 });
    expect(area_y_change(g(), 'height', 0).y1).toBe(1);
    // an allowed edit is not changed
    expect(area_x_change(g(), 'x0', 20)).toMatchObject({ x0: 20, x1: 100 });
  });
});

describe('export areas and hints', () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="300">' +
    '<rect id="r1" x="50" y="60" width="100" height="40"/><rect id="r2" x="300" y="200" width="20" height="20"/></svg>';
  function setup() {
    const doc = SPDocument.createNewDocFromMem(SVG, 'drawing.svg');
    if (!doc) throw new Error('parse failed');
    const dt = new SPDesktop(new Canvas(document.createElement('div')), doc);
    return { doc, dt };
  }

  it('uses the page, the drawing or the selection bounds in desktop coordinates', () => {
    const { doc, dt } = setup();
    const b = (a: Parameters<typeof export_area_bounds>[1]) => {
      const r = export_area_bounds(dt, a);
      return r && [r.left(), r.top(), r.right(), r.bottom()];
    };
    expect(b('page')).toEqual([0, 0, 400, 300]);
    expect(b('drawing')).toEqual([50, 60, 320, 220]);
    expect(b('custom')).toBeNull();
    // an empty selection falls back to the drawing
    expect(b('selection')).toEqual([50, 60, 320, 220]);
    const r1 = doc.getObjectById('r1');
    if (!r1) throw new Error('no r1');
    dt.getSelection().set(r1 as never);
    expect(b('selection')).toEqual([50, 60, 150, 100]);
  });

  it('saves the filename and dpi on the target with one undo step, and suggests that name next time', () => {
    const { doc, dt } = setup();
    expect(export_filename(dt, 'drawing', '.png')).toBe('drawing.png');
    dt.getSelection().set(doc.getObjectById('r2') as never);
    expect(export_filename(dt, 'selection', '.png')).toBe('r2.png');

    save_export_hints(dt, 'drawing', 'out/pic.png', 150);
    const root = doc.getRoot();
    expect(get_export_hints(root)).toEqual({ filename: 'out/pic.png', dpi: 150 });
    expect(root.getRepr().attribute('inkscape:export-ydpi')).toBe('150');
    expect(doc.undoStack.undo.map((e) => e.description)).toContain('Set Export Options');
    expect(export_filename(dt, 'drawing', '.png')).toBe('out/pic.png');

    DocumentUndo.undo(doc);
    expect(get_export_hints(root)).toEqual({ filename: '', dpi: 0 });
  });

  it('changes the extension of a file name and reads the background color with the upstream default', () => {
    expect(with_extension('a.svg', '.png')).toBe('a.png');
    expect(with_extension('dir.d/name', '.png')).toBe('dir.d/name.png');
    expect(with_extension('.hidden', '.png')).toBe('.hidden.png');
    const { doc } = setup();
    expect(get_export_bg_color(doc).toRGBA()).toBe(0xffffff00);
  });
});

describe('render_svg_source', () => {
  it('nests the document in an svg that has the area as viewBox and the bitmap size', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="100mm" height="50mm" viewBox="0 0 100 50"><rect id="a" width="10" height="10"/><rect id="b" x="20" width="10" height="10"/></svg>',
    );
    if (!doc) throw new Error('parse failed');
    const src = render_svg_source(doc, new Rect(new Point(-10, -5), new Point(390, 195)), 800, 400);
    const outer = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement;
    expect(outer.getAttribute('width')).toBe('800');
    expect(outer.getAttribute('height')).toBe('400');
    expect(outer.getAttribute('viewBox')).toBe('-10 -5 400 200');
    const inner = outer.firstElementChild;
    // the document keeps its viewBox; its size is its page size in px
    expect(inner?.getAttribute('viewBox')).toBe('0 0 100 50');
    expect(Number(inner?.getAttribute('width'))).toBeCloseTo((100 * 96) / 25.4, 6);
    expect(inner?.getAttribute('overflow')).toBe('visible');

    const only = render_svg_source(doc, new Rect(new Point(0, 0), new Point(10, 10)), 10, 10, [
      doc.getObjectById('a') as never,
    ]);
    const parsed = new DOMParser().parseFromString(only, 'image/svg+xml');
    expect(parsed.getElementById('a')?.getAttribute('style') ?? '').not.toContain('display:none');
    expect(parsed.getElementById('b')?.getAttribute('style')).toContain('display:none');
  });
});
