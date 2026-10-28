// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path-chemistry.cpp, src/helper/geom.cpp
import { describe, expect, it } from 'vitest';
import { SPDocument } from './document.ts';
import { pathv_to_linear_and_cubic_beziers } from './helper/geom.ts';
import { ObjectSet } from './object/object-set.ts';
import { SPPath } from './object/sp-path.ts';
import { toCurves } from './path-chemistry.ts';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
  '<rect id="r" x="10" y="20" width="30" height="40" style="fill:blue" transform="translate(5,0)"/>' +
  '<ellipse id="e" cx="100" cy="100" rx="50" ry="25" class="c"/>' +
  '</svg>';

function load() {
  const doc = SPDocument.createNewDocFromMem(SVG);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
}

describe('toCurves (Object to Path)', () => {
  it('replaces a rect with a path of the same geometry, id, style, transform and position', () => {
    const doc = load();
    const rect = doc.getObjectById('r');
    const set = new ObjectSet(doc);
    if (rect) set.set(rect);
    toCurves(set);
    doc.ensureUpToDate();

    const path = doc.getObjectById('r');
    expect(path).toBeInstanceOf(SPPath);
    expect(set.items()).toEqual([path]);
    const repr = path?.getRepr();
    expect(repr?.attribute('d')).toBe('M 10,20 H 40 V 60 H 10 Z');
    expect(repr?.attribute('style')).toBe('fill:blue');
    expect(repr?.attribute('transform')).toBe('translate(5,0)');
    expect(repr?.next()?.attribute('id')).toBe('e'); // same position
    expect(doc.undoStack.undo.map((s) => s.description)).toEqual(['Object to path']);
  });

  it('converts an ellipse to a closed path with its bounds, keeping the class', () => {
    const doc = load();
    const set = new ObjectSet(doc);
    const e = doc.getObjectById('e');
    if (e) set.set(e);
    toCurves(set);
    doc.ensureUpToDate();

    const path = doc.getObjectById('e') as SPPath;
    expect(path).toBeInstanceOf(SPPath);
    expect(path.getRepr().attribute('class')).toBe('c');
    const curve = path.curve() ?? [];
    expect(curve).toHaveLength(1);
    expect(curve[0]?.closed()).toBe(true);
    const b = curve[0]?.boundsExact();
    expect(b?.left()).toBeCloseTo(50);
    expect(b?.right()).toBeCloseTo(150);
    expect(b?.top()).toBeCloseTo(75);
    expect(b?.bottom()).toBeCloseTo(125);

    // The node tool edits it as cubic Bezier curves on the ellipse.
    const cubics = pathv_to_linear_and_cubic_beziers(curve)[0];
    for (const c of cubics?.curves() ?? []) {
      for (const t of [0.25, 0.5, 0.75]) {
        const p = c.pointAt(t);
        expect(((p.x - 100) / 50) ** 2 + ((p.y - 100) / 25) ** 2).toBeCloseTo(1, 2);
      }
    }
  });

  it('does nothing for paths: no undo step', () => {
    const doc = SPDocument.createNewDocFromMem(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="p" d="M 0,0 L 10,10"/></svg>',
    );
    if (!doc) throw new Error('parse failed');
    const set = new ObjectSet(doc);
    const p = doc.getObjectById('p');
    if (p) set.set(p);
    toCurves(set);
    expect(doc.getObjectById('p')).toBe(p);
    expect(doc.undoStack.undo).toHaveLength(0);
  });
});
