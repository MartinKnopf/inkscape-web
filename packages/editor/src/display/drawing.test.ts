// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/display/drawing.cpp, src/display/drawing-item.cpp, src/display/drawing-group.cpp, src/display/drawing-shape.cpp
// @vitest-environment happy-dom
import { Pixbuf, SPBlendMode, SPStyle } from '@inkscape-web/core';
import { Affine, Point, parse_svg_path, Rect } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SvgDrawing } from './drawing.ts';
import { SvgDrawingItem } from './drawing-item.ts';

function setup() {
  const drawing = new SvgDrawing(document);
  return { drawing, root: drawing.root };
}

describe('tree operations', () => {
  it('creates a g root and builds g and path children', () => {
    const { drawing, root } = setup();
    const g = drawing.createGroup();
    const s = drawing.createShape();
    root.appendChild(g);
    g.appendChild(s);
    expect(root.element.outerHTML).toBe('<g><g><path></path></g></g>');
  });

  it('prepends, reorders and clears', () => {
    const { drawing, root } = setup();
    const [a, b, c] = [drawing.createShape(), drawing.createShape(), drawing.createShape()];
    a.setKey(1);
    b.setKey(2);
    c.setKey(3);
    root.appendChild(a);
    root.appendChild(b);
    root.prependChild(c);
    expect([...root.element.children]).toEqual([c.element, a.element, b.element]);
    c.setZOrder(2);
    expect([...root.element.children]).toEqual([a.element, b.element, c.element]);
    c.setZOrder(0);
    expect([...root.element.children]).toEqual([c.element, a.element, b.element]);
    root.clearChildren();
    expect(root.element.children.length).toBe(0);
  });

  it('unlink removes the element from its parent', () => {
    const { drawing, root } = setup();
    const s = drawing.createShape();
    root.appendChild(s);
    s.unlink();
    expect(root.element.children.length).toBe(0);
  });

  it('finds the item of an element or of its descendant', () => {
    const { drawing, root } = setup();
    const g = drawing.createGroup();
    const s = drawing.createShape();
    root.appendChild(g);
    g.appendChild(s);
    expect(SvgDrawingItem.itemFromElement(s.element)).toBe(s);
    expect(SvgDrawingItem.itemFromElement(g.element)).toBe(g);
    expect(SvgDrawingItem.itemFromElement(null)).toBeNull();
  });
});

describe('attributes', () => {
  it('writes the transform as matrix() and removes it for the identity', () => {
    const { drawing } = setup();
    const s = drawing.createShape();
    s.setTransform(new Affine(1, 2, 3, 4, 5, 6));
    expect(s.element.getAttribute('transform')).toBe('matrix(1,2,3,4,5,6)');
    s.setTransform(Affine.identity());
    expect(s.element.hasAttribute('transform')).toBe(false);
  });

  it('composes the child transform before the transform on a group', () => {
    const { drawing } = setup();
    const g = drawing.createGroup();
    g.setTransform(new Affine(1, 0, 0, 1, 10, 0)); // translate
    g.setChildTransform(new Affine(2, 0, 0, 2, 0, 0)); // scale, applied first
    expect(g.element.getAttribute('transform')).toBe('matrix(2,0,0,2,10,0)');
    g.setChildTransform(null);
    expect(g.element.getAttribute('transform')).toBe('matrix(1,0,0,1,10,0)');
  });

  it('sets opacity, visibility, sensitivity and antialiasing', () => {
    const { drawing } = setup();
    const s = drawing.createShape();
    s.setOpacity(0.5);
    s.setVisible(false);
    s.setSensitive(false);
    s.setAntialiasing(false);
    expect(s.element.getAttribute('opacity')).toBe('0.5');
    expect(s.element.getAttribute('display')).toBe('none');
    expect(s.element.getAttribute('pointer-events')).toBe('none');
    expect(s.element.getAttribute('shape-rendering')).toBe('crispEdges');
    s.setOpacity(1);
    s.setVisible(true);
    s.setSensitive(true);
    s.setAntialiasing(true);
    expect(s.element.getAttributeNames()).toEqual([]);
  });

  it('sets isolation and blend mode as CSS', () => {
    const { drawing } = setup();
    const g = drawing.createGroup();
    g.setIsolation(true);
    g.setBlendMode(SPBlendMode.SP_CSS_BLEND_COLORDODGE);
    expect(g.element.style.getPropertyValue('isolation')).toBe('isolate');
    expect(g.element.style.getPropertyValue('mix-blend-mode')).toBe('color-dodge');
  });
});

describe('shape', () => {
  it('writes the path data and removes it for null', () => {
    const { drawing } = setup();
    const s = drawing.createShape();
    s.setPath(parse_svg_path('M 0,0 L 10,0 L 10,10 Z'));
    expect(s.element.getAttribute('d')).toBe('M 0 0 H 10 V 10 z');
    s.setPath(null);
    expect(s.element.hasAttribute('d')).toBe(false);
  });
});

describe('setStyle', () => {
  it('writes paint properties and keeps the others', () => {
    const { drawing } = setup();
    const s = drawing.createShape();
    s.setOpacity(0.5);
    const style = new SPStyle();
    style.mergeString('fill:#ff0000;stroke-width:2;opacity:0.1');
    s.setStyle(style);
    expect(s.element.style.getPropertyValue('fill')).toBe('#ff0000');
    expect(s.element.style.getPropertyValue('stroke-width')).toBe('2');
    expect(s.element.style.getPropertyValue('opacity')).toBe('');
    expect(s.element.getAttribute('opacity')).toBe('0.5');
  });

  it('replaces the previous style and clears it for null', () => {
    const { drawing } = setup();
    const s = drawing.createShape();
    s.setIsolation(true);
    const a = new SPStyle();
    a.mergeString('fill:#ff0000');
    const b = new SPStyle();
    b.mergeString('stroke:#00ff00');
    s.setStyle(a);
    s.setStyle(b);
    expect(s.element.style.getPropertyValue('fill')).toBe('');
    expect(s.element.style.getPropertyValue('stroke')).toBe('#00ff00');
    s.setStyle(null);
    expect(s.element.style.getPropertyValue('stroke')).toBe('');
    expect(s.element.style.getPropertyValue('isolation')).toBe('isolate');
  });
});

describe('image', () => {
  it('draws the scaled pixbuf in a nested svg for the clip box', () => {
    const { drawing } = setup();
    const img = drawing.createImage();
    img.setPixbuf(new Pixbuf('data:image/png;base64,', 40, 30));
    img.setScale(2, 1);
    img.setOrigin(new Point(10, 5));
    img.setClipbox(Rect.fromXywh(10, 0, 50, 40));
    const clip = img.element.querySelector('svg');
    const image = img.element.querySelector('image');
    expect([...['x', 'y', 'width', 'height'].map((a) => clip?.getAttribute(a))]).toEqual([
      '10',
      '0',
      '50',
      '40',
    ]);
    expect([...['x', 'y', 'width', 'height'].map((a) => image?.getAttribute(a))]).toEqual([
      '0',
      '5',
      '80',
      '30',
    ]);
    expect(image?.getAttribute('href')).toBe('data:image/png;base64,');
    expect(img.bounds().width()).toBe(50);

    img.setPixbuf(null);
    expect(clip?.getAttribute('display')).toBe('none');
  });
});
