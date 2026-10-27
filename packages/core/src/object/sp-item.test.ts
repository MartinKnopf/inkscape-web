// SPDX-License-Identifier: GPL-2.0-or-later
import { Affine, Scale, Translate } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { SPItem } from './sp-item.ts';

SPDocument.scheduleIdle = () => {};

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

describe('SPItem transform', () => {
  it('reads the transform attribute and writes it back', () => {
    const doc = open('<g id="a" transform="translate(10 20) scale(2)"/>');
    const a = item(doc, 'a');
    expect(a.transform.equals(new Affine(2, 0, 0, 2, 10, 20))).toBe(true);

    a.setItemTransform(Translate(5, 6));
    a.updateRepr();
    expect(a.getAttribute('transform')).toBe('translate(5,6)');

    a.setItemTransform(Affine.identity());
    a.updateRepr();
    expect(a.getAttribute('transform')).toBeNull();
  });

  it('uses the identity for a missing or invalid transform', () => {
    const doc = open('<g id="a" transform="scale(2)"/>');
    const a = item(doc, 'a');
    a.setAttribute('transform', 'nonsense(');
    expect(a.transform.isIdentity()).toBe(true);
    a.setAttribute('transform', 'scale(3)');
    a.removeAttribute('transform');
    expect(a.transform.isIdentity()).toBe(true);
  });

  it('accumulates i2doc through nested groups, and set_i2d_affine inverts it', () => {
    const doc = open(
      '<g id="a" transform="translate(10,0)"><g id="b" transform="scale(2)"><g id="c" transform="translate(1,1)"/></g></g>',
    );
    const c = item(doc, 'c');
    // c * b * a: (1,1) → scale 2 → (2,2) → +(10,0)
    expect(c.i2docAffine().equals(new Affine(2, 0, 0, 2, 12, 2))).toBe(true);
    expect(c.i2dtAffine().equals(c.i2docAffine())).toBe(true);

    c.setI2dAffine(Translate(20, 0));
    expect(c.i2docAffine().isTranslation()).toBe(true);
    expect(c.i2docAffine().translation().x).toBeCloseTo(20);
    expect(c.transform.equals(Scale(0.5).multiply(Translate(5, 0)))).toBe(true);
  });
});

describe('SPItem state', () => {
  it('is locked when it or an ancestor is insensitive', () => {
    const doc = open(
      '<g id="a" sodipodi:insensitive="true" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><g id="b"/></g><g id="c"/>',
    );
    expect(item(doc, 'b').isLocked()).toBe(true);
    expect(item(doc, 'c').isVisibleAndUnlocked()).toBe(true);
    item(doc, 'a').removeAttribute('sodipodi:insensitive');
    expect(item(doc, 'b').isLocked()).toBe(false);
  });

  it('is hidden with display:none', () => {
    const doc = open('<g id="a" style="display:none"/><g id="b"/>');
    expect(item(doc, 'a').isHidden()).toBe(true);
    expect(item(doc, 'a').isVisibleAndUnlocked()).toBe(false);
    expect(item(doc, 'b').isHidden()).toBe(false);
  });

  it('keeps the transform center through write', () => {
    const doc = open(
      '<g id="a" inkscape:transform-center-x="3" inkscape:transform-center-y="-4" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"/>',
    );
    const a = item(doc, 'a');
    expect([a.transform_center_x, a.transform_center_y]).toEqual([3, 4]);
    a.updateRepr();
    expect(a.getAttribute('inkscape:transform-center-y')).toBe('-4');
  });
});
