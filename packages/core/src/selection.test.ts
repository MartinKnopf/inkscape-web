// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/selection.cpp, src/object/object-set.cpp, src/selection-chemistry.cpp
import { Rect } from '@inkscape-web/geom';
import { describe, expect, it, vi } from 'vitest';
import { SPDocument } from './document.ts';
import { DocumentUndo } from './document-undo.ts';
import { SPItem } from './object/sp-item.ts';
import { Selection } from './selection.ts';

SPDocument.scheduleIdle = () => {}; // tests call ensureUpToDate() themselves

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const item = (doc: SPDocument, id: string) => {
  const o = doc.getObjectById(id);
  if (!(o instanceof SPItem)) throw new Error(`no item ${id}`);
  return o;
};
const ids = (s: Selection) => s.items().map((i) => i.getId());

const SHAPES =
  '<rect id="a" x="0" y="0" width="10" height="10"/>' +
  '<g id="g"><rect id="b" x="20" y="0" width="10" height="10"/><rect id="c" x="40" y="0" width="10" height="10"/></g>';

describe('ObjectSet', () => {
  it('adds, toggles and clears, and emits changed', () => {
    const doc = open(SHAPES);
    const s = new Selection(doc);
    const changed = vi.fn();
    s.connectChanged(changed);
    s.set(item(doc, 'a'));
    expect(s.single()).toBe(item(doc, 'a'));
    s.toggle(item(doc, 'g'));
    expect(ids(s)).toEqual(['a', 'g']);
    expect(s.single()).toBeNull();
    s.toggle(item(doc, 'a'));
    expect(ids(s)).toEqual(['g']);
    s.clear();
    expect(s.isEmpty()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('never holds an object and its ancestor', () => {
    const doc = open(SHAPES);
    const s = new Selection(doc);
    s.add(item(doc, 'b'));
    s.add(item(doc, 'g'));
    expect(ids(s)).toEqual(['g']);
    // Adding a descendant of a selected group does nothing.
    expect(s.add(item(doc, 'c'))).toBe(false);
    expect(s.includes(item(doc, 'c'))).toBe(false);
    expect(s.includes(item(doc, 'c'), true)).toBe(true);
    // Removing a child of the selected group selects its siblings instead.
    s.remove(item(doc, 'b'));
    expect(ids(s)).toEqual(['c']);
  });

  it('drops objects that are deleted', () => {
    const doc = open(SHAPES);
    const s = new Selection(doc);
    s.setList([item(doc, 'a'), item(doc, 'b')]);
    item(doc, 'a').deleteObject();
    expect(ids(s)).toEqual(['b']);
  });

  it('returns the union of the item bounds', () => {
    const doc = open(SHAPES.replace('id="a"', 'id="a" style="stroke:#000;stroke-width:2"'));
    const s = new Selection(doc);
    s.setList([item(doc, 'a'), item(doc, 'c')]);
    expect(s.geometricBounds()?.equals(new Rect(0, 0, 50, 10))).toBe(true);
    expect(s.visualBounds()?.equals(new Rect(-1, -1, 50, 11))).toBe(true);
  });

  it('emits modified once after the selected items change', async () => {
    const doc = open(SHAPES);
    const s = new Selection(doc);
    s.setList([item(doc, 'a'), item(doc, 'b')]);
    const modified = vi.fn();
    s.connectModified(modified);
    s.moveRelative(5, 0);
    doc.ensureUpToDate();
    await Promise.resolve();
    expect(modified).toHaveBeenCalledTimes(1);
  });
});

describe('ObjectSet operations', () => {
  it('move writes the transform and undoes as one step "Move"', () => {
    const doc = open(SHAPES);
    const s = new Selection(doc);
    s.setList([item(doc, 'a'), item(doc, 'g')]);
    s.move(5, 7);
    // The rect embeds the translation in x and y; the group gets a transform.
    expect(item(doc, 'a').getAttribute('x')).toBe('5');
    expect(item(doc, 'g').getAttribute('transform')).toBe('translate(5,7)');
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Move']);
    DocumentUndo.undo(doc);
    expect(item(doc, 'a').getAttribute('x')).toBe('0');
    expect(item(doc, 'g').getAttribute('transform')).toBeNull();
  });

  it('merges repeated horizontal moves into one step', () => {
    const doc = open(SHAPES);
    const s = new Selection(doc);
    s.set(item(doc, 'g'));
    s.move(2, 0);
    s.move(2, 0);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Move horizontally']);
    expect(item(doc, 'g').getAttribute('transform')).toBe('translate(4)');
  });

  it('scaleRelative scales around a point', () => {
    const doc = open(SHAPES);
    const s = new Selection(doc);
    s.set(item(doc, 'a'));
    s.scaleRelative(item(doc, 'a').desktopVisualBounds()!.min(), 2, 3);
    doc.ensureUpToDate();
    expect(s.geometricBounds()?.equals(new Rect(0, 0, 20, 30))).toBe(true);
  });

  it('deleteItems deletes and undoes as "Delete"', () => {
    const doc = open(SHAPES);
    const s = new Selection(doc);
    s.setList([item(doc, 'a'), item(doc, 'c')]);
    s.deleteItems();
    expect(s.isEmpty()).toBe(true);
    expect(doc.getObjectById('a')).toBeNull();
    expect(doc.getObjectById('c')).toBeNull();
    expect(doc.undoStack.undo.at(-1)?.description).toBe('Delete');
    DocumentUndo.undo(doc);
    expect(doc.getObjectById('a')).toBeInstanceOf(SPItem);
    expect(doc.getObjectById('c')?.parent).toBe(doc.getObjectById('g'));
  });
});

describe('SPDocument.getItemsInBox', () => {
  it('returns top-level items fully inside, and enters layers', () => {
    const doc = open(
      `${SHAPES}<g id="layer" inkscape:groupmode="layer" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">` +
        '<rect id="d" x="0" y="20" width="10" height="10"/></g>',
    );
    const found = (r: Rect) => doc.getItemsInBox(0, r).map((i) => i.getId());
    expect(found(new Rect(-1, -1, 31, 31))).toEqual(['a', 'd']);
    expect(found(new Rect(-1, -1, 51, 31))).toEqual(['a', 'g', 'd']);
    expect(doc.getItemsPartiallyInBox(0, new Rect(25, 5, 26, 6)).map((i) => i.getId())).toEqual(['g']);
  });
});
