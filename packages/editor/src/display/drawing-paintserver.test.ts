// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing-paintserver.cpp
// @vitest-environment happy-dom
import {
  SP_ITEM_SHOW_DISPLAY,
  SPDocument,
  type SPGradient,
  SPItem,
  type SPMeshGradient,
} from '@inkscape-web/core';
import { Rect } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SvgDrawing } from './drawing.ts';
import type { SvgDrawingItem } from './drawing-item.ts';
import { rasterizeMesh } from './drawing-paintserver.ts';

SPDocument.scheduleIdle = () => {};

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>' +
  '<linearGradient id="v"><stop offset="0" style="stop-color:#ff0000"/><stop offset="1" style="stop-color:#0000ff;stop-opacity:0.5"/></linearGradient>' +
  '<linearGradient id="p" xlink:href="#v" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="reflect"/>' +
  '<radialGradient id="q" xlink:href="#v" gradientTransform="scale(2)"/></defs>' +
  '<rect id="a" width="100" height="10" style="fill:url(#p)"/>' +
  '<rect id="b" width="100" height="10" style="fill:url(#missing) #00ff00;stroke:url(#q)"/></svg>';

/** The document shown in a new drawing. */
function show(doc: SPDocument) {
  const drawing = new SvgDrawing(document);
  const key = SPItem.displayKeyNew(1);
  const root = doc.getRoot().invokeShow(drawing, key, SP_ITEM_SHOW_DISPLAY);
  if (root) drawing.root.appendChild(root);
  const element = (id: string) =>
    ((doc.getObjectById(id) as SPItem).getArenaitem(key) as SvgDrawingItem).element;
  return { drawing, element };
}

function open() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
}

describe('DrawingPaintServers', () => {
  it('mirrors the gradient of a url() fill into the defs of the drawing, with the href chain resolved', () => {
    const doc = open();
    const { drawing, element } = show(doc);
    const fill = element('a').style.getPropertyValue('fill');
    const id = /^url\(#(.+)\)$/.exec(fill)?.[1];
    const mirror = drawing.defs.querySelector(`#${id}`);
    expect(mirror?.outerHTML).toBe(
      `<linearGradient id="${id}" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="reflect">` +
        '<stop offset="0" stop-color="#ff0000" stop-opacity="1"></stop>' +
        '<stop offset="1" stop-color="#0000ff" stop-opacity="0.5"></stop></linearGradient>',
    );
  });

  it('uses the fallback color for an unresolved url() and maps radial gradients', () => {
    const { drawing, element } = show(open());
    expect(element('b').style.getPropertyValue('fill')).toBe('#00ff00');
    const stroke = element('b').style.getPropertyValue('stroke');
    const mirror = drawing.defs.querySelector(`#${/url\(#(.+)\)/.exec(stroke)?.[1]}`);
    expect(mirror?.tagName).toBe('radialGradient');
    expect(mirror?.getAttribute('gradientTransform')).toBe('matrix(2,0,0,2,0,0)');
    expect(mirror?.getAttribute('gradientUnits')).toBe('objectBoundingBox');
  });

  it('updates the mirror when a stop of the vector changes, and follows a new fill', () => {
    const doc = open();
    const { drawing, element } = show(doc);
    (doc.getObjectById('v') as SPGradient).getFirstStop()?.setAttribute('style', 'stop-color:#00ff00');
    doc.ensureUpToDate();
    expect(drawing.defs.querySelector('linearGradient stop')?.getAttribute('stop-color')).toBe('#00ff00');

    doc.getObjectById('a')?.setAttribute('style', 'fill:url(#q)');
    doc.ensureUpToDate();
    expect(element('a').style.getPropertyValue('fill')).toBe(element('b').style.getPropertyValue('stroke'));
  });

  it('gives each drawing its own ids', () => {
    const doc = open();
    const one = show(doc).element('a').style.getPropertyValue('fill');
    const two = show(doc).element('a').style.getPropertyValue('fill');
    expect(one).not.toBe(two);
  });

  it('removes the mirror when the gradient is deleted', () => {
    const doc = open();
    const { drawing, element } = show(doc);
    expect(drawing.defs.children.length).toBe(2);
    doc.getObjectById('p')?.deleteObject();
    doc.ensureUpToDate();
    expect(drawing.defs.children.length).toBe(1);
    expect(element('a').style.getPropertyValue('fill')).toBe('none');
  });

  it('mirrors a pattern with the attributes of its href chain and shows the content of the root pattern', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>' +
        '<pattern id="root" patternUnits="userSpaceOnUse" width="10" height="20" style="fill:#ff0000"><circle r="3"/></pattern>' +
        '<pattern id="link" xlink:href="#root" patternTransform="translate(5,0)"/></defs>' +
        '<rect id="a" width="100" height="10" style="fill:url(#link)"/></svg>',
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    const { drawing, element } = show(doc);
    const id = /^url\(#(.+)\)$/.exec(element('a').style.getPropertyValue('fill'))?.[1];
    const mirror = drawing.defs.querySelector(`#${id}`);
    expect(mirror?.tagName).toBe('pattern');
    expect(
      ['patternUnits', 'width', 'height', 'patternTransform', 'fill'].map((a) => mirror?.getAttribute(a)),
    ).toEqual(['userSpaceOnUse', '10', '20', 'matrix(1,0,0,1,5,0)', '#ff0000']);
    expect(mirror?.querySelector('path')).not.toBeNull();
  });

  it('rasterizes the patches of a mesh with the corner colors and mirrors it as a pattern', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><meshgradient id="m" x="0" y="0" gradientUnits="userSpaceOnUse"><meshrow><meshpatch>' +
        '<stop path="l 100,0" style="stop-color:#ff0000"/><stop path="l 0,50" style="stop-color:#00ff00"/>' +
        '<stop path="l -100,0" style="stop-color:#0000ff"/><stop path="l 0,-50" style="stop-color:#000000;stop-opacity:0"/>' +
        '</meshpatch></meshrow></meshgradient></defs><rect id="a" width="100" height="50" style="fill:url(#m)"/></svg>',
    )!;
    doc.ensureUpToDate();
    const mesh = doc.getObjectById('m') as SPMeshGradient;
    const pixels = rasterizeMesh(mesh.getGradientPatches(), new Rect(0, 0, 100, 50), 10, 5);
    const at = (x: number, y: number) => [...pixels.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)];
    // corners: red, green, blue, transparent; the middle mixes them
    expect(at(0, 0)[0]).toBeGreaterThan(200);
    expect(at(9, 0)[1]).toBeGreaterThan(200);
    expect(at(9, 4)[2]).toBeGreaterThan(200);
    expect(at(0, 4)[3]).toBeLessThan(50);
    expect(at(5, 2).map((v) => Math.round(v / 10))).toEqual([6, 7, 7, 20]);

    const { drawing, element } = show(doc);
    const id = /url\(#(.+)\)/.exec(element('a').style.getPropertyValue('fill'))?.[1];
    const mirror = drawing.defs.querySelector(`#${id}`);
    expect(mirror?.tagName).toBe('pattern');
    expect(['x', 'y', 'width', 'height'].map((a) => mirror?.getAttribute(a))).toEqual([
      '-100',
      '-50',
      '300',
      '150',
    ]);
  });

  it('mirrors a hatch as a pattern of stroked strips with the hatch transform', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
        '<hatch id="h" hatchUnits="userSpaceOnUse" pitch="15" rotate="90" style="stroke:#ff0000;stroke-width:2;overflow:visible">' +
        '<hatchpath offset="5" d="M 0,0 5,10"/></hatch></defs><rect id="a" width="100" height="50" style="fill:url(#h)"/></svg>',
    )!;
    doc.ensureUpToDate();
    const { drawing, element } = show(doc);
    const id = /url\(#(.+)\)/.exec(element('a').style.getPropertyValue('fill'))?.[1];
    const mirror = drawing.defs.querySelector(`#${id}`);
    expect(mirror?.tagName).toBe('pattern');
    expect(
      ['patternUnits', 'width', 'height', 'patternTransform'].map((a) => mirror?.getAttribute(a)),
    ).toEqual(['userSpaceOnUse', '15', '10', 'matrix(0,1,-1,0,0,0)']);
    const paths = [...(mirror?.querySelectorAll('path') ?? [])];
    // The path (x 0..5 at offset 5, stroke 2) reaches into the tile only from the strip at 0.
    expect(paths.map((p) => p.getAttribute('transform'))).toEqual(['translate(5,0)']);
    expect(paths[0]?.getAttribute('style')).toContain('stroke:#ff0000');
  });
});
