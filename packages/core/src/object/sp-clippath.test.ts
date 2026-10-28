// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-clippath.cpp, src/object/sp-mask.cpp, src/selection-chemistry.cpp (setMask, unsetMask)
import type { Affine, Rect } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { FakeDrawing, type FakeDrawingItem } from '../display/fake-drawing.ts';
import { SPDocument } from '../document.ts';
import { DocumentUndo } from '../document-undo.ts';
import { Selection } from '../selection.ts';
import { SPClipPath } from './sp-clippath.ts';
import { SP_ITEM_SHOW_DISPLAY, SPItem, SPItemKey } from './sp-item.ts';
import { SPMask } from './sp-mask.ts';

SPDocument.scheduleIdle = () => {}; // tests call ensureUpToDate() themselves

function open(body: string) {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs/>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const item = (id: string) => {
    const o = doc.getObjectById(id);
    if (!(o instanceof SPItem)) throw new Error(`no item ${id}`);
    return o;
  };
  const select = (...ids: string[]) => {
    const s = new Selection(doc);
    s.setList(ids.map(item));
    return s;
  };
  return { doc, item, select };
}

function near(r: Rect | null, x0: number, y0: number, x1: number, y1: number) {
  expect(r).not.toBeNull();
  for (const [a, b] of [
    [r?.left(), x0],
    [r?.top(), y0],
    [r?.right(), x1],
    [r?.bottom(), y1],
  ]) {
    expect(a).toBeCloseTo(b ?? 0, 6);
  }
}

// The target is a translated rect, the clip a rect on top of it.
const TWO =
  '<rect id="a" x="0" y="0" width="100" height="100" transform="translate(50,0)"/><rect id="b" x="60" y="10" width="20" height="20"/>';

describe('ObjectSet.setMask / unsetMask', () => {
  it('moves the topmost object into a new clipPath in defs, in the user space of the clipped item', () => {
    const { doc, item, select } = open(TWO);
    const s = select('a', 'b');
    s.setMask(true, false, true);
    DocumentUndo.done(doc, 'Set clipping path', '');
    doc.ensureUpToDate();

    const a = item('a');
    expect(doc.getObjectById('b')).toBeNull();
    const clip = a.getClipObject();
    expect(clip).toBeInstanceOf(SPClipPath);
    expect(clip?.parent).toBe(doc.getDefs());
    expect(a.getAttribute('clip-path')).toBe(`url(#${clip?.getId()})`);
    expect(clip?.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
    // The clip child keeps its place on the page: its transform cancels the transform of a.
    const child = clip?.children[0] as SPItem;
    near(child.geometricBounds(child.transform.multiply(a.transform)), 60, 10, 80, 30);
    expect(s.items()).toEqual([a]);
    // The clip limits the visual bounds of a.
    near(a.documentVisualBounds(), 60, 10, 80, 30);
    near(a.documentGeometricBounds(), 50, 0, 150, 100);

    DocumentUndo.undo(doc);
    doc.ensureUpToDate();
    expect(item('a').getAttribute('clip-path')).toBeNull();
    expect(item('b').getAttribute('x')).toBe('60');
    expect(doc.getDefs()?.children.length).toBe(0);
  });

  it('releases the clip: the clip content comes back beside the item, the clipPath is deleted', () => {
    const { doc, item, select } = open(TWO);
    select('a', 'b').setMask(true, false, true);
    doc.ensureUpToDate();
    const s = select('a');
    s.unsetMask(true, true, true);
    doc.ensureUpToDate();

    expect(item('a').getClipObject()).toBeNull();
    expect(item('a').getAttribute('clip-path')).toBe('none');
    expect(doc.getDefs()?.children.length).toBe(0);
    const restored = s.items().find((i) => i !== item('a'));
    expect(restored?.getRepr().prev()).toBe(item('a').getRepr());
    near(restored?.documentGeometricBounds() ?? null, 60, 10, 80, 30);
    near(item('a').documentVisualBounds(), 50, 0, 150, 100);
  });

  it('creates a mask with the mask attribute, and keeps the original with remove_original false', () => {
    const { doc, item, select } = open(TWO);
    select('a', 'b').setMask(false, false, false);
    doc.ensureUpToDate();
    const mask = item('a').getMaskObject();
    expect(mask).toBeInstanceOf(SPMask);
    expect(mask?.getAttribute('maskUnits')).toBe('userSpaceOnUse');
    expect(item('a').getAttribute('mask')).toBe(`url(#${mask?.getId()})`);
    expect(item('b').getAttribute('x')).toBe('60');
    near(item('a').documentVisualBounds(), 60, 10, 80, 30);
  });

  it('does nothing with one selected item', () => {
    const { doc, item, select } = open(TWO);
    select('a').setMask(true, false, true);
    expect(item('a').getClipObject()).toBeNull();
    expect(doc.getDefs()?.children.length).toBe(0);
  });
});

describe('clip bounds', () => {
  it('scales objectBoundingBox clip content by the geometric bounds of the item', () => {
    const { item } = open(
      '<clipPath id="c" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="0.25"/></clipPath>' +
        '<rect id="a" x="10" y="10" width="100" height="40" clip-path="url(#c)"/>',
    );
    near(item('a').documentVisualBounds(), 10, 10, 60, 20);
  });

  it('applies the clip of a group child inside the group bounds', () => {
    const { item } = open(
      '<clipPath id="c"><rect x="0" y="0" width="10" height="10"/></clipPath>' +
        '<g id="g"><rect x="0" y="0" width="100" height="100" clip-path="url(#c)"/><rect x="50" y="0" width="10" height="10"/></g>',
    );
    near(item('g').documentVisualBounds(), 0, 0, 60, 10);
  });
});

describe('clip and mask views', () => {
  it('shows the clip for each view of the item and follows clip-path changes', () => {
    const { doc, item } = open(
      '<clipPath id="c"><rect id="r" x="0" y="0" width="10" height="10"/></clipPath>' +
        '<rect id="a" width="100" height="100" clip-path="url(#c)"/>',
    );
    const drawing = new FakeDrawing();
    const key = SPItem.displayKeyNew(1);
    const ai = item('a').invokeShow(drawing, key, SP_ITEM_SHOW_DISPLAY) as FakeDrawingItem;
    expect(ai.clip?.children.map((c) => c.item?.getId())).toEqual(['r']);
    const clip = doc.getObjectById('c') as SPClipPath;
    expect(clip.views.map((v) => v.key)).toEqual([ai.key() + SPItemKey.ITEM_KEY_CLIP]);

    item('a').setAttribute('clip-path', null);
    doc.ensureUpToDate();
    expect(ai.clip).toBeNull();
    expect(clip.views).toEqual([]);
  });

  it('sets the child transform of objectBoundingBox mask content from the item bounds', () => {
    const { doc, item } = open(
      '<mask id="m" maskContentUnits="objectBoundingBox"><rect width="1" height="1" style="fill:white"/></mask>' +
        '<rect id="a" x="10" y="20" width="100" height="50" mask="url(#m)"/>',
    );
    const drawing = new FakeDrawing();
    const ai = item('a').invokeShow(
      drawing,
      SPItem.displayKeyNew(1),
      SP_ITEM_SHOW_DISPLAY,
    ) as FakeDrawingItem;
    doc.ensureUpToDate();
    const group = ai.mask as unknown as { childTransform: Affine };
    expect(group.childTransform.isIdentity()).toBe(false);
    expect([...Array(6)].map((_, i) => group.childTransform.at(i))).toEqual([100, 0, 0, 50, 10, 20]);
  });
});
