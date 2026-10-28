// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-item.cpp (clip, mask, filter), src/display/drawing-shape.cpp (markers), src/display/nr-filter.cpp
// @vitest-environment happy-dom
import { SP_ITEM_SHOW_DISPLAY, SPDocument, SPItem } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import { SvgDrawing } from './drawing.ts';
import type { SvgDrawingItem } from './drawing-item.ts';

SPDocument.scheduleIdle = () => {};

function show(body: string) {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const drawing = new SvgDrawing(document);
  const key = SPItem.displayKeyNew(1);
  const root = doc.getRoot().invokeShow(drawing, key, SP_ITEM_SHOW_DISPLAY);
  if (root) drawing.root.appendChild(root);
  const view = (id: string) => (doc.getObjectById(id) as SPItem).getArenaitem(key) as SvgDrawingItem;
  /** The element of the defs that url(#id) in value points to. */
  const target = (value: string | null) =>
    drawing.defs.querySelector(`#${/url\(#(.+)\)/.exec(value ?? '')?.[1]}`);
  return { doc, drawing, view, target };
}

describe('clip and mask', () => {
  it('turns the clip view into an svg:clipPath in the defs and references it from the element', () => {
    const { doc, view, target } = show(
      '<defs><clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath></defs>' +
        '<rect id="a" x="10" y="0" width="100" height="50" clip-path="url(#c)"/>',
    );
    const clip = target(view('a').element.getAttribute('clip-path'));
    expect(clip?.localName).toBe('clipPath');
    expect(clip?.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
    // objectBoundingBox units: the content is scaled to the bounding box of the rect.
    expect(clip?.getAttribute('transform')).toBe('matrix(100,0,0,50,10,0)');
    expect(clip?.querySelector('path')?.getAttribute('d')).toBeTruthy();

    (doc.getObjectById('a') as SPItem).setAttribute('clip-path', null);
    doc.ensureUpToDate();
    expect(view('a').element.hasAttribute('clip-path')).toBe(false);
    expect(clip?.isConnected).toBe(false);
  });

  it('draws a clip with clones as an svg:mask with opaque white content', () => {
    const { drawing, view, target } = show(
      '<defs><rect id="r" width="10" height="10"/><clipPath id="c"><use href="#r"/></clipPath></defs>' +
        '<rect id="a" width="100" height="50" clip-path="url(#c)"/>',
    );
    const el = view('a').element;
    expect(el.hasAttribute('clip-path')).toBe(false);
    const mask = target(el.getAttribute('mask'));
    expect(mask?.localName).toBe('mask');
    expect(mask?.getAttribute('class')).toBe('inkscape-clip-mask');
    expect(mask?.querySelector('g > g > path')).not.toBeNull();
    expect(drawing.defs.querySelector('style')?.textContent).toContain(
      '.inkscape-clip-mask * { fill: #fff !important;',
    );
  });

  it('puts the mask view into an svg:mask in the defs', () => {
    const { view, target } = show(
      '<defs><mask id="m" maskUnits="userSpaceOnUse"><rect width="10" height="10" style="fill:#fff"/></mask></defs>' +
        '<rect id="a" width="100" height="50" mask="url(#m)"/>',
    );
    const mask = target(view('a').element.getAttribute('mask'));
    expect(mask?.localName).toBe('mask');
    expect(mask?.getAttribute('maskUnits')).toBe('userSpaceOnUse');
    expect(mask?.querySelector<SVGElement>('g > path')?.style.getPropertyValue('fill')).toBe('#ffffff');
  });
});

describe('filters', () => {
  it('mirrors the filter with its primitives and follows changes of the primitives', () => {
    const { doc, view, target } = show(
      '<defs><filter id="f" x="-0.1" width="1.2" style="color-interpolation-filters:sRGB" inkscape:collect="always" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">' +
        '<feGaussianBlur id="b" stdDeviation="3"/><feOffset dx="2"/></filter></defs>' +
        '<rect id="a" width="100" height="50" style="filter:url(#f)"/>',
    );
    const filter = target(view('a').element.style.getPropertyValue('filter'));
    expect(filter?.localName).toBe('filter');
    expect(filter?.getAttribute('x')).toBe('-0.1');
    expect(filter?.hasAttribute('inkscape:collect')).toBe(false);
    expect([...(filter?.children ?? [])].map((c) => c.localName)).toEqual(['feGaussianBlur', 'feOffset']);

    doc.getObjectById('b')?.setAttribute('stdDeviation', '7');
    doc.ensureUpToDate();
    expect(filter?.querySelector('feGaussianBlur')?.getAttribute('stdDeviation')).toBe('7');
  });
});

describe('markers', () => {
  it('wraps the path in a group for the markers, with context-stroke resolved to the stroke of the shape', () => {
    const { view } = show(
      '<defs><marker id="m" orient="auto" style="overflow:visible"><path d="M 0,0 L 1,1" style="stroke:context-stroke"/></marker></defs>' +
        '<path id="p" d="M 0,0 H 10" transform="translate(5,0)" style="stroke:#ff0000;opacity:0.5;marker-end:url(#m)"/>',
    );
    const el = view('p').element;
    expect(el.localName).toBe('g');
    expect(el.getAttribute('transform')).toBe('matrix(1,0,0,1,5,0)');
    expect(el.getAttribute('opacity')).toBe('0.5');
    const [path, marker] = [...el.children];
    expect(path?.getAttribute('d')).toBe('M 0 0 H 10');
    expect((path as SVGElement).style.getPropertyValue('stroke')).toBe('#ff0000');
    expect(marker?.getAttribute('transform')).toBe('matrix(1,0,0,1,10,0)');
    expect(marker?.querySelector<SVGElement>('path')?.style.getPropertyValue('stroke')).toBe('#ff0000');
  });
});
