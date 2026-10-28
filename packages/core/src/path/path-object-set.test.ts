// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-object-set.cpp, src/path-chemistry.cpp
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { ObjectSet } from '../object/object-set.ts';
import { SPItem } from '../object/sp-item.ts';
import { SPPath } from '../object/sp-path.ts';
import { breakApart, combine } from '../path-chemistry.ts';
import { setPathBoolopBackend } from './path-boolop.ts';
import { pathDiff, pathUnion } from './path-object-set.ts';

setPathBoolopBackend(await loadGeom());

// Bottom rect "a" (moved by its transform), top rect "b" overlaps its right half.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
  '<rect id="a" x="0" y="0" width="20" height="20" style="fill:red" transform="translate(5,0)"/>' +
  '<rect id="b" x="15" y="-5" width="20" height="30" style="fill:blue"/>' +
  '<circle id="c" cx="100" cy="100" r="5"/>' +
  '</svg>';

function load() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
}

function select(doc: SPDocument, ...ids: string[]): ObjectSet {
  const set = new ObjectSet(doc);
  set.setList(ids.map((id) => doc.getObjectById(id)).filter((o) => o !== null));
  return set;
}

function docBounds(item: SPItem) {
  const b = item.documentGeometricBounds();
  return b && [b.left(), b.top(), b.right(), b.bottom()].map((v) => Math.round(v * 1000) / 1000);
}

/** The ids of the items in the root, bottom to top. */
const ids = (doc: SPDocument) =>
  doc
    .getRoot()
    .children.filter((c) => c instanceof SPItem)
    .map((c) => c.getId());

describe('pathUnion', () => {
  it('replaces the items with one path that keeps id, style, transform and place of the bottom item', () => {
    const doc = load();
    const set = select(doc, 'b', 'a');
    pathUnion(set);
    doc.ensureUpToDate();

    const result = doc.getObjectById('a') as SPPath;
    expect(result).toBeInstanceOf(SPPath);
    expect(set.items()).toEqual([result]);
    expect(doc.getObjectById('b')).toBeNull();
    expect(ids(doc)).toEqual(['a', 'c']);
    expect(result.getRepr().attribute('style')).toBe('fill:red');
    expect(result.getRepr().attribute('transform')).toBe('translate(5,0)');
    expect(docBounds(result)).toEqual([5, -5, 35, 25]);
    expect(doc.undoStack.undo.map((s) => s.description)).toEqual(['Union']);
  });
});

describe('pathDiff', () => {
  it('subtracts the top item from the bottom item, in any selection order', () => {
    for (const order of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      const doc = load();
      pathDiff(select(doc, ...order));
      doc.ensureUpToDate();

      const result = doc.getObjectById('a') as SPPath;
      expect(result).toBeInstanceOf(SPPath);
      expect(doc.getObjectById('b')).toBeNull();
      expect(docBounds(result)).toEqual([5, 0, 15, 20]);
      expect(doc.undoStack.undo.map((s) => s.description)).toEqual(['Difference']);
    }
  });

  it('subtracts the top item from each item below it', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<rect id="p" x="0" y="0" width="10" height="10"/>' +
        '<rect id="q" x="20" y="0" width="10" height="10"/>' +
        '<rect id="top" x="5" y="-5" width="20" height="20"/>' +
        '</svg>',
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    pathDiff(select(doc, 'p', 'q', 'top'));
    doc.ensureUpToDate();

    expect(doc.getObjectById('top')).toBeNull();
    expect(docBounds(doc.getObjectById('p') as SPItem)).toEqual([0, 0, 5, 10]);
    expect(docBounds(doc.getObjectById('q') as SPItem)).toEqual([25, 0, 30, 10]);
    expect(doc.undoStack.undo).toHaveLength(1);
  });

  it('keeps the items when only one is selected', () => {
    const doc = load();
    pathDiff(select(doc, 'a'), false, true);
    expect(ids(doc)).toEqual(['a', 'b', 'c']);
    expect(doc.undoStack.undo).toHaveLength(0);
  });
});

describe('combine', () => {
  it('makes one path with the subpaths of all items, with the id, style and place of the top item', () => {
    const doc = load();
    const set = select(doc, 'a', 'b');
    combine(set);
    doc.ensureUpToDate();

    const result = doc.getObjectById('b') as SPPath;
    expect(result).toBeInstanceOf(SPPath);
    expect(set.items()).toEqual([result]);
    expect(ids(doc)).toEqual(['b', 'c']);
    expect(result.getRepr().attribute('style')).toBe('fill:blue');
    expect(result.curve()).toHaveLength(2);
    // The bottom rect keeps its place: its transform is applied to its subpath.
    expect(docBounds(result)).toEqual([5, -5, 35, 25]);
    expect(doc.undoStack.undo.map((s) => s.description)).toEqual(['Combine']);
  });
});

describe('breakApart', () => {
  it('makes one path for each subpath; the first keeps the id', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<path id="p" d="M 0,0 H 10 V 10 H 0 Z M 2,2 H 8 V 8 H 2 Z M 20,0 H 30 V 10 H 20 Z" style="fill:green" transform="translate(1,2)"/>' +
        '</svg>',
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    const set = select(doc, 'p');
    breakApart(set);
    doc.ensureUpToDate();

    const items = set.items();
    expect(items).toHaveLength(3);
    expect(doc.getObjectById('p')).toBe(items[0]);
    for (const item of items) {
      expect(item.getRepr().attribute('style')).toBe('fill:green');
      expect(item.getRepr().attribute('transform')).toBe('translate(1,2)');
    }
    expect(items.map(docBounds)).toEqual(
      expect.arrayContaining([
        [1, 2, 11, 12],
        [3, 4, 9, 10],
        [21, 2, 31, 12],
      ]),
    );
    expect(doc.undoStack.undo.map((s) => s.description)).toEqual(['Break apart']);
  });

  it('keeps holes with their outer path without overlapping (Split Apart)', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<path id="p" d="M 0,0 H 10 V 10 H 0 Z M 2,2 V 8 H 8 V 2 Z M 20,0 H 30 V 10 H 20 Z"/>' +
        '</svg>',
    );
    if (!doc) throw new Error('parse failed');
    doc.ensureUpToDate();
    const set = select(doc, 'p');
    breakApart(set, false, false);
    expect(set.items().map((i) => (i as SPPath).curve()?.length)).toEqual(expect.arrayContaining([2, 1]));
    expect(set.items()).toHaveLength(2);
  });
});
