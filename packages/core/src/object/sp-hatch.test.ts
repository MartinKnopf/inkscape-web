// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/object/sp-hatch.cpp, src/object/sp-hatch-path.cpp
import { Interval, Rect } from '@inkscape-web/geom';
import { describe, expect, it } from 'vitest';
import { SPDocument } from '../document.ts';
import { HatchUnits, SPHatch } from './sp-hatch.ts';
import type { SPHatchPath } from './sp-hatch-path.ts';
import type { SPItem } from './sp-item.ts';

const open = (defs: string, body = '') => {
  const doc = SPDocument.createNewDocFromMem(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>${defs}</defs>${body}</svg>`,
  );
  if (!doc) throw new Error('parse failed');
  doc.ensureUpToDate();
  return doc;
};

describe('SPHatch', () => {
  it('reads the attributes, follows the href chain and is a fill paint server', () => {
    const doc = open(
      '<hatch id="h1" hatchUnits="userSpaceOnUse" pitch="15" rotate="45" style="stroke:#000;stroke-width:2"><hatchpath offset="3"/></hatch>' +
        '<hatch id="h2" xlink:href="#h1" x="5"/>',
      '<rect id="r" width="10" height="10" style="fill:url(#h2)"/>',
    );
    const h2 = doc.getObjectById('h2') as SPHatch;
    expect(h2).toBeInstanceOf(SPHatch);
    expect([h2.pitch(), h2.rotate(), h2.x(), h2.hatchUnits()]).toEqual([
      15,
      45,
      5,
      HatchUnits.UserSpaceOnUse,
    ]);
    expect(h2.rootHatch().getId()).toBe('h1');
    expect(h2.hatchPaths()).toHaveLength(1);
    expect(h2.isValid()).toBe(true);
    expect((doc.getObjectById('r') as SPItem).style.getFillPaintServer()).toBe(h2);
    // A hatch without paths or pitch is not valid.
    expect(
      (open('<hatch id="h" pitch="0"><hatchpath/></hatch>').getObjectById('h') as SPHatch).isValid(),
    ).toBe(false);
  });

  it('repeats a hatch path over the strip extents', () => {
    const doc = open(
      '<hatch id="h" pitch="10"><hatchpath id="p" d="M 0,0 5,10"/><hatchpath id="v"/></hatch>',
    );
    const p = doc.getObjectById('p') as SPHatchPath;
    // Repeat length 10: the strip [-5, 25] needs the segments starting at -10, 0, 10, 20.
    const curve = p.calculateRenderCurve(new Interval(-5, 25));
    expect(curve.map((path) => path.initialPoint().y)).toEqual([-10, 0, 10, 20]);
    // Without d: one vertical line over the strip.
    const v = doc.getObjectById('v') as SPHatchPath;
    const line = v.calculateRenderCurve(new Interval(2, 8))[0]!;
    expect([line.initialPoint().y, line.finalPoint().y]).toEqual([2, 8]);
  });

  it('computes the strip extents and the tile of an object', () => {
    const doc = open(
      '<hatch id="h" hatchUnits="userSpaceOnUse" pitch="15" style="stroke:#000;stroke-width:2;overflow:visible"><hatchpath/></hatch>',
    );
    const h = doc.getObjectById('h') as SPHatch;
    const bbox = new Rect(0, 10, 40, 30);
    expect(h.calculateStripExtents(bbox)).toEqual(new Interval(10, 30));
    const info = h.calculateRenderInfo(bbox);
    expect([
      info.tile_rect.left(),
      info.tile_rect.top(),
      info.tile_rect.width(),
      info.tile_rect.height(),
    ]).toEqual([0, 10, 15, 20]);
    // The stroke (width 2) overflows the strip [-1, 1]: two steps.
    expect(info.overflow_steps).toBe(2);
  });
});
