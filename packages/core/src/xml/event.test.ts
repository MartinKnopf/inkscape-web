// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { XmlDocument } from './document.ts';
import { replayLog, undoLog } from './event.ts';
import { writeBuf } from './repr-io.ts';

function setup() {
  const doc = new XmlDocument();
  const root = doc.createElement('svg:svg');
  doc.appendChild(root);
  const g = doc.createElement('svg:g');
  g.setAttribute('id', 'g');
  root.appendChild(g);
  return { doc, root, g };
}

describe('transactions', () => {
  it('records all kinds of changes, and undo and redo restore them', () => {
    const { doc, root, g } = setup();
    const before = writeBuf(root);

    doc.beginTransaction();
    const r = doc.createElement('svg:rect');
    r.setAttribute('width', '5');
    g.appendChild(r);
    const t = doc.createTextNode('a');
    root.appendChild(t);
    t.setContent('b');
    g.setAttribute('id', 'h');
    root.changeOrder(t, null);
    g.setCodeUnsafe('svg:a');
    const log = doc.commitUndoable();
    const after = writeBuf(root);

    expect(log.map((e) => e.kind)).toEqual([
      'chgAttr',
      'add',
      'add',
      'chgContent',
      'chgAttr',
      'chgOrder',
      'chgElementName',
    ]);
    undoLog(log);
    expect(writeBuf(root)).toBe(before);
    replayLog(log);
    expect(writeBuf(root)).toBe(after);
  });

  it('rollback undoes the open transaction', () => {
    const { doc, root, g } = setup();
    const before = writeBuf(root);
    doc.beginTransaction();
    root.removeChild(g);
    root.setAttribute('width', '1');
    doc.rollback();
    expect(writeBuf(root)).toBe(before);
    expect(doc.inTransaction()).toBe(false);
  });

  it('does not record changes outside a transaction', () => {
    const { doc, g } = setup();
    g.setAttribute('x', '1');
    doc.beginTransaction();
    expect(doc.commitUndoable()).toEqual([]);
  });

  it('rejects nested transactions', () => {
    const { doc } = setup();
    doc.beginTransaction();
    expect(() => doc.beginTransaction()).toThrow();
  });
});
