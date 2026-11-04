// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/path/path-outline.cpp, src/path/path-simplify.cpp, src/actions/actions-paths.cpp
import { loadGeom } from '@inkscape-web/wasm';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { ObjectSet } from '../object/object-set.ts';
import type { SPItem } from '../object/sp-item.ts';
import { setPathBoolopBackend } from './path-boolop.ts';
import { pathFlatten, pathFracture } from './path-fracture.ts';
import { strokesToPaths } from './path-outline.ts';
import { simplifyPaths } from './path-simplify.ts';

setPathBoolopBackend(await loadGeom());
SPDocument.scheduleIdle = () => {};

function load(body: string, ...ids: string[]) {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200">${body}</svg>`,
  ) as SPDocument;
  doc.ensureUpToDate();
  const set = new ObjectSet(doc);
  for (const id of ids) set.add(doc.getObjectById(id) as SPItem);
  return { doc, set };
}

const bounds = (item: SPItem | undefined) => {
  item?.document.ensureUpToDate();
  const b = item?.documentGeometricBounds();
  return b ? [b.left(), b.top(), b.right(), b.bottom()].map((v) => Math.round(v * 100) / 100) : null;
};

describe('stroke to path', () => {
  it('turns a stroked rectangle into a group of a fill and a stroke path', () => {
    const { doc, set } = load(
      '<rect id="r" x="20" y="20" width="40" height="40" style="fill:red;stroke:blue;stroke-width:10"/>',
      'r',
    );
    expect(strokesToPaths(set)).toBe(true);
    const group = doc.getObjectById('r') as SPItem;
    expect(group.getRepr().name()).toBe('svg:g');
    const [fill, stroke] = group.childList() as SPItem[];
    expect(fill?.getAttribute('style')).toContain('fill:red');
    expect(stroke?.getAttribute('style')).toContain('fill:blue');
    expect(bounds(fill)).toEqual([20, 20, 60, 60]);
    // The stroke is the area between the inner and the outer outline: 15..65 outside.
    expect(bounds(stroke)).toEqual([15, 15, 65, 65]);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Convert stroke to path']);
  });

  it('leaves an unstroked path alone', () => {
    const { doc, set } = load('<path id="p" d="M 0 0 L 10 0 L 10 10 z" style="fill:red;stroke:none"/>', 'p');
    expect(strokesToPaths(set)).toBe(false);
    expect(doc.getObjectById('p')?.getRepr().name()).toBe('svg:path');
  });

  it('a stroke without fill becomes a single path', () => {
    const { doc, set } = load(
      '<path id="p" d="M 10 50 L 90 50" style="fill:none;stroke:#000000;stroke-width:10"/>',
      'p',
    );
    expect(strokesToPaths(set)).toBe(true);
    const path = doc.getObjectById('p') as SPItem;
    expect(path.getRepr().name()).toBe('svg:path');
    expect(bounds(path)).toEqual([10, 45, 90, 55]);
  });

  it('applies the dashes', () => {
    const { doc, set } = load(
      '<path id="p" d="M 0 50 L 100 50" style="fill:none;stroke:#000000;stroke-width:10;stroke-dasharray:20,20"/>',
      'p',
    );
    strokesToPaths(set);
    const d = (doc.getObjectById('p') as SPItem).getAttribute('d') ?? '';
    expect(d.match(/M/gi)?.length).toBe(3);
  });
});

describe('simplify', () => {
  it('removes extra nodes and keeps the shape', () => {
    const points = Array.from({ length: 21 }, (_, i) => `L ${i * 5} ${i % 2 === 0 ? 50 : 50.01}`).join(' ');
    const { doc, set } = load(`<path id="p" d="M 0 50 ${points}" style="fill:none;stroke:black"/>`, 'p');
    expect(simplifyPaths(set, false, 1e9)).toBe(true);
    const path = doc.getObjectById('p') as SPItem;
    expect((path.getAttribute('d') ?? '').split(/[A-Za-z]/).length).toBeLessThan(10);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Simplify']);
  });
});

describe('fracture and flatten', () => {
  const two =
    '<rect id="a" x="0" y="0" width="40" height="40" style="fill:red"/>' +
    '<rect id="b" x="20" y="20" width="40" height="40" style="fill:blue"/>';

  it('fracture gives the three pieces of two overlapping squares, the top one on the overlap', () => {
    const { doc, set } = load(two, 'a', 'b');
    pathFracture(set);
    const pieces = set.items();
    expect(pieces).toHaveLength(3);
    const fills = pieces.map((p) => /(?:^|;)fill:(\w+)/.exec(p.getAttribute('style') ?? '')?.[1]).sort();
    expect(fills).toEqual(['blue', 'blue', 'red']);
    expect(pieces.map((p) => bounds(p)?.join(',')).sort()).toEqual([
      '0,0,40,40',
      '20,20,40,40',
      '20,20,60,60',
    ]);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Fracture']);
  });

  it('flatten removes the covered part of the lower square', () => {
    const { doc, set } = load(two, 'a', 'b');
    pathFlatten(set);
    const pieces = set.items();
    expect(pieces).toHaveLength(2);
    const sizes = pieces.map((p) => {
      const b = bounds(p) as number[];
      return (b[2] as number) - (b[0] as number);
    });
    expect(sizes.sort()).toEqual([40, 40]);
    expect(doc.undoStack.undo.map((e) => e.description)).toEqual(['Flatten']);
  });
});

describe('fill between paths', () => {
  it('adds a path with the fill between many effect below the bottom path', () => {
    const { doc, set } = load(
      '<path id="a" d="M 0 0 L 50 0" style="fill:none;stroke:black"/>' +
        '<path id="b" d="M 0 50 L 50 50" style="fill:none;stroke:black"/>',
      'a',
      'b',
    );
    set.fillBetweenMany();
    const fill = set.singleItem() as SPItem;
    expect(fill.getAttribute('inkscape:path-effect')).toMatch(/^#path-effect/);
    const lpe = doc.getDefs()?.getRepr().firstChild();
    expect(lpe?.attribute('effect')).toBe('fill_between_many');
    expect(lpe?.attribute('linkedpaths')).toBe('#a,0,1|#b,0,1|');
    // The fill is directly below the bottom path.
    expect(fill.getRepr().next()?.attribute('id')).toBe('a');
    expect(bounds(fill)).toEqual([0, 0, 50, 50]);
  });
});
