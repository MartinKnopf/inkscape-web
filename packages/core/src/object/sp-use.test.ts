// SPDX-License-Identifier: GPL-2.0-or-later
import { Translate } from '@inkscape-web/geom';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeDrawing, type FakeDrawingGroup } from '../display/fake-drawing.ts';
import { SPDocument } from '../document.ts';
import { Preferences } from '../preferences.ts';
import { ObjectSet } from './object-set.ts';
import { SPItem } from './sp-item.ts';
import { SPRect } from './sp-rect.ts';
import { SPCloneCompensation, SPUse } from './sp-use.ts';

SPDocument.scheduleIdle = () => {};

const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" ${XLINK}>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};
const get = <T>(doc: SPDocument, id: string, type: abstract new (...args: never[]) => T): T => {
  const o = doc.getObjectById(id);
  if (!(o instanceof type)) throw new Error(`no ${type.name} ${id}`);
  return o;
};

afterEach(() => Preferences.get().remove('/options/clonecompensation/value'));

describe('SPUse', () => {
  it('resolves its href to the original and builds a cloned child', () => {
    const doc = open('<rect id="r" width="10" height="5"/><use id="u" xlink:href="#r" x="20" y="1"/>');
    const use = get(doc, 'u', SPUse);
    expect(use.get_original()).toBe(doc.getObjectById('r'));
    expect(use.child).toBeInstanceOf(SPRect);
    expect(use.child?.cloned).toBe(true);
    expect(use.documentGeometricBounds()?.min().x).toBe(20);
    expect(use.documentGeometricBounds()?.max().y).toBe(6);
  });

  it('resolves an original that appears later and follows id changes', () => {
    const doc = open('<use id="u" href="#later"/>');
    const use = get(doc, 'u', SPUse);
    expect(use.child).toBeNull();
    const rect = doc.rdoc.createElement('svg:rect');
    rect.setAttribute('id', 'later');
    rect.setAttribute('width', '3');
    rect.setAttribute('height', '3');
    doc.rroot.appendChild(rect);
    expect(use.get_original()).toBe(doc.getObjectById('later'));
    rect.setAttribute('id', 'other');
    expect(use.get_original()).toBeNull();
    expect(use.child).toBeNull();
  });

  it('updates its child and its views when the original changes', () => {
    const doc = open('<rect id="r" width="10" height="5"/><use id="u" xlink:href="#r"/>');
    const use = get(doc, 'u', SPUse);
    const drawing = new FakeDrawing();
    const view = use.invokeShow(drawing, SPItem.displayKeyNew(1), 1) as FakeDrawingGroup;
    expect(view.children[0]?.item).toBe(use.child);

    doc.getObjectById('r')?.setAttribute('width', '30');
    doc.ensureUpToDate();
    expect(use.documentGeometricBounds()?.width()).toBe(30);

    doc.getObjectById('r')?.setAttribute('id', 'r2');
    use.setAttribute('xlink:href', '#r2');
    doc.ensureUpToDate();
    expect(view.children.length).toBe(1);
    expect(view.children[0]?.item).toBe(use.child);
    expect(use.child?.cloneOriginal).toBe(doc.getObjectById('r2'));
  });

  it('refuses a reference to itself or an ancestor', () => {
    const doc = open('<g id="g"><use id="u" xlink:href="#g"/></g><use id="self" xlink:href="#self"/>');
    expect(get(doc, 'u', SPUse).child).toBeNull();
    expect(get(doc, 'self', SPUse).child).toBeNull();
  });

  it('unlinks to a copy of the original with the clone id, style and transform', () => {
    const doc = open(
      '<rect id="r" width="10" height="5"/><use id="u" xlink:href="#r" x="2" transform="translate(10,0)" style="opacity:0.5"/>',
    );
    const copy = get(doc, 'u', SPUse).unlink();
    expect(copy).toBeInstanceOf(SPRect);
    expect(doc.getObjectById('u')).toBe(copy);
    expect(copy?.getRepr().name()).toBe('svg:rect');
    expect(copy?.documentGeometricBounds()?.min().x).toBe(12);
    expect(copy?.getRepr().attribute('style')).toContain('opacity:0.5');
  });

  it('unlinks clones when the original is deleted (cloneorphans default)', () => {
    const doc = open('<rect id="r" width="10" height="5"/><use id="u" xlink:href="#r"/>');
    doc.getObjectById('r')?.deleteObject();
    expect(doc.getObjectById('u')).toBeInstanceOf(SPRect);
  });
});

describe('clone compensation', () => {
  const moveOriginal = (mode: SPCloneCompensation) => {
    Preferences.get().setInt('/options/clonecompensation/value', mode);
    const doc = open('<rect id="r" width="10" height="5"/><use id="u" xlink:href="#r"/>');
    const set = new ObjectSet(doc);
    set.set(get(doc, 'r', SPRect));
    set.applyAffine(Translate(100, 0));
    doc.ensureUpToDate();
    return get(doc, 'u', SPUse).documentGeometricBounds()?.min().x;
  };

  it('keeps clones in place by default (unmoved)', () => {
    expect(moveOriginal(SPCloneCompensation.SP_CLONE_COMPENSATION_UNMOVED)).toBe(0);
  });
  it('moves clones with the original for parallel and none', () => {
    expect(moveOriginal(SPCloneCompensation.SP_CLONE_COMPENSATION_PARALLEL)).toBe(100);
    expect(moveOriginal(SPCloneCompensation.SP_CLONE_COMPENSATION_NONE)).toBe(100);
  });

  it('moves a clone selected with its original once', () => {
    const doc = open('<rect id="r" width="10" height="5"/><use id="u" xlink:href="#r"/>');
    const set = new ObjectSet(doc);
    set.setList([get(doc, 'r', SPRect), get(doc, 'u', SPUse)]);
    set.applyAffine(Translate(100, 0));
    expect(get(doc, 'u', SPUse).documentGeometricBounds()?.min().x).toBe(100);
  });
});

describe('ObjectSet clone operations', () => {
  it('clones, selects the original and unlinks', () => {
    const doc = open('<rect width="10" height="5"/>');
    const rect = doc.getRoot().children.find((c) => c instanceof SPRect) as SPRect;
    const set = new ObjectSet(doc);
    set.set(rect);
    set.clone();
    const use = set.singleItem();
    expect(use).toBeInstanceOf(SPUse);
    expect(rect.getId()).not.toBeNull();
    expect(use?.getAttribute('xlink:href')).toBe(`#${rect.getId()}`);

    set.cloneOriginal();
    expect(set.singleItem()).toBe(rect);

    set.set(use as SPUse);
    expect(set.unlink()).toBe(true);
    expect(set.singleItem()).toBeInstanceOf(SPRect);
  });
});
