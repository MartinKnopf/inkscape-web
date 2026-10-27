// SPDX-License-Identifier: GPL-2.0-or-later
import { Translate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { FakeDrawing, type FakeDrawingItem, type FakeDrawingShape } from '../display/fake-drawing.ts';
import { SPDocument } from '../document.ts';
import { SP_ITEM_SHOW_DISPLAY, SPItem } from './sp-item.ts';
import type { SPShape } from './sp-shape.ts';

SPDocument.scheduleIdle = () => {};

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" id="root">${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const item = (doc: SPDocument, id: string) => {
  const o = doc.getObjectById(id);
  if (!(o instanceof SPItem)) throw new Error(`no item ${id}`);
  return o;
};

/** Open body and show the root in a fake drawing. */
const show = (body: string) => {
  const doc = open(body);
  const key = SPItem.displayKeyNew(1);
  const root = doc.root.invokeShow(new FakeDrawing(), key, SP_ITEM_SHOW_DISPLAY) as FakeDrawingItem;
  const view = (id: string) => item(doc, id).getArenaitem(key) as FakeDrawingItem;
  return { doc, key, root, view };
};

describe('SPGroup views', () => {
  it('show() builds the drawing tree with transform, style and path', () => {
    const { doc, root, view } = show(
      '<g id="g" transform="translate(1,2)" style="opacity:0.5"><path id="p" d="M 0,0 H 10"/></g><path id="q" d="M 0,0" style="display:none"/>',
    );
    expect(root.dump()).toEqual(['group#root', [['group#g', ['shape#p']], 'shape#q']]);
    const g = view('g');
    expect(g.transform?.equals(Translate(1, 2))).toBe(true);
    expect(g.opacity).toBe(0.5);
    expect(g.style).toBe(item(doc, 'g').style);
    const p = view('p') as FakeDrawingShape;
    expect(p.path).toBe((item(doc, 'p') as SPShape).curve());
    expect(p.style).toBe(item(doc, 'p').style);
    expect(view('q').visible).toBe(false);
  });

  it('update() pushes path, transform and style changes to the views', () => {
    const { doc, view } = show('<g id="g"><path id="p" d="M 0,0 H 10"/></g>');
    const p = view('p') as FakeDrawingShape;
    item(doc, 'p').setAttribute('d', 'M 0,0 V 5');
    item(doc, 'g').setAttribute('transform', 'translate(3,4)');
    item(doc, 'p').setAttribute('style', 'display:none');
    doc.ensureUpToDate();
    expect(p.path?.[0]?.finalPoint().y).toBe(5);
    expect(view('g').transform?.equals(Translate(3, 4))).toBe(true);
    expect(p.visible).toBe(false);
  });

  it('follows added, removed and reordered children', () => {
    const { doc, root, view } = show('<path id="a" d="M 0,0"/><path id="b" d="M 0,0"/>');
    const names = () => (root.dump() as [string, string[]])[1];

    const c = doc.rdoc.createElement('svg:path');
    c.setAttribute('id', 'c');
    doc.rroot.appendChild(c);
    const d = doc.rdoc.createElement('svg:path');
    d.setAttribute('id', 'd');
    doc.rroot.addChild(d, item(doc, 'a').repr);
    expect(names()).toEqual(['shape#a', 'shape#d', 'shape#b', 'shape#c']);

    doc.rroot.changeOrder(item(doc, 'a').repr, item(doc, 'c').repr);
    expect(names()).toEqual(['shape#d', 'shape#b', 'shape#c', 'shape#a']);

    const b = view('b');
    doc.rroot.removeChild(item(doc, 'b').repr);
    expect(b.unlinked).toBe(true);
    expect(names()).toEqual(['shape#d', 'shape#c', 'shape#a']);
  });

  it('hide() removes the views', () => {
    const { doc, key, root } = show('<g id="g"><path id="p" d="M 0,0"/></g>');
    doc.root.invokeHide(key);
    expect(root.unlinked).toBe(true);
    expect(item(doc, 'g').views).toEqual([]);
    expect(item(doc, 'p').views).toEqual([]);
  });
});
