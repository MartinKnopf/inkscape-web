// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { SPDocument } from './document.ts';
import { DocumentUndo } from './document-undo.ts';
import { SPDefs } from './object/sp-defs.ts';
import { SPGroup } from './object/sp-item-group.ts';
import { SP_OBJECT_MODIFIED_FLAG } from './object/sp-object.ts';
import { writeBuf } from './xml/repr-io.ts';

SPDocument.scheduleIdle = () => {}; // tests call ensureUpToDate() themselves

const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  return doc;
};
const ids = (doc: SPDocument) => doc.root.children.map((c) => c.getId());

describe('SPDocument', () => {
  it('builds the object tree and binds ids', () => {
    const doc = open('<defs id="d"/><g id="a"><g id="b"/></g>');
    expect(doc.root.defs).toBeInstanceOf(SPDefs);
    const b = doc.getObjectById('b');
    expect(b).toBeInstanceOf(SPGroup);
    expect(b?.parent).toBe(doc.getObjectById('a'));
    expect(doc.getObjectByRepr(b!.repr)).toBe(b);
  });

  it('adds missing defs and ids, and renames duplicate ids', () => {
    const doc = open('<g id="a"/><g id="a"/><g/>');
    expect(doc.root.defs).not.toBeNull();
    // One counter for all prefixes, as upstream: g1, g2, then defs2.
    expect(ids(doc)).toEqual(['defs2', 'a', 'g1', 'g2']);
    expect(doc.rroot.lastChild()!.attribute('id')).toBe('g2');
    expect(doc.rroot.attribute('version')).toBe('1.1');
  });

  it('follows changes of the repr tree', () => {
    const doc = open('<defs id="d"/><g id="a"/><g id="b"/>');
    const g = doc.rdoc.createElement('svg:g');
    g.setAttribute('id', 'c');
    doc.rroot.addChild(g, doc.getObjectById('a')!.repr);
    expect(ids(doc)).toEqual(['d', 'a', 'c', 'b']);
    doc.rroot.changeOrder(g, null);
    expect(ids(doc)).toEqual(['c', 'd', 'a', 'b']);
    doc.rroot.removeChild(g);
    expect(ids(doc)).toEqual(['d', 'a', 'b']);
    expect(doc.getObjectById('c')).toBeNull();
  });

  it('rebinds ids, and renames the other object on conflict', () => {
    const doc = open('<g id="a"/><g id="b"/>');
    const a = doc.getObjectById('a')!;
    a.setAttribute('id', 'x');
    expect(doc.getObjectById('x')).toBe(a);
    expect(doc.getObjectById('a')).toBeNull();
    doc.getObjectById('b')!.setAttribute('id', 'x');
    expect(a.getId()).not.toBe('x');
    expect(doc.getObjectById('x')?.repr).toBe(doc.rroot.lastChild());
  });

  it('runs update and modified passes after a request', () => {
    const doc = open('<g id="a"><g id="b"/></g>');
    doc.ensureUpToDate();
    const b = doc.getObjectById('b')!;
    const onModified = vi.fn();
    b.modifiedSignal.connect(onModified);
    b.requestDisplayUpdate(SP_OBJECT_MODIFIED_FLAG);
    expect(doc.root.uflags).not.toBe(0);
    doc.ensureUpToDate();
    expect(doc.root.uflags | doc.root.mflags | b.uflags | b.mflags).toBe(0);
    expect(onModified).toHaveBeenCalledWith(b, expect.any(Number));
  });
});

describe('DocumentUndo', () => {
  const svg = (doc: SPDocument) => writeBuf(doc.rroot);

  it('undoes and redoes a step, and updates the object tree', () => {
    const doc = open('<g id="a"/>');
    const before = svg(doc);
    doc.rroot.removeChild(doc.getObjectById('a')!.repr);
    DocumentUndo.done(doc, 'Delete');
    const after = svg(doc);

    expect(DocumentUndo.undo(doc)).toBe(true);
    expect(svg(doc)).toBe(before);
    expect(doc.getObjectById('a')).toBeInstanceOf(SPGroup);
    expect(DocumentUndo.redo(doc)).toBe(true);
    expect(svg(doc)).toBe(after);
    expect(DocumentUndo.redo(doc)).toBe(false);
  });

  it('merges steps with the same key', () => {
    const doc = open('<g id="a"/>');
    const a = doc.getObjectById('a')!;
    a.setAttribute('x', '1');
    DocumentUndo.maybeDone(doc, 'move', 'Move');
    a.setAttribute('x', '2');
    DocumentUndo.maybeDone(doc, 'move', 'Move');
    expect(doc.undoStack.undo).toHaveLength(1);
    DocumentUndo.undo(doc);
    expect(a.getAttribute('x')).toBeNull();
  });

  it('cancel reverts changes since the last step', () => {
    const doc = open('<g id="a"/>');
    const a = doc.getObjectById('a')!;
    a.setAttribute('x', '1');
    DocumentUndo.done(doc, 'Set x');
    a.setAttribute('x', '2');
    DocumentUndo.cancel(doc);
    expect(a.getAttribute('x')).toBe('1');
    expect(doc.undoStack.undo).toHaveLength(1);
  });

  it('does not record changes made while insensitive', () => {
    const doc = open('<g id="a"/>');
    DocumentUndo.scopedInsensitive(doc, () => doc.getObjectById('a')!.setAttribute('x', '1'));
    DocumentUndo.done(doc, 'nothing');
    expect(doc.undoStack.undo).toHaveLength(0);
  });

  it('a new step clears redo', () => {
    const doc = open('<g id="a"/>');
    const a = doc.getObjectById('a')!;
    a.setAttribute('x', '1');
    DocumentUndo.done(doc, 'one');
    DocumentUndo.undo(doc);
    a.setAttribute('y', '1');
    DocumentUndo.done(doc, 'two');
    expect(DocumentUndo.redo(doc)).toBe(false);
  });
});
