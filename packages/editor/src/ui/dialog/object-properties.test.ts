// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/ui/dialog/object-attributes.cpp, src/object/sp-object.cpp
import { SPDocument, type SPItem } from '@inkscape-web/core';
import { describe, expect, it } from 'vitest';
import {
  setObjectAttribute,
  setObjectDescription,
  setObjectHidden,
  setObjectId,
  setObjectLabel,
  setObjectLocked,
  setObjectTitle,
} from './object-properties.ts';

SPDocument.scheduleIdle = () => {};

function open() {
  const doc = SPDocument.createNewDocFromMem(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" width="10" height="10"/><rect id="b" width="5" height="5"/></svg>',
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  const a = doc.getObjectById('a') as SPItem;
  const last = () => doc.undoStack.undo.at(-1)?.description;
  return { doc, a, last };
}

describe('object properties', () => {
  it('sets a valid id and refuses an invalid one without an undo step', () => {
    const { doc, a, last } = open();
    expect(setObjectId(a, 'new-id')).toBeNull();
    expect(doc.getObjectById('new-id')).toBe(a);
    expect(last()).toBe('Set object ID');
    const steps = doc.undoStack.undo.length;
    expect(setObjectId(a, '1abc')).toBe('ID cannot start with a digit');
    expect(setObjectId(a, 'a b')).toBe('ID contains invalid characters');
    expect(setObjectId(a, '')).toBe('Invalid empty ID');
    expect(doc.undoStack.undo.length).toBe(steps);
  });

  it('stores title and description as the first children, and removes them when empty', () => {
    const { a, last } = open();
    setObjectTitle(a, 'My rect');
    setObjectDescription(a, 'A square');
    expect(a.title()).toBe('My rect');
    expect(a.desc()).toBe('A square');
    expect(a.getRepr().firstChild()?.name()).toBe('svg:desc');
    expect(last()).toBe('Set object description');
    setObjectTitle(a, '  ');
    expect(a.title()).toBeNull();
    expect(a.desc()).toBe('A square');
  });

  it('merges typing into one undo step per field', () => {
    const { doc, a } = open();
    setObjectLabel(a, 'F');
    setObjectLabel(a, 'Fo');
    setObjectLabel(a, 'Foo');
    expect(a.label()).toBe('Foo');
    expect(doc.undoStack.undo.length).toBe(1);
  });

  it('locks, hides and sets an event handler', () => {
    const { a, last } = open();
    setObjectLocked(a, true);
    expect(a.getAttribute('sodipodi:insensitive')).toBe('true');
    expect(last()).toBe('Lock object');
    setObjectHidden(a, true);
    expect(a.isExplicitlyHidden()).toBe(true);
    expect(last()).toBe('Hide object');
    setObjectAttribute(a, 'onclick', 'alert(1)');
    expect(a.getAttribute('onclick')).toBe('alert(1)');
    expect(last()).toBe('Set attribute');
    setObjectAttribute(a, 'onclick', '');
    expect(a.getAttribute('onclick')).toBeNull();
  });
});
