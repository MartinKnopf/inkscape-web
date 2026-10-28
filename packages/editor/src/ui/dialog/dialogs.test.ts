// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/xml-tree.cpp, src/ui/dialog/attrdialog.cpp, src/ui/dialog/objects.cpp
import { DocumentUndo, type Node, SPDocument, type SPItem } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import type { SPDesktop } from '../../desktop.ts';
import { attrDelete, attrRename, attrValueEdited } from './attrdialog.ts';
import { objectLabel, objectRows, toggleLocked, toggleVisible } from './objects.ts';
import {
  cmdIndentNode,
  cmdNewElementNode,
  cmdRaiseNode,
  cmdUnindentNode,
  xmlNodeLabel,
  xmlTreeRows,
} from './xml-tree.ts';

SPDocument.scheduleIdle = () => {};

const open = () => {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">' +
      '<rect id="a" width="10" height="10"/>' +
      '<g id="g" inkscape:label="Group"><rect id="b" width="5" height="5"/><circle id="c" r="3"/></g>' +
      '</svg>',
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};

/** The parts of SPDesktop that the dialog logic uses. */
const fakeDesktop = (doc: SPDocument) => {
  const selected: SPItem[] = [];
  return {
    doc,
    layerManager: () => ({ isLayer: () => false }),
    getSelection: () => ({ includes: (i: SPItem) => selected.includes(i), items: () => selected }),
  } as unknown as SPDesktop;
};

const item = (doc: SPDocument, id: string) => doc.getObjectById(id) as SPItem;
const lastUndo = (doc: SPDocument) => doc.undoStack.undo.at(-1)?.description;

describe('xml tree', () => {
  it('lists the children of expanded nodes only', () => {
    const doc = open();
    const root = doc.rroot;
    const labels = (expanded: Set<Node>) => xmlTreeRows(root, expanded).map((r) => xmlNodeLabel(r.node));
    expect(labels(new Set())).toEqual(['svg:svg id="svg1"']);
    expect(labels(new Set([root]))).toEqual([
      'svg:svg id="svg1"',
      'svg:defs id="defs1"',
      'svg:rect id="a"',
      'svg:g id="g"',
    ]);
    const g = item(doc, 'g').getRepr();
    expect(xmlTreeRows(root, new Set([root, g])).map((r) => r.depth)).toEqual([0, 1, 1, 1, 2, 2]);
  });

  it('indents, unindents and raises with one undo step each', () => {
    const doc = open();
    const dt = fakeDesktop(doc);
    const g = item(doc, 'g').getRepr();
    const a = item(doc, 'a').getRepr();
    expect(cmdRaiseNode(dt, g)).toBe(g);
    expect(g.next()).toBe(a);
    expect(lastUndo(doc)).toBe('Raise node');
    expect(cmdIndentNode(dt, a)).toBe(a);
    expect(a.parent()).toBe(g);
    expect(a.next()).toBeNull();
    expect(cmdUnindentNode(dt, a)).toBe(a);
    expect(a.parent()).toBe(doc.rroot);
    expect(a.prev()).toBe(g);
  });

  it('prefixes new element names with svg:', () => {
    const doc = open();
    const node = cmdNewElementNode(fakeDesktop(doc), doc.rroot, '<rect');
    expect(node?.name()).toBe('svg:rect');
    expect(cmdNewElementNode(fakeDesktop(doc), doc.rroot, '  ')).toBeNull();
  });
});

describe('attribute dialog', () => {
  it('changes, renames and deletes attributes as undo steps', () => {
    const doc = open();
    const a = item(doc, 'a').getRepr();
    expect(attrValueEdited(doc, a, 'width', '10')).toBe(false);
    expect(attrValueEdited(doc, a, 'width', '20')).toBe(true);
    expect(lastUndo(doc)).toBe('Change attribute value');
    expect(attrRename(doc, a, 'width', 'height')).toBe(false); // name in use
    expect(attrRename(doc, a, 'width', 'x')).toBe(true);
    expect(a.attribute('x')).toBe('20');
    attrValueEdited(doc, a, 'x', '');
    expect(a.attribute('x')).toBeNull();
    attrDelete(doc, a, 'height');
    expect(lastUndo(doc)).toBe('Delete attribute');
    DocumentUndo.undo(doc);
    expect(a.attribute('height')).toBe('10');
  });
});

describe('objects dialog', () => {
  it('labels with inkscape:label, else type and id', () => {
    const doc = open();
    expect(objectLabel(item(doc, 'g'))).toBe('Group');
    expect(objectLabel(item(doc, 'a'))).toMatch(/ a$/);
  });

  it('lists topmost first and skips collapsed groups', () => {
    const doc = open();
    const dt = fakeDesktop(doc);
    expect(objectRows(dt, new Set()).map((r) => [r.item.getId(), r.depth])).toEqual([
      ['g', 0],
      ['c', 1],
      ['b', 1],
      ['a', 0],
    ]);
    expect(objectRows(dt, new Set([item(doc, 'g')])).map((r) => r.item.getId())).toEqual(['g', 'a']);
  });

  it('toggles visibility and lock in the repr, and merges repeated toggles', () => {
    const doc = open();
    const dt = fakeDesktop(doc);
    const a = item(doc, 'a');
    toggleVisible(dt, a);
    expect(a.getRepr().attribute('style')).toContain('display:none');
    expect(objectRows(dt, new Set()).find((r) => r.item === a)?.hidden).toBe(true);
    expect(lastUndo(doc)).toBe('Toggle item visibility');
    toggleVisible(dt, a);
    expect(a.isHidden()).toBe(false);
    expect(doc.undoStack.undo).toHaveLength(1);
    toggleLocked(dt, a);
    expect(a.getRepr().attribute('sodipodi:insensitive')).toBe('true');
    expect(lastUndo(doc)).toBe('Toggle item locking');
  });
});
