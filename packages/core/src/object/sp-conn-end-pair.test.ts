// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-conn-end-pair.cpp, src/object/sp-conn-end.cpp, src/conn-avoid-ref.cpp

import { Translate } from '@inkscape-web/geom';
import { loadGeom } from '@inkscape-web/wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { avoid_item_poly } from '../conn-avoid-ref.ts';
import { SPDocument } from '../document.ts';
import { setPathBoolopBackend } from '../path/path-boolop.ts';
import type { SPItem } from './sp-item.ts';
import type { SPPath } from './sp-path.ts';

SPDocument.scheduleIdle = () => {};
beforeAll(async () => setPathBoolopBackend(await loadGeom()));

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"';
const open = (body: string) => {
  const doc = SPDocument.createNewDocFromMem(`<svg ${NS} width="400" height="300">${body}</svg>`);
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};

/** The points of the connector path, rounded. */
const points = (path: SPPath) => {
  const p = path.curve()?.[0];
  if (!p) return [];
  return [p.initialPoint(), ...p.curves().map((c) => c.finalPoint())].map((q) => [
    Math.round(q.x),
    Math.round(q.y),
  ]);
};

const RECTS =
  '<rect id="a" x="0" y="0" width="20" height="20"/><rect id="b" x="200" y="0" width="20" height="20"/>' +
  '<rect id="o" x="90" y="-40" width="20" height="100" inkscape:connector-avoid="true"/>';

describe('connectors', () => {
  it('routes an orthogonal connector around an avoided shape and cuts it at the attached shapes', () => {
    const doc = open(
      `${RECTS}<path id="c" d="M 10,10 L 210,10" inkscape:connector-type="orthogonal" inkscape:connector-curvature="0" inkscape:connection-start="#a" inkscape:connection-end="#b"/>`,
    );
    const path = doc.getObjectById('c') as SPPath;
    const pts = points(path);
    // Starts on the outline of a (0..20), ends on the outline of b (200..220).
    const onOutline = ([x, y]: number[], x0: number) =>
      x! >= x0 && x! <= x0 + 20 && y! >= 0 && y! <= 20 && [x0, x0 + 20].includes(x!) !== [0, 20].includes(y!);
    expect(onOutline(pts[0]!, 0)).toBe(true);
    expect(onOutline(pts.at(-1)!, 200)).toBe(true);
    // Goes around the obstacle with horizontal and vertical segments only.
    expect(pts.length).toBeGreaterThan(2);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]![0] === pts[i - 1]![0] || pts[i]![1] === pts[i - 1]![1]).toBe(true);
    }
    expect(pts.some(([, y]) => y! > 60 || y! < -40)).toBe(true);
    expect(path.getRepr().attribute('inkscape:connector-type')).toBe('orthogonal');
  });

  it('follows an attached shape that moves', () => {
    const doc = open(
      `${RECTS}<path id="c" d="M 10,10 L 210,10" inkscape:connector-type="polyline" inkscape:connector-curvature="0" inkscape:connection-start="#a" inkscape:connection-end="#b"/>`,
    );
    const b = doc.getObjectById('b') as SPItem;
    b.doWriteTransform(Translate(0, 200));
    doc.ensureUpToDate();
    const pts = points(doc.getObjectById('c') as SPPath);
    // The end is on the outline of the moved rectangle (200..220 x 200..220).
    const [x, y] = pts.at(-1)!;
    expect(x! >= 199 && x! <= 221 && y! >= 199 && y! <= 221).toBe(true);
  });

  it('enlarges the avoided polygon by the connector spacing', () => {
    const doc = open(
      '<rect id="o" x="0" y="0" width="10" height="10" inkscape:connector-avoid="true"/><sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" inkscape:connector-spacing="5"/>',
    );
    const poly = avoid_item_poly(doc.getObjectById('o') as SPItem);
    const xs = poly.filter((_, i) => i % 2 === 0);
    const ys = poly.filter((_, i) => i % 2 === 1);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(Math.round)).toEqual([
      -5, 15, -5, 15,
    ]);
  });
});
